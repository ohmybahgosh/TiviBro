/* The app's state and actions, shared by every screen: paired TVs, discovery on the network, pairing,
   refreshing what each TV is doing, remote keys and actions, Play on TV, the channel list (lineup),
   favorites, the guide and reminders, Movies and Shows, typing into the TV, adding a shared playlist
   link, backups, volume, the editor address and Wake-on-LAN.  Talks to the TV only through proto/. */
package app.tivibro.phone.ui

import android.app.Application
import android.os.Build
import android.provider.Settings
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.tivibro.phone.data.BackupStore
import app.tivibro.phone.data.SavedBackup
import app.tivibro.phone.data.TvStore
import app.tivibro.phone.proto.BackupFile
import app.tivibro.phone.proto.GuidePage
import app.tivibro.phone.proto.Schedule
import app.tivibro.phone.proto.VodCat
import app.tivibro.phone.proto.VodInfo
import app.tivibro.phone.proto.VodPage
import org.json.JSONObject
import app.tivibro.phone.proto.Discovery
import app.tivibro.phone.proto.EditorState
import app.tivibro.phone.proto.Found
import app.tivibro.phone.proto.Hello
import app.tivibro.phone.proto.PairLink
import app.tivibro.phone.proto.Pairing
import app.tivibro.phone.proto.TbException
import app.tivibro.phone.proto.Tv
import app.tivibro.phone.proto.TvClient
import app.tivibro.phone.proto.Wol
import app.tivibro.phone.proto.editorUrlOk
import app.tivibro.phone.proto.Lineup
import app.tivibro.phone.proto.NowState
import app.tivibro.phone.proto.Volume
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class Power { CHECKING, ON, OFF, WAKING, UNPAIRED }

data class TvUi(
    val tv: Tv,
    val power: Power = Power.CHECKING,
    val tivibroOpen: Boolean = false,
    val busy: String? = null,
)

data class Pairing0(val busy: Boolean = false, val error: String? = null, val done: Tv? = null)

class AppModel(app: Application) : AndroidViewModel(app) {
    private val store = TvStore(app)
    val backups = BackupStore(app)
    private val _tvs = MutableStateFlow(store.load().map { TvUi(it) })
    val tvs: StateFlow<List<TvUi>> = _tvs.asStateFlow()
    private val _msg = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val messages: SharedFlow<String> = _msg.asSharedFlow()
    private val _pair = MutableStateFlow(Pairing0())
    val pairing: StateFlow<Pairing0> = _pair.asStateFlow()
    private val _found = MutableStateFlow<List<Found>?>(null)
    val found: StateFlow<List<Found>?> = _found.asStateFlow()
    var tileTv: String?
        get() = store.tileTv
        set(v) { store.tileTv = v }

    fun say(s: String) { _msg.tryEmit(s) }
    private fun setUi(id: String, f: (TvUi) -> TvUi) = _tvs.update { l -> l.map { if (it.tv.id == id) f(it) else it } }
    private fun saveTv(tv: Tv) { store.upsert(tv); setUi(tv.id) { it.copy(tv = tv) } }
    fun tv(id: String): Tv? = _tvs.value.firstOrNull { it.tv.id == id }?.tv

    val phoneName: String
        get() = runCatching { Settings.Global.getString(getApplication<Application>().contentResolver, Settings.Global.DEVICE_NAME) }.getOrNull()
            ?.takeIf { it.isNotBlank() } ?: Build.MODEL
    private val phoneModel: String get() = (if (Build.MODEL.startsWith(Build.MANUFACTURER, true)) Build.MODEL else Build.MANUFACTURER.replaceFirstChar { it.uppercase() } + " " + Build.MODEL).take(40)

    /* ---------- state of every TV ---------- */

    /** Asks every TV how it is.  A TV that moved to another address is found again by discovery. */
    fun refresh() = viewModelScope.launch {
        val list = _tvs.value
        if (list.isEmpty()) return@launch
        val off = mutableListOf<Tv>()
        list.forEach { u -> if (!check(u.tv)) off += u.tv }
        if (off.isNotEmpty()) {
            val seen = withContext(Dispatchers.IO) { runCatching { Discovery.find(1500) }.getOrDefault(emptyList()) }
            off.forEach { tv ->
                val f = seen.firstOrNull { it.id == tv.id && (it.host != tv.host || it.port != tv.port) } ?: return@forEach
                saveTv(tv.copy(host = f.host, port = f.port))
                check(tv(tv.id) ?: return@forEach)
            }
        }
    }

