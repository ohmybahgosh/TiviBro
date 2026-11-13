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
import app.tivibro.phone.ble.BleWaker
import app.tivibro.phone.ble.BleWatcher
import app.tivibro.phone.ble.WakeLog
import app.tivibro.phone.proto.TvSeen
import app.tivibro.phone.data.BackupStore
import app.tivibro.phone.data.BackupTools
import app.tivibro.phone.data.EditorCopies
import app.tivibro.phone.data.SavedBackup
import app.tivibro.phone.data.TvStore
import app.tivibro.phone.proto.BleWake
import app.tivibro.phone.proto.ChanEdit
import app.tivibro.phone.proto.BackupFile
import app.tivibro.phone.proto.GuidePage
import app.tivibro.phone.proto.Schedule
import app.tivibro.phone.proto.VisList
import app.tivibro.phone.proto.OnNow
import app.tivibro.phone.proto.VodCat
import app.tivibro.phone.proto.VodInfo
import app.tivibro.phone.proto.VodPage
import org.json.JSONObject
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.Job
import app.tivibro.phone.proto.Discovery
import app.tivibro.phone.proto.Dropbox
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
import app.tivibro.phone.proto.Reminder
import app.tivibro.phone.proto.RestorePoint
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

/** STARTING: the TV is on (its own network service answers) but TiviBro's connection isn't up yet, as for a minute
 *  or so after the TV turns on, before TiviBro has been opened. */
enum class Power { CHECKING, ON, STARTING, OFF, WAKING, UNPAIRED }

data class TvUi(
    val tv: Tv,
    val power: Power = Power.CHECKING,
    val tivibroOpen: Boolean = false,
    val busy: String? = null,
    /** What TiviBro on the TV said it has (movies, shows, My media, On now), for the home screen's shortcuts; null until known. */
    val caps: NowState? = null,
)

/** A Dropbox sign-in for one TV: [stage] is waiting (the browser is open, [url]), exchanging, ready (pick a folder) or failed ([error]). */
data class DropboxStep(val tv: String, val stage: String, val error: String? = null, val url: String = "")

/** How long a Dropbox sign-in may take in the browser. */
private const val DROPBOX_WAIT_MS = 10 * 60_000L
/** Turn on: how long to look for a TV woken over Bluetooth on the network.  From fully off, with a USB network
    adapter (LG-USB-2-ETH0), a TV can take two minutes or more to join the network. */
private const val WAKE_LONG_MS = 180_000L

data class Pairing0(val busy: Boolean = false, val error: String? = null, val done: Tv? = null)

/** LG's own network service (the one LG's apps use to control the TV) answers on 3000 or 3001 whenever the TV is on,
 *  TiviBro or not: how the app tells "on, TiviBro's connection not up yet" from "off". */
object LgPorts {
    fun up(host: String, timeoutMs: Int = 800): Boolean = listOf(3001, 3000).any { p ->
        runCatching { java.net.Socket().use { it.connect(java.net.InetSocketAddress(host, p), timeoutMs) }; true }.getOrDefault(false)
    }
}

class AppModel(app: Application) : AndroidViewModel(app) {
    private val store = TvStore(app)
    val backups = BackupStore(app)
    val copies = EditorCopies(app)
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

    /* ---------- the phone's own network ---------- */

