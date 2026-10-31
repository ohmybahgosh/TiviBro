package app.tivibro.phone.ui

import android.app.Application
import android.os.Build
import android.provider.Settings
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.tivibro.phone.data.TvStore
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