    /** One TV: on (and whether TiviBro is open), off, or no longer paired.  True when it answered. */
    private suspend fun check(tv: Tv): Boolean = withContext(Dispatchers.IO) {
        try {
            val info = infoWithClock(tv)
            val t = tvsLatest(tv).copy(
                name = info.optString("name", tv.name), model = info.optString("model", tv.model),
                mac = info.optString("mac", "").ifBlank { tv.mac }, version = info.optString("version", tv.version),
            )
            if (t != tv || t.mac != tv.mac || t.model != tv.model || t.version != tv.version) saveTv(t)
            val open = info.optJSONObject("tivibro")?.optBoolean("open") == true
            setUi(tv.id) { it.copy(power = Power.ON, tivibroOpen = open) }
            if (open && backups.due(tv.id) && backingUp.add(tv.id)) viewModelScope.launch { try { runCatching { autoBackup(t) } } finally { backingUp.remove(tv.id) } }
            true
        } catch (e: TbException) {
            if (e.code == "unpaired") { setUi(tv.id) { it.copy(power = Power.UNPAIRED) }; true }
            else { setUi(tv.id) { if (it.power == Power.WAKING) it else it.copy(power = Power.OFF, tivibroOpen = false) }; false }
        } catch (e: Exception) {
            setUi(tv.id) { if (it.power == Power.WAKING) it else it.copy(power = Power.OFF, tivibroOpen = false) }
            false
        }
    }

    private fun tvsLatest(tv: Tv) = tv(tv.id) ?: tv

    /** Info, correcting this phone's idea of the TV's clock once if the TV says it is off. */
    private fun infoWithClock(tv: Tv) = try {
        TvClient(tv).info()
    } catch (e: TbException) {
        if (e.code != "clock") throw e
        val h = Pairing.hello(tv.host, tv.port)
        val fixed = tv.copy(offset = h.now - System.currentTimeMillis())
        saveTv(fixed)
        TvClient(fixed).info()
    }

    /* ---------- actions ---------- */

    fun openTiviBro(id: String) = act(id, "Opening TiviBro…") { tv ->
        TvClient(tv).open()
        say("Opening TiviBro on ${tv.name}")
        delay(2500); check(tv)
    }

    /** Wake-on-LAN, then wait for the TV to answer (up to a minute). */
    fun wake(id: String) = viewModelScope.launch {
        val tv = tv(id) ?: return@launch
        if (tv.mac.isBlank()) { say("This TV hasn't told the app its network card yet.  Open it once while it's on."); return@launch }
        setUi(id) { it.copy(power = Power.WAKING) }
        val end = System.currentTimeMillis() + 60_000
        var on = false
        while (System.currentTimeMillis() < end && !on) {
            withContext(Dispatchers.IO) { runCatching { Wol.wake(tv.mac, tv.host) } }
            delay(3000)
            on = withContext(Dispatchers.IO) { runCatching { Pairing.hello(tv.host, tv.port, 1500); true }.getOrDefault(false) }
        }
        setUi(id) { it.copy(power = Power.CHECKING) }
        if (on) { check(tv(id) ?: tv); say("${tv.name} is on") }
        else { setUi(id) { it.copy(power = Power.OFF) }; say("${tv.name} didn't answer.  Is Turn on via Wi-Fi on in the TV's settings?") }
    }

    fun forget(id: String) = viewModelScope.launch {
        val tv = tv(id) ?: return@launch
        withContext(Dispatchers.IO) { runCatching { TvClient(tv, 3000).forget() } }
        store.remove(id)
        if (store.tileTv == id) store.tileTv = null
        backups.forget(id)
        _tvs.update { l -> l.filterNot { it.tv.id == id } }
        say("${tv.name} removed")
    }

    private fun act(id: String, label: String, block: suspend (Tv) -> Unit) = viewModelScope.launch {
        val tv = tv(id) ?: return@launch
        setUi(id) { it.copy(busy = label) }
        try { withContext(Dispatchers.IO) { block(tv) } }
        catch (e: TbException) { say(e.message ?: "Something went wrong") }
        catch (e: Exception) { say("${tv.name} didn't answer.  Is it on, and on the same network?") }
        finally { setUi(id) { it.copy(busy = null) } }
    }