    private val conn = app.getSystemService(ConnectivityManager::class.java)
    private var netCheck: Job? = null
    /** Wi-Fi or Ethernet: the way the phone reaches its TVs (not mobile data). */
    private fun onLan(n: Network?): Boolean = runCatching {
        val cm = conn ?: return@runCatching true
        val c = cm.getNetworkCapabilities(n ?: cm.activeNetwork) ?: return@runCatching false
        c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || c.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    }.getOrDefault(true)
    /** Android calls onAvailable once at once for the network the phone is already on: that one is skipped. */
    @Volatile private var netSeen = false
    /** When the phone gets back on Wi-Fi (after a Turn on with Wi-Fi off, say), ask the TVs again at once
     *  rather than waiting for the next check. */
    private val netCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            if (!netSeen) { netSeen = true; return }
            if (!onLan(network)) return
            netCheck?.cancel()
            netCheck = viewModelScope.launch { delay(1500); refresh() }
        }
    }
    init {
        // No network now: the first onAvailable is a real change, so it isn't skipped.
        netSeen = runCatching { conn?.activeNetwork == null }.getOrDefault(false)
        runCatching { conn?.registerDefaultNetworkCallback(netCallback) }
    }
    override fun onCleared() {
        runCatching { conn?.unregisterNetworkCallback(netCallback) }
        super.onCleared()
    }
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
            val was = tvsLatest(tv)
            // The TV's Bluetooth address, for Turn on over Bluetooth; another address means registering again.
            val bt = info.optString("bt", "").lowercase().takeIf { BleWake.isAddress(it) } ?: was.bt
            val t = was.copy(
                name = info.optString("name", tv.name), model = info.optString("model", tv.model),
                mac = info.optString("mac", "").ifBlank { tv.mac }, version = info.optString("version", tv.version),
                macs = Tv.macList(info.optJSONArray("macs")).ifEmpty { tv.macs },
                bt = bt, bleRegistered = was.bleRegistered && bt == was.bt,
            )
            if (t != tv || t.mac != tv.mac || t.macs != tv.macs || t.model != tv.model || t.version != tv.version || t.bt != tv.bt || t.bleRegistered != tv.bleRegistered) saveTv(t)
            if (bt != was.bt) bleChecked.remove(tv.id)
            // Bluetooth advertising not switched off on the TV: make sure this phone may wake it over Bluetooth.
            if (t.bt.isNotBlank() && !(info.has("woble") && !info.optBoolean("woble", true))) bleRegister(t)
            val open = info.optJSONObject("tivibro")?.optBoolean("open") == true
            // What TiviBro has, for the shortcuts (one quick look, only while it is open).
            val caps = if (open) runCatching { TvClient(t, 4000).state(0, false) }.getOrNull()?.takeIf { it.open } else null
            setUi(tv.id) { it.copy(power = Power.ON, tivibroOpen = open, caps = caps ?: it.caps) }
            if (open && backups.due(tv.id) && backingUp.add(tv.id)) viewModelScope.launch { try { runCatching { autoBackup(t) } } finally { backingUp.remove(tv.id) } }
            true
        } catch (e: TbException) {
            if (e.code == "unpaired") { setUi(tv.id) { it.copy(power = Power.UNPAIRED) }; true }
            else { setUi(tv.id) { if (it.power == Power.WAKING) it else it.copy(power = Power.OFF, tivibroOpen = false) }; false }
        } catch (e: Exception) {
            val tvUp = LgPorts.up(tv.host)
            setUi(tv.id) { if (it.power == Power.WAKING) it else it.copy(power = if (tvUp) Power.STARTING else Power.OFF, tivibroOpen = false) }
            if (tvUp) soon(tv.id)
            false
        }
    }
    /** A TV that is on with TiviBro's connection still starting: looked at every 5 s for two minutes, not every 15. */
    private val soonFor = java.util.concurrent.ConcurrentHashMap<String, Long>()
    private fun soon(id: String) {
        val now = System.currentTimeMillis()
        if ((soonFor[id] ?: 0L) > now) return
        soonFor[id] = now + 120_000
        viewModelScope.launch {
            while (System.currentTimeMillis() < (soonFor[id] ?: 0L)) {
                delay(5000)
                val u = _tvs.value.firstOrNull { it.tv.id == id } ?: break
                if (u.power != Power.STARTING) break
                check(u.tv)
            }
            soonFor.remove(id)
        }
    }

    private fun tvsLatest(tv: Tv) = tv(tv.id) ?: tv

    /* ---------- Turn on over Bluetooth (ble/BleWaker.kt, service/blewake.js) ---------- */

    private val bleChecked = java.util.Collections.synchronizedSet(mutableSetOf<String>())

    /**
     * Registers this phone's wake address with the TV, quietly, once a session per TV: a TV that says it
     * already has it is asked whether it still does, and registered again if not.  A TV that answered (even
     * with no, or an older TiviBro without Bluetooth waking) is not asked again until the app restarts; one that
     * didn't answer is asked at the next check.
     */
    private fun bleRegister(tv: Tv) {
        if (!bleChecked.add(tv.id)) return
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val addr = BleWaker.address(getApplication<Application>())
                val c = TvClient(tv, 5000)
                var registered = tv.bleRegistered && c.blewake("status", addr).optBoolean("registered")
                if (!registered) {
                    val r = c.blewake("register", addr)
                    registered = r.optBoolean("registered")
                    android.util.Log.i("TiviBroBle", "Registered with ${tv.name}: $registered (${r.optString("msg")})")
                }
                val now = tv(tv.id) ?: return@launch
                if (now.bleRegistered != registered && now.bt == tv.bt) saveTv(now.copy(bleRegistered = registered))
            } catch (e: TbException) {
                android.util.Log.w("TiviBroBle", "${tv.name} said no: ${e.message}")
            } catch (e: Exception) {
                bleChecked.remove(tv.id)
            }
        }
    }

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

    /**
     * Wake-on-LAN and, when the TV has told the app its Bluetooth address, LG's Bluetooth wake packet at the
     * same time (as ThinQ does), then wait for the TV to answer (up to a minute).  The Bluetooth permission is
     * asked by the activity before this; without it, or with Bluetooth off, only Wake-on-LAN runs.
     */
    fun wake(id: String) = viewModelScope.launch {
        val tv = tv(id) ?: return@launch
        if (!tv.canWake()) { say("This TV hasn't told the app its network card yet.  Open it once while it's on."); return@launch }
        setUi(id) { it.copy(power = Power.WAKING) }
        val app = getApplication<Application>()
        val log = WakeLog(tv.name)
        val lan = onLan(null)
        val ble = if (tv.bt.isNotBlank()) withContext(Dispatchers.IO) { BleWaker.start(app, tv.bt) } else null
        log.add("Turn on.  Phone on Wi-Fi: ${if (lan) "yes" else "no"}.  Bluetooth wake: ${ble?.result ?: "no Bluetooth address for this TV"}.")
        if (ble != null) android.util.Log.i("TiviBroBle", "Turn on ${tv.name} over Bluetooth: ${ble.result}")
        if (ble?.result == BleWaker.Start.OFF) say("Turn on Bluetooth on the phone to wake the TV over Bluetooth too.")
        // Watching for the TV's own advertisement: tells the TV came on when Wi-Fi can't (the phone isn't on it).
        val seen = TvSeen()
        val bleOn = java.util.concurrent.atomic.AtomicBoolean(false)
        val watch = if (tv.bt.isNotBlank()) BleWatcher.start(app, tv.bt) { rssi, data ->
            val at = log.ms()
            val ad = BleWake.parseAdvert(data)
            log.advert(at, rssi, BleWake.hex(data), ad)
            if (seen.saw(ad) && bleOn.compareAndSet(false, true)) log.add("Counts as on: ${seen.why}.")
        } else null
        if (watch != null) log.add("Watching for the TV over Bluetooth: ${watch.result}.")
        var on = false; var tvUp = false
        var host = tv.host; var port = tv.port
        try {
            val start = System.currentTimeMillis()
            val bleEnd = start + BleWake.ADVERTISE_MS
            /* A TV woken over Bluetooth from fully off starts from scratch, and a USB network adapter
               (LG-USB-2-ETH0) only comes up after that: it can take two minutes or more to answer on the
               network.  So after the minute of Bluetooth wake, keep looking for it a while longer, and by
               discovery too, in case it came back on another address. */
            val end = start + if (ble?.result == BleWaker.Start.STARTED || tv.bt.isNotBlank()) WAKE_LONG_MS else BleWake.ADVERTISE_MS
            var nextWol = 0L; var nextFind = start + 20_000; var bleStopped = false
            while (System.currentTimeMillis() < end && !on) {
                val now = System.currentTimeMillis()
                if (!bleStopped && now >= bleEnd) { ble?.stop(); bleStopped = true; log.add("Bluetooth wake sent for a minute; still looking for the TV on the network.") }
                if (now >= nextWol) {
                    if (tv.wakeMacs().isNotEmpty()) withContext(Dispatchers.IO) { runCatching { Wol.wakeAll(tv.wakeMacs(), host) } }
                    nextWol = now + 3000
                }
                delay(1000)
                // Without Wi-Fi, the TV's Bluetooth advertisement is the only sign it came on.
                if (bleOn.get() && !onLan(null)) break
                if (System.currentTimeMillis() >= nextWol - 500) on = withContext(Dispatchers.IO) { runCatching { Pairing.hello(host, port, 1500); true }.getOrDefault(false) }
                // The TV itself is up (LG's own service answers) while TiviBro's connection is still starting.
                if (!on && !tvUp && withContext(Dispatchers.IO) { LgPorts.up(host) }) { tvUp = true; log.add("The TV is on; waiting for TiviBro's connection."); setUi(id) { it.copy(power = Power.STARTING) } }
                if (!on && System.currentTimeMillis() >= nextFind && onLan(null)) {
                    nextFind = System.currentTimeMillis() + 10_000
                    val f = withContext(Dispatchers.IO) { runCatching { Discovery.find(1500) }.getOrDefault(emptyList()) }.firstOrNull { it.id == tv.id }
                    if (f != null) {
                        if (f.host != host || f.port != port) { log.add("Found the TV at a new address."); host = f.host; port = f.port; saveTv((tv(id) ?: tv).copy(host = host, port = port)) }
                        on = true
                    }
                }
            }
            log.add("Waited ${(System.currentTimeMillis() - start) / 1000} s.")
        } finally {
            ble?.stop()
            log.add(if (on) "The TV answered over Wi-Fi." else "Stopped the Bluetooth wake.")
            // Keep listening a little longer, to see what the TV sends once it is up (for the log).
            if (watch != null) viewModelScope.launch { delay(15_000); watch.stop(); log.add("Stopped watching."); log.save(app) }
            else log.save(app)
        }
        setUi(id) { it.copy(power = Power.CHECKING) }
        if (on) { check(tv(id) ?: tv); say("${tv.name} is on") }
        else if (bleOn.get() && !onLan(null)) {
            setUi(id) { it.copy(power = Power.OFF) }
            say("${tv.name} is on (the phone saw it over Bluetooth).  Turn on Wi-Fi on the phone to use it.")
        }
        else if (!onLan(null) && ble?.result == BleWaker.Start.STARTED) {
            // Without Wi-Fi, and not seen over Bluetooth either: the phone can't tell whether the wake worked.
            setUi(id) { it.copy(power = Power.OFF) }
            say("Sent the Bluetooth wake to ${tv.name}.  The phone isn't on Wi-Fi, so it can't see the TV: turn Wi-Fi on to check.")
        }
        else if (tvUp) {
            setUi(id) { it.copy(power = Power.STARTING) }
            soon(id)
            say("${tv.name} is on.  TiviBro's connection is still starting; opening TiviBro on the TV brings it at once.")
        }
        else {
            setUi(id) { it.copy(power = Power.OFF) }
            say(if (tv.bt.isNotBlank()) "${tv.name} didn't answer.  Is Turn on via Wi-Fi on, and Bluetooth on the phone?"
                else "${tv.name} didn't answer.  Is Turn on via Wi-Fi on in the TV's settings?")
        }
    }

    /** The last Bluetooth wake's log (WakeLog), for the TV card's menu.  Empty when there is none yet. */
    fun bleLog(): String = WakeLog.last(getApplication<Application>())

    /** Listens for the TV over Bluetooth for 20 seconds without waking it, into the Bluetooth log (to see what it sends while off). */
    fun bleListen(id: String) = viewModelScope.launch {
        val tv = tv(id) ?: return@launch
        if (tv.bt.isBlank()) { say("This TV hasn't told the app its Bluetooth address yet.  Open the app once while the TV is on."); return@launch }
        val app = getApplication<Application>()
        val log = WakeLog(tv.name)
        log.add("Listening for 20 seconds, without waking the TV.  Phone on Wi-Fi: ${if (onLan(null)) "yes" else "no"}.")
        val watch = BleWatcher.start(app, tv.bt) { rssi, data -> log.advert(log.ms(), rssi, BleWake.hex(data), BleWake.parseAdvert(data)) }
        log.add("Watching: ${watch.result}.")
        if (watch.result != BleWaker.Start.STARTED) {
            log.save(app)
            say(when (watch.result) {
                BleWaker.Start.NOT_ALLOWED -> "The app isn't allowed to use Bluetooth.  Allow Nearby devices for TiviBro in Android's settings."
                BleWaker.Start.OFF -> "Turn on Bluetooth on the phone first."
                else -> "This phone can't listen for the TV over Bluetooth."
            })
            return@launch
        }
        say("Listening for ${tv.name} for 20 seconds…")
        delay(20_000)
        watch.stop()
        log.add("Done.")
        log.save(app)
        say("Done.  Open the Bluetooth log to see what the TV sent.")
    }

    fun forget(id: String) = viewModelScope.launch {
        val tv = tv(id) ?: return@launch
        withContext(Dispatchers.IO) {
            // Best effort: this phone's Bluetooth wake address off the TV's list, then the pairing.
            if (tv.bleRegistered) runCatching { TvClient(tv, 3000).blewake("unregister", BleWaker.address(getApplication<Application>())) }
            runCatching { TvClient(tv, 3000).forget() }
        }
        store.remove(id)
        if (store.tileTv == id) store.tileTv = null
        backups.forget(id)
        copies.forget(id)
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
        var asked = 0
        while (isActive) {
            val tv = tv(id) ?: break
            try {
                val st = TvClient(tv, 26_000).state(maxOf(rev, 0), rev >= 0)
                _now.value = st; rev = st.rev
                // The TV sent a new channel list (something hidden, shown again or renamed there, or in the
                // web editor): the one here follows, if it has one to replace.
                val l = _lineup.value
                if (st.lineupRev > 0 && l != null && lineupFor == id && l.rev != st.lineupRev && asked != st.lineupRev) { asked = st.lineupRev; loadLineup(id) }
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
        var busy = false
        repeat(tries) { i ->
            val r = TvClient(tv, timeoutMs).ask(what, args, seal)
            if (!r.optBoolean("pending")) return@withContext r.optJSONObject("data") ?: JSONObject()
            busy = r.optBoolean("busy")
            if (i < tries - 1) delay(1200)
        }
        throw TbException(if (busy) "TiviBro on the TV is busy (a big playlist can take a few minutes).  Try again when it's done." else "TiviBro on the TV didn't answer in time.  Is it open?")
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

    /** One channel's details (op "info") or a change to it: hide, rename, group (in or out of one of your
        groups), newgroup.  After a change the channel list is fetched again. */
    suspend fun chanEdit(id: String, k: String, op: String, args: JSONObject = JSONObject()): ChanEdit {
        val r = ChanEdit.from(ask(id, "chan", args.put("k", k).put("op", op), tries = 1))
        if (op != "info") { if (r.msg.isNotBlank()) say(r.msg); loadLineup(id, true) }
        return r
    }

    /** Movies on now on the TV's channels (TMDB, with the TV's token). */
    suspend fun onNow(id: String): OnNow = OnNow.from(ask(id, "onnow", JSONObject(), timeoutMs = 25_000))

    /** Show or hide channels: the group's channels ([group] blank: the channel [k]'s own group). */
    suspend fun visList(id: String, group: String, k: String): VisList =
        VisList.from(ask(id, "vis", JSONObject().put("op", "list").put("group", group).put("k", k)))
    /** Saves the changes ({ key: shown }) and fetches the channel list again. */
    suspend fun visSave(id: String, group: String, changes: Map<String, Boolean>) {
        val ch = JSONObject(); changes.forEach { (k, v) -> ch.put(k, v) }
        val r = ask(id, "vis", JSONObject().put("op", "save").put("group", group).put("changes", ch), tries = 1)
        r.optString("msg").takeIf { it.isNotBlank() }?.let { say(it) }
        loadLineup(id, true)
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

    /** A playlist typed in on the phone (AddPlaylistDialog): a full [a] link, or type xtream (server, user,
        pass) or m3u (m3u), with name, epg and use.  Sealed: it holds the login. */
    suspend fun addPlaylistWith(id: String, a: JSONObject): String =
        ask(id, "playlist", a, seal = true, timeoutMs = 140_000, tries = 1).optString("msg", "Added")

    /* ---------- reminders and restore points on the TV ---------- */

    /** The reminders still to come ([op] list), or cancel one ([op] cancel, with [k] and [start]) or all ([op] clear).
        Returns what the TV said and the list after. */
    suspend fun reminders(id: String, op: String = "list", k: String = "", start: Long = 0): Pair<String, List<Reminder>> {
        val a = JSONObject().put("op", op)
        if (op == "cancel") a.put("k", k).put("s", start)
        val r = ask(id, "reminders", a, timeoutMs = if (op == "list") 25_000 else 20_000, tries = if (op == "list") 2 else 1)
        return r.optString("msg") to Reminder.list(r)
    }

    /** Restore points on the TV: [op] list, make (with a [name]), restore or delete (with the point's [pointId]). */
    suspend fun snaps(id: String, op: String = "list", name: String = "", pointId: String = ""): Pair<String, List<RestorePoint>> {
        val a = JSONObject().put("op", op)
        if (op == "make") a.put("name", name.trim().take(60))
        if (op == "restore" || op == "delete") a.put("id", pointId)
        val r = ask(id, "snaps", a, timeoutMs = if (op == "list") 25_000 else 40_000, tries = if (op == "list") 2 else 1)
        return r.optString("msg") to RestorePoint.list(r)
    }

    /* ---------- backups ---------- */

    private val backingUp = java.util.Collections.synchronizedSet(mutableSetOf<String>())
    private suspend fun autoBackup(tv: Tv) = withContext(Dispatchers.IO) {
        val r = TvClient(tv, 60_000).ask("backup", seal = true, noOpen = true)
        r.optJSONObject("data")?.optJSONObject("backup")?.let { backups.save(tv.id, it, auto = true) }
    }

    /** TiviBro's log from the TV (app and helper), as Report a problem makes it: names of providers and servers taken out. */
    suspend fun tvLog(id: String): String = ask(id, "logs", seal = true, timeoutMs = 45_000, tries = 2).optString("text")

    suspend fun backupNow(id: String): SavedBackup = withContext(Dispatchers.IO) {
        val b = ask(id, "backup", seal = true, timeoutMs = 60_000).optJSONObject("backup") ?: throw TbException("The TV sent no backup.")
        backups.save(id, b, auto = false)
    }

    /** Puts a backup back on a TV (this one or another).  TiviBro restarts there. */
    suspend fun restore(toId: String, b: SavedBackup): String = withContext(Dispatchers.IO) {
        val r = ask(toId, "restore", JSONObject().put("backup", backups.open(b)), seal = true, timeoutMs = 90_000, tries = 1)
        "Restored ${r.optInt("playlists")} playlist(s).  TiviBro is restarting on the TV."
    }

    /* ---------- backups on the phone, without the TV (discussion #23) ---------- */

    /** The web editor's channel list, kept for editing this TV's backups without the TV (EditorScreen KEEP).
     *  Says when a copy is saved, so you know the backups can be edited, or why it couldn't be. */
    fun editorKeeper(tvId: String) = object : app.tivibro.phone.ui.Keeper {
        override fun begin(meta: String) = copies.begin(tvId, meta)
        override fun part(chunk: String) = copies.part(chunk)
        override fun end(): Boolean {
            val c = copies.end() ?: return false
            say("${c.name}: channel list saved, so its backups can be edited on the phone without the TV")
            return true
        }
        override fun failed(why: String) { say("Couldn't save the channel list for editing without the TV ($why)") }
    }

    fun backupName(b: SavedBackup): String = b.label.ifBlank { java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT).format(java.util.Date(b.at)) }

    suspend fun duplicate(b: SavedBackup): SavedBackup = withContext(Dispatchers.IO) { backups.save(b.tvId, backups.open(b), auto = false, label = "Copy of " + backupName(b)) }

    suspend fun rename(b: SavedBackup, label: String) = withContext(Dispatchers.IO) { backups.rename(b, label) }

    /** [a] with the playlists from [b] it doesn't have.  Says how many came in. */
    suspend fun merge(a: SavedBackup, b: SavedBackup): Int = withContext(Dispatchers.IO) {
        val (out, added) = BackupTools.merge(backups.open(a), backups.open(b))
        if (added == 0) throw TbException("Nothing to add: ${backupName(a)} already has every playlist in ${backupName(b)}.")
        backups.save(a.tvId, out, auto = false, label = backupName(a) + " + " + backupName(b))
        added
    }

    fun openBackup(b: SavedBackup): JSONObject = backups.open(b)

    suspend fun withSettings(b: SavedBackup, values: Map<BackupTools.Choice, Any>, label: String): SavedBackup = withContext(Dispatchers.IO) {
        backups.save(b.tvId, BackupTools.withSettings(backups.open(b), values), auto = false, label = label)
    }

    /** What the offline editor starts from: the kept channel list (served to the page as a file) ... */
    fun offlineCopy(b: SavedBackup, pid: String): java.io.File = copies.file(b.tvId, pid)

    /** ... with the backup's edits and name rules for that playlist. */
    fun offlineExtras(b: SavedBackup, pid: String): String {
        val backup = backups.open(b)
        val pl = backup.optJSONObject("settings")?.optJSONArray("playlists")?.let { l -> (0 until l.length()).mapNotNull { l.optJSONObject(it) }.firstOrNull { it.optString("id") == pid } }
        return JSONObject().put("edits", backup.optJSONObject("edits")?.optJSONObject(pid) ?: JSONObject()).put("names", pl?.optJSONObject("names") ?: JSONObject.NULL).toString()
    }

    /** Each backup's playlists that can be edited on the phone (a channel list is kept for them), by name. */
    fun offlinePlaylists(b: SavedBackup): List<String> = runCatching {
        BackupTools.playlists(backups.open(b)).filter { copies.has(b.tvId, it.first) }.map { it.second }
    }.getOrDefault(emptyList())

    /** Changes made in the offline editor, kept as a new backup. */
    suspend fun keepEdited(b: SavedBackup, pid: String, saved: String, label: String): SavedBackup = withContext(Dispatchers.IO) {
        backups.save(b.tvId, BackupTools.withEdits(backups.open(b), pid, JSONObject(saved)), auto = false, label = label.ifBlank { "Edited on the phone" })
    }

    /** A copy the web editor can restore on any TV, sealed with a passphrase. */
    suspend fun exportBackup(b: SavedBackup, pass: String, out: android.net.Uri) = withContext(Dispatchers.IO) {
        val file = BackupFile.seal(backups.open(b), pass)
        getApplication<Application>().contentResolver.openOutputStream(out)?.use { it.write(file.toString().toByteArray(Charsets.UTF_8)) } ?: throw TbException("Couldn't write the file.")
    }

    /** A locked backup file of the TV as it is now (or, when the TV doesn't answer, of the newest backup on the phone). */
    suspend fun exportNow(id: String, pass: String, out: android.net.Uri): String = withContext(Dispatchers.IO) {
        val tv = tv(id) ?: throw TbException("This TV is no longer paired.")
        val fresh = runCatching { ask(id, "backup", seal = true, timeoutMs = 60_000, tries = 1).optJSONObject("backup") }.getOrNull()
        val newest = if (fresh == null) backups.list(id).firstOrNull() else null
        val b = fresh ?: newest?.let { backups.open(it) } ?: throw TbException("${tv.name} didn't answer, and there is no backup on this phone yet.  Turn the TV on and try again.")
        val file = BackupFile.seal(b, pass)
        getApplication<Application>().contentResolver.openOutputStream(out)?.use { it.write(file.toString().toByteArray(Charsets.UTF_8)) } ?: throw TbException("Couldn't write the file.")
        if (fresh != null) "Saved.  Keep the file and its passphrase somewhere safe."
        else "${tv.name} didn't answer, so the file holds the newest backup on this phone (${backupName(newest!!)})."
    }

    /** A backup file (from this app or the web editor) read from the phone's storage: null [pass] for a file
        that isn't locked.  Kept on the phone as a new backup of this TV, ready to restore. */
    suspend fun importFile(id: String, from: android.net.Uri, pass: String?): SavedBackup = withContext(Dispatchers.IO) {
        val j = readBackupFile(from)
        val b = BackupFile.open(j, pass.orEmpty())
        if (!BackupFile.isBackup(b) && b.optJSONObject("settings") == null) throw TbException("That file isn't a TiviBro backup.")
        backups.save(id, b, auto = false, label = "From a file")
    }

    /** Whether a backup file is locked with a passphrase.  Throws when it isn't a TiviBro backup at all. */
    suspend fun backupFileLocked(from: android.net.Uri): Boolean = withContext(Dispatchers.IO) {
        readBackupFile(from).optString("kind") == "backup-encrypted"
    }

    private fun readBackupFile(from: android.net.Uri): JSONObject {
        val text = getApplication<Application>().contentResolver.openInputStream(from)?.use { s ->
            val bytes = s.readBytes()
            if (bytes.size > 200 * 1024 * 1024) throw TbException("That file is too big to be a TiviBro backup.")
            String(bytes, Charsets.UTF_8)
        } ?: throw TbException("Couldn't read the file.")
        val j = runCatching { JSONObject(text) }.getOrNull()
        if (!BackupFile.isBackup(j)) throw TbException("That file isn't a TiviBro backup.")
        return j!!
    }

    /* ---------- adding a TV ---------- */

    /* ---------- Dropbox sign-in for My media (DropboxDialog in MediaSourcesDialogs.kt) ---------- */

    /** The sign-in's verifier, state and TV, kept briefly in case Android recreates the app while the browser is open. */
    private val dbxPrefs = app.getSharedPreferences("dropbox", android.content.Context.MODE_PRIVATE)
    private val _dropbox = MutableStateFlow<DropboxStep?>(null)
    val dropbox: StateFlow<DropboxStep?> = _dropbox.asStateFlow()
    /** The refresh token, only in memory, only from the code exchange until the TV has it.  Never logged. */
    private var dropboxToken: String? = null
    /** A media source was added outside the Settings page's own dialogs (the page reloads). */
    private val _mediaChanged = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val mediaChanged: SharedFlow<Unit> = _mediaChanged.asSharedFlow()

    /** Starts a Dropbox sign-in for [tvId]; returns Dropbox's sign-in page to open in the browser. */
    fun dropboxStart(tvId: String): String {
        val v = Dropbox.verifier()
        val st = Dropbox.state()
        dropboxToken = null
        dbxPrefs.edit().putString("verifier", v).putString("state", st).putString("tv", tvId).putLong("at", System.currentTimeMillis()).apply()
        val url = Dropbox.authorizeUrl(Dropbox.challenge(v), st)
        _dropbox.value = DropboxStep(tvId, "waiting", url = url)
        return url
    }

    /** Dropbox's redirect came back (the App Link, or the button on tivibro.app/dropbox). */
    fun dropboxRedirect(link: String) {
        val r = Dropbox.redirect(link) ?: return
        val verifier = dbxPrefs.getString("verifier", null)
        val state = dbxPrefs.getString("state", null)
        val tvId = dbxPrefs.getString("tv", null)
        val at = dbxPrefs.getLong("at", 0)
        // One use only: the same link opened twice (the App Link, then the page's button) does nothing more.
        if (verifier == null && _dropbox.value?.stage.let { it == "exchanging" || it == "ready" }) return
        dbxPrefs.edit().clear().apply()
        if (verifier == null || state == null || tvId == null || System.currentTimeMillis() - at > DROPBOX_WAIT_MS) {
            _dropbox.value = null
            say("That Dropbox sign-in is too old.  Start again: Settings, My media, Add media, Dropbox.")
            return
        }
        if (r.state != state) { _dropbox.value = DropboxStep(tvId, "failed", "That sign-in didn't start on this phone.  Try again."); return }
        if (r.error.isNotBlank() || r.code.isBlank()) { _dropbox.value = DropboxStep(tvId, "failed", Dropbox.redirectError(r.error)); return }
        _dropbox.value = DropboxStep(tvId, "exchanging")
        viewModelScope.launch {
            try {
                dropboxToken = withContext(Dispatchers.IO) { Dropbox.exchange(r.code, verifier) }
                _dropbox.value = DropboxStep(tvId, "ready")
            } catch (e: TbException) {
                _dropbox.value = DropboxStep(tvId, "failed", e.message)
            } catch (e: Exception) {
                _dropbox.value = DropboxStep(tvId, "failed", "Couldn't reach Dropbox.  Is the phone online?")
            }
        }
    }

    /** Asks the TV for the Dropbox folders in [path] ("" = the top), with the signed-in account's name. */
    suspend fun dropboxFolders(tvId: String, path: String): JSONObject {
        val t = dropboxToken ?: throw TbException("The Dropbox sign-in is gone.  Sign in again.")
        return ask(tvId, "mymedia", JSONObject().put("op", "dbfolders").put("refresh", t).put("path", path), seal = true, timeoutMs = 45_000, tries = 1)
    }

    /** Adds the chosen folder on the TV ("" = the whole Dropbox), which scans it.  Returns the TV's message. */
    suspend fun dropboxAdd(tvId: String, root: String, name: String): String {
        val t = dropboxToken ?: throw TbException("The Dropbox sign-in is gone.  Sign in again.")
        val r = ask(tvId, "mymedia", JSONObject().put("op", "adddropbox").put("refresh", t).put("root", root).put("name", name), seal = true, timeoutMs = 70_000, tries = 1)
        dropboxToken = null
        _mediaChanged.tryEmit(Unit)
        return r.optString("msg")
    }

    /** Ends the sign-in (done, cancelled or failed): forgets the token and the verifier. */
    fun dropboxEnd() {
        dropboxToken = null
        dbxPrefs.edit().clear().apply()
        _dropbox.value = null
    }

    fun discover() = viewModelScope.launch {
        _found.value = null
        _found.value = withContext(Dispatchers.IO) { runCatching { Discovery.find(2000) }.getOrDefault(emptyList()) }
    }

    suspend fun helloAt(host: String, port: Int): Hello = withContext(Dispatchers.IO) { Pairing.hello(host, port) }

    fun resetPairing() { _pair.value = Pairing0() }

    fun pairWithLink(text: String?) {
        val l = PairLink.parse(text)
        if (l == null) { say("That isn't a TiviBro pairing code.  On the TV: Settings, Phone app and web editor, Pair a phone."); return }
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