    /* ---------- the web editor ---------- */

    /** The editor's address for this phone: asks until TiviBro has started it (up to about a minute). */
    suspend fun editorUrl(id: String, progress: (String) -> Unit): String = withContext(Dispatchers.IO) {
        val tv = tv(id) ?: throw TbException("This TV is no longer paired.")
        val end = System.currentTimeMillis() + 60_000
        var url: String? = null
        while (url == null) {
            when (val s = TvClient(tv).editor()) {
                is EditorState.Ready -> {
                    if (!editorUrlOk(s.url, tv)) throw TbException("The TV sent an editor address this app doesn't trust.")
                    url = s.url
                }
                is EditorState.Starting -> {
                    withContext(Dispatchers.Main) { progress(s.message) }
                    if (System.currentTimeMillis() > end) throw TbException("TiviBro didn't start the editor.  Is TiviBro open on the TV?")
                    delay(2000)
                }
            }
        }
        url!!
    }

    /* ---------- the remote and Play on TV ---------- */

    private val _now = MutableStateFlow<NowState?>(null)
    val nowState: StateFlow<NowState?> = _now.asStateFlow()
    private val _lineup = MutableStateFlow<Lineup?>(null)
    val lineup: StateFlow<Lineup?> = _lineup.asStateFlow()
    /** "" while there is a list or it is loading, "closed" when TiviBro is closed, "none" when the TV didn't send one. */
    private val _lineupNote = MutableStateFlow("")
    val lineupNote: StateFlow<String> = _lineupNote.asStateFlow()
    private val _volume = MutableStateFlow<Volume?>(null)
    val volume: StateFlow<Volume?> = _volume.asStateFlow()
    private var lineupFor = ""

    // Presses go out one at a time, in order, however fast they are tapped.
    private val presses = Channel<suspend () -> Unit>(64)
    init {
        viewModelScope.launch(Dispatchers.IO) {
            for (p in presses) {
                try { p() }
                catch (e: TbException) { say(e.message ?: "The TV said no") }
                catch (e: Exception) { say("The TV didn't answer.  Is it on, and on the same network?") }
            }
        }
    }
    private fun press(id: String, block: TvClient.() -> Unit) {
        val tv = tv(id) ?: return
        presses.trySend { TvClient(tv, 5000).block() }
    }
    fun key(id: String, k: String) = press(id) { key(k) }
    fun action(id: String, a: String) = press(id) { action(a) }
    fun text(id: String, t: String) = press(id) { text(t) }
    fun playOnTv(id: String, k: String, name: String) {
        val tv = tv(id) ?: return
        presses.trySend { TvClient(tv, 5000).play(k); say("Playing $name on ${tv.name}") }
    }
    fun volume(id: String, dir: String) {
        val tv = tv(id) ?: return
        presses.trySend { _volume.value = TvClient(tv, 5000).volume(dir) }
    }

    /** Follows what the TV shows while the remote screen is open (the TV answers when it changes). */
    suspend fun watchState(id: String) = withContext(Dispatchers.IO) {
        _now.value = null
        var rev = -1
        while (isActive) {
            val tv = tv(id) ?: break
            try {
                val st = TvClient(tv, 26_000).state(maxOf(rev, 0), rev >= 0)
                _now.value = st; rev = st.rev
            } catch (e: Exception) {
                rev = -1
                delay(3000)
            }
        }
    }

    /** The TV's channel list, for Play on TV.  TiviBro sends it when asked; this waits a few seconds for it. */
    fun loadLineup(id: String, force: Boolean = false) = viewModelScope.launch(Dispatchers.IO) {
        val tv = tv(id) ?: return@launch
        if (lineupFor != id) { _lineup.value = null; lineupFor = id }
        _lineupNote.value = ""
        for (i in 0 until 25) {
            try {
                val j = TvClient(tv, 15_000).lineup(if (force) 0 else _lineup.value?.rev ?: 0)
                Lineup.from(j)?.let { _lineup.value = it }
                if (j.optBoolean("closed") && _lineup.value == null) { _lineupNote.value = "closed"; return@launch }
                if (!j.optBoolean("pending") && (_lineup.value != null || j.optBoolean("same"))) return@launch
            } catch (e: Exception) { }
            delay(1200)
        }
        if (_lineup.value == null) _lineupNote.value = "none"
    }

    /* ---------- questions for TiviBro (POST /v1/ask) ---------- */

    /** Asks TiviBro on the TV and returns its answer.  While TiviBro is still opening, asks again a few times. */
    suspend fun ask(id: String, what: String, args: JSONObject = JSONObject(), seal: Boolean = false, timeoutMs: Int = 45_000, tries: Int = 3): JSONObject = withContext(Dispatchers.IO) {
        val tv = tv(id) ?: throw TbException("This TV is no longer paired.")
        repeat(tries) { i ->
            val r = TvClient(tv, timeoutMs).ask(what, args, seal)
            if (!r.optBoolean("pending")) return@withContext r.optJSONObject("data") ?: JSONObject()
            if (i < tries - 1) delay(1200)
        }
        throw TbException("TiviBro on the TV didn't answer in time.  Is it open?")
    }

    /** A page of the guide.  Rows whose guide the TV is still loading are asked for again. */
    suspend fun guide(id: String, group: String, at: Long?, offset: Int, limit: Int = 60): GuidePage {
        fun args() = JSONObject().put("group", group).put("offset", offset).put("limit", limit).apply { if (at != null) put("at", at) }
        var page = GuidePage.from(ask(id, "guide", args()))
        for (i in 0 until 4) {
            if (page.pending == 0) break
            delay(1500)
            val again = GuidePage.from(ask(id, "guide", args()))
            page = again.copy(rows = again.rows.mapIndexed { n, r -> if (r.progs == null) page.rows.getOrNull(n)?.takeIf { it.key == r.key && it.progs != null } ?: r else r })
        }
        return page
    }

    suspend fun schedule(id: String, k: String): Schedule {
        var s = Schedule.from(ask(id, "schedule", JSONObject().put("k", k)))
        for (i in 0 until 4) {
            if (!s.pending && !s.descPending) break
            delay(1500)
            s = Schedule.from(ask(id, "schedule", JSONObject().put("k", k)))
        }
        return s
    }

    suspend fun remind(id: String, k: String, start: Long, on: Boolean): Boolean =
        ask(id, "remind", JSONObject().put("k", k).put("s", start).put("on", on), tries = 1).optBoolean("on")

    /** A favorite on or off.  The channel list here follows at once; the TV sends its own after. */
    fun favorite(id: String, k: String, on: Boolean) = viewModelScope.launch {
        _lineup.value = _lineup.value?.let { l ->
            l.copy(channels = l.channels.map { if (it.k == k) it.copy(fav = on) else it },
                groups = l.groups.map { g -> if (g.id == "c_fav") g.copy(keys = if (on) (g.keys - k) + k else g.keys - k) else g })
        }
        try {
            val now = ask(id, "fav", JSONObject().put("k", k).put("on", on), tries = 1).optBoolean("on")
            say(if (now) "Added to Favorites on the TV" else "Removed from Favorites")
        } catch (e: TbException) { say(e.message ?: "The TV said no") }
        catch (e: Exception) { say("The TV didn't answer.  Is it on, and on the same network?") }
    }

    suspend fun vodCats(id: String, kind: String): List<VodCat>? {
        val j = ask(id, "vodcats", JSONObject().put("kind", kind), timeoutMs = 100_000)
        if (j.optBoolean("none")) return null
        val a = j.optJSONArray("cats") ?: return emptyList()
        return (0 until a.length()).map { a.getJSONObject(it) }.map { VodCat(it.optString("id"), it.optString("n"), it.optInt("count"), it.optInt("locked") == 1) }
    }

    suspend fun vodItems(id: String, kind: String, cat: String, q: String, offset: Int): VodPage =
        VodPage.from(ask(id, "voditems", JSONObject().put("kind", kind).put("cat", cat).put("q", q).put("offset", offset).put("limit", 90), timeoutMs = 100_000))

    suspend fun vodInfo(id: String, kind: String, itemId: String): VodInfo = VodInfo.from(ask(id, "vodinfo", JSONObject().put("kind", kind).put("id", itemId)))

    fun vodPlay(id: String, kind: String, itemId: String, ep: String?, fromStart: Boolean) = viewModelScope.launch {
        val tv = tv(id) ?: return@launch
        try {
            val r = ask(id, "vodplay", JSONObject().put("kind", kind).put("id", itemId).put("ep", ep ?: JSONObject.NULL).put("fromStart", fromStart), tries = 1)
            say("Playing ${r.optString("title", "it")} on ${tv.name}")
        } catch (e: TbException) { say(e.message ?: "The TV said no") }
        catch (e: Exception) { say("The TV didn't answer.  Is it on, and on the same network?") }
    }

    /** Typing on the phone into a box on the TV's screen.  Sealed: it may be a password. */
    fun typeInto(id: String, input: Int, value: String, submit: Boolean = false) {
        val tv = tv(id) ?: return
        presses.trySend { TvClient(tv, 8000).ask("input", JSONObject().put("id", input).put("value", value).put("submit", submit), seal = true) }
    }

    /** A provider link shared to the app: added on the TV like the web editor's Add a playlist.  Sealed: it holds the login. */
    suspend fun addPlaylist(id: String, link: String, name: String, use: Boolean): String =
        ask(id, "playlist", JSONObject().put("link", link).put("name", name).put("use", use), seal = true, timeoutMs = 140_000, tries = 1).optString("msg", "Added")

    /* ---------- backups ---------- */

    private val backingUp = java.util.Collections.synchronizedSet(mutableSetOf<String>())
    private suspend fun autoBackup(tv: Tv) = withContext(Dispatchers.IO) {
        val r = TvClient(tv, 60_000).ask("backup", seal = true, noOpen = true)
        r.optJSONObject("data")?.optJSONObject("backup")?.let { backups.save(tv.id, it, auto = true) }
    }

    suspend fun backupNow(id: String): SavedBackup = withContext(Dispatchers.IO) {
        val b = ask(id, "backup", seal = true, timeoutMs = 60_000).optJSONObject("backup") ?: throw TbException("The TV sent no backup.")
        backups.save(id, b, auto = false)
    }

    /** Puts a backup back on a TV (this one or another).  TiviBro restarts there. */
    suspend fun restore(toId: String, b: SavedBackup): String = withContext(Dispatchers.IO) {
        val r = ask(toId, "restore", JSONObject().put("backup", backups.open(b)), seal = true, timeoutMs = 90_000, tries = 1)
        "Restored ${r.optInt("playlists")} playlist(s).  TiviBro is restarting on the TV."
    }

    /** A copy the web editor can restore on any TV, sealed with a passphrase. */
    suspend fun exportBackup(b: SavedBackup, pass: String, out: android.net.Uri) = withContext(Dispatchers.IO) {
        val file = BackupFile.seal(backups.open(b), pass)
        getApplication<Application>().contentResolver.openOutputStream(out)?.use { it.write(file.toString().toByteArray(Charsets.UTF_8)) } ?: throw TbException("Couldn't write the file.")
    }

    /* ---------- adding a TV ---------- */

    fun discover() = viewModelScope.launch {
        _found.value = null
        _found.value = withContext(Dispatchers.IO) { runCatching { Discovery.find(2000) }.getOrDefault(emptyList()) }
    }

    suspend fun helloAt(host: String, port: Int): Hello = withContext(Dispatchers.IO) { Pairing.hello(host, port) }

    fun resetPairing() { _pair.value = Pairing0() }

    fun pairWithLink(text: String?) {
        val l = PairLink.parse(text)
        if (l == null) { say("That isn't a TiviBro pairing code.  On the TV: Settings, Phone app, Pair a phone."); return }
        pair(l.host, l.port, l.code, l.id)
    }

    fun pair(host: String, port: Int, code: String, expectId: String?) = viewModelScope.launch {
        _pair.value = Pairing0(busy = true)
        try {
            val tv = withContext(Dispatchers.IO) { Pairing.pair(host, port, code, phoneName, phoneModel, expectId) }
            store.upsert(tv)
            _tvs.update { l -> l.filterNot { it.tv.id == tv.id } + TvUi(tv) }
            _pair.value = Pairing0(done = tv)
            say("Paired with ${tv.name}")
            check(tv)
        } catch (e: TbException) {
            _pair.value = Pairing0(error = e.message)
        } catch (e: Exception) {
            _pair.value = Pairing0(error = "Couldn't reach the TV at $host.  Are the phone and the TV on the same network?")
        }
    }
}
