/* The first screen: one TV at a time (the one used last), as a card: its state with a power button, what's on it
   now, a big Remote next to Guide, the other shortcuts it has (Shortcuts.kt) and its reminders coming up
   (HomeTv.kt).  With several TVs, swipe the card for the next one (dots under it) or tap the TV's name for a list of
   them all (Turn on, Open, Add a TV).  Its menu: the TV's address, the Quick Settings tile, Forget.  A TV that is off
   still offers Edit channels and its backups on the phone. */
package app.tivibro.phone.ui

import app.tivibro.phone.tr

import android.content.Intent
import android.net.Uri
import androidx.compose.ui.platform.LocalContext
import androidx.compose.runtime.LaunchedEffect
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import app.tivibro.phone.proto.AppUpdate
import app.tivibro.phone.proto.AppRelease
import app.tivibro.phone.update.UpdateStep
import app.tivibro.phone.update.Updater
import app.tivibro.phone.update.PlayUpdate
import androidx.compose.material3.LinearProgressIndicator
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Backup
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.FiberManualRecord
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.SportsFootball
import androidx.compose.material.icons.rounded.Theaters
import androidx.compose.material.icons.rounded.VideoLibrary
import androidx.compose.material.icons.rounded.Subscriptions
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.LinkOff
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.PowerSettingsNew
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.SettingsRemote
import androidx.compose.material.icons.rounded.Tv
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material.icons.rounded.Bluetooth
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.tivibro.phone.BuildConfig
import app.tivibro.phone.R
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    tvs: List<TvUi>,
    snack: SnackbarHostState,
    tileTv: String?,
    onRefresh: suspend () -> Unit,
    onAdd: () -> Unit,
    onScan: () -> Unit,
    onFind: () -> Unit,
    onEditor: (String) -> Unit,
    /** Opens one TV's screen on a tab (TvScreen's tab names: Remote, Guide, On now, Movies, Shows, My media, Settings). */
    onTab: (String, String) -> Unit,
    onReminders: (String) -> Unit,
    onOpen: (String) -> Unit,
    onWake: (String) -> Unit,
    onForget: (String) -> Unit,
    onTile: (String) -> Unit,
    onRepair: (String) -> Unit,
    onBackups: (String) -> Unit,
    /** Sets a TV's address by hand: its id and what was typed. */
    onAddress: (String, String) -> Unit = { _, _ -> },
    /** Turns a TV off (standby). */
    onOff: (String) -> Unit = {},
    /** The last Bluetooth wake's log (ble/WakeLog.kt), and listening for a TV for 20 seconds into it. */
    bleLog: () -> String = { "" },
    onBleListen: (String) -> Unit = {},
    /** The TV's recordings (RecordingsScreen.kt). */
    onRecordings: (String) -> Unit = {},
) {
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    // The app update: checked once per app start, and again from the App update tile.
    var rel by remember { mutableStateOf<AppRelease?>(null) }
    var relHidden by remember { mutableStateOf(false) }
    var checking by remember { mutableStateOf(false) }
    val current = remember { runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName }.getOrNull().orEmpty() }
    // The Play build leaves updates to Play (BuildConfig.SELF_UPDATE, app/build.gradle.kts).
    LaunchedEffect(Unit) { if (BuildConfig.SELF_UPDATE) rel = withContext(Dispatchers.IO) { AppUpdate.check(current) } }
    /* The Play build: Play installs the updates, but a test's updates often don't show in the Play Store by
       themselves.  Play is asked at start whether it has a newer one, and the card takes you to the listing.
       playNote: the card's line ("" when Play itself said so). */
    var playNew by remember { mutableStateOf(false) }
    var playNote by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { if (!BuildConfig.SELF_UPDATE && PlayUpdate.available(ctx) == true) { playNew = true; playNote = "" } }
    // The first start of a newer version (after Update now, or an APK installed by hand): what's new, once.
    var news by remember { mutableStateOf<Pair<String, List<String>>?>(null) }
    LaunchedEffect(Unit) {
        val prefs = ctx.getSharedPreferences("app", android.content.Context.MODE_PRIVATE)
        val last = prefs.getString("lastRun", null)
        val pi = runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0) }.getOrNull()
        val updated = pi != null && pi.lastUpdateTime > pi.firstInstallTime
        if (current.isNotBlank() && AppUpdate.justUpdated(last, current, updated)) {
            news = current to withContext(Dispatchers.IO) { AppUpdate.notesFor(current) }
        }
        // Marked as seen once shown (or when there is nothing to show), so a start cut short shows it next time.
        prefs.edit().putString("lastRun", current).apply()
    }
    news?.let { (v, lines) ->
        AlertDialog(
            onDismissRequest = { news = null },
            title = { Text(tr("What's new in TiviBro app {x}", "x" to v)) },
            text = {
                Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                    if (lines.isEmpty()) Text(tr("This version is installed.  Its notes are on the release page."), color = Muted)
                    lines.forEach { Text("•  $it", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(bottom = 8.dp)) }
                }
            },
            confirmButton = { TextButton(onClick = { news = null }) { Text("OK") } },
            containerColor = Panel,
        )
    }
    // About: the version, TiviBro's license and what the app is built with (THIRD-PARTY-NOTICES.md).
    var about by remember { mutableStateOf(false) }
    if (about) AboutDialog(current, onDismiss = { about = false }, onOpen = { url -> runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } })
    // One list per TV page (the update cards scroll back into view on the page showing).
    val lists = remember { mutableMapOf<String, androidx.compose.foundation.lazy.LazyListState>() }
    val prefs = remember { ctx.getSharedPreferences("app", android.content.Context.MODE_PRIVATE) }
    // The TV shown: the one used last.
    val pager = androidx.compose.foundation.pager.rememberPagerState(initialPage = tvs.indexOfFirst { it.tv.id == prefs.getString("homeTv", null) }.coerceAtLeast(0)) { tvs.size }
    LaunchedEffect(pager.currentPage, tvs.size) { tvs.getOrNull(pager.currentPage)?.let { prefs.edit().putString("homeTv", it.tv.id).apply() } }
    var switching by remember { mutableStateOf(false) }
    suspend fun toTop() { tvs.getOrNull(pager.currentPage)?.let { lists[it.tv.id]?.animateScrollToItem(0) } }
    fun checkNow() {
        if (checking) return
        checking = true
        scope.launch {
            val n = withContext(Dispatchers.IO) { AppUpdate.newest() }
            checking = false
            when {
                n == null -> snack.showSnackbar(tr("Couldn't reach GitHub to check.  Try again in a moment."))
                AppUpdate.key(current) != null && AppUpdate.newer(n.version, current) -> { rel = n; relHidden = false; toTop() }
                else -> snack.showSnackbar(tr("This is the newest TiviBro app ({x}).", "x" to current))
            }
        }
    }
    fun checkPlay() {
        if (checking) return
        checking = true
        scope.launch {
            val p = PlayUpdate.available(ctx)
            // Play couldn't say: GitHub's newest release, which reaches Google Play at the same time (it can take a while to show there).
            val gh = if (p == null) withContext(Dispatchers.IO) { AppUpdate.newest() } else null
            checking = false
            when {
                p == true -> { playNew = true; playNote = ""; relHidden = false; toTop() }
                p == null && gh != null && AppUpdate.key(current) != null && AppUpdate.newer(gh.version, current) -> {
                    playNew = true; relHidden = false
                    playNote = tr("Version {x} is out.  Google Play can take a little while to offer it.", "x" to gh.version)
                    toTop()
                }
                p == false -> snack.showSnackbar(tr("This is the newest TiviBro app on Google Play ({x}).", "x" to current))
                else -> PlayUpdate.open(ctx)
            }
        }
    }
    Scaffold(
        containerColor = Ink,
        topBar = {
            CenterAlignedTopAppBar(
                title = { Image(painterResource(R.drawable.wordmark), contentDescription = "TiviBro", modifier = Modifier.height(26.dp)) },
                actions = {
                    // One TV: Add a TV up here.  Several: it's in the list of TVs (tap the TV's name).
                    if (tvs.size == 1) IconButton(onClick = onAdd) { Icon(Icons.Rounded.Add, contentDescription = tr("Add a TV"), tint = Muted) }
                    IconButton(onClick = { about = true }) { Icon(Icons.Rounded.Info, contentDescription = tr("About and licenses"), tint = Muted) }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = Ink),
            )
        },
        snackbarHost = { SnackbarHost(snack) },
    ) { pad ->
        if (tvs.isEmpty()) {
            Empty(Modifier.padding(pad), onScan, onFind)
            return@Scaffold
        }
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { scope.launch { refreshing = true; onRefresh(); delay(400); refreshing = false } },
            modifier = Modifier.padding(pad).fillMaxSize(),
        ) {
            androidx.compose.foundation.pager.HorizontalPager(state = pager, key = { tvs[it].tv.id }, verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxSize()) { page ->
                val u = tvs[page]
                LazyColumn(state = lists.getOrPut(u.tv.id) { androidx.compose.foundation.lazy.LazyListState() }, contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 32.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.fillMaxSize()) {
                    item(key = "app-update") {
                        rel?.takeIf { !relHidden }?.let { AppUpdateCard(it) { relHidden = true } }
                        if (playNew && !relHidden) PlayUpdateCard(playNote, onOpen = { PlayUpdate.open(ctx) }) { relHidden = true }
                    }
                    item(key = "tv") {
                        TvCard(u, isTile = tileTv == u.tv.id && tvs.size > 1, onEditor, onTab, onReminders, onOpen, onWake, onForget, onTile, onRepair, onBackups,
                            bleLog = bleLog, onBleListen = onBleListen, onAddress = onAddress, onOff = onOff, onRecordings = onRecordings,
                            appUpdate = if (BuildConfig.SELF_UPDATE) AppUpdateTile(checking, rel != null && relHidden.not(), ::checkNow)
                                else AppUpdateTile(checking, playNew && relHidden.not(), ::checkPlay),
                            position = page, count = tvs.size, onSwitch = { switching = true })
                    }
                    if (tvs.size > 1) item(key = "dots") { PageDots(tvs.size, page) }
                    if (u.power == Power.ON) item(key = "soon") { ComingUp(u.tv.id) { onReminders(u.tv.id) } }
                }
            }
        }
    }
    if (switching) TvSwitchSheet(tvs, pager.currentPage,
        onPick = { i -> switching = false; scope.launch { pager.animateScrollToPage(i) } },
        onWake = onWake, onOpen = onOpen, onAdd = onAdd, onDismiss = { switching = false })
}

/* First run: no TV yet.  Three short steps, then the two ways to pair (scan the TV's code, or find it on
   the network), and a link for anyone who hasn't put TiviBro on the TV yet. */
@Composable
private fun Empty(modifier: Modifier, onScan: () -> Unit, onFind: () -> Unit) {
    val uri = androidx.compose.ui.platform.LocalUriHandler.current
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Box(Modifier.size(88.dp).clip(CircleShape).background(Panel2), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.Tv, null, tint = Accent, modifier = Modifier.size(44.dp))
        }
        Spacer(Modifier.height(20.dp))
        Text(tr("Welcome to TiviBro"), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text(tr("Your TV's remote, guide, sports and settings, on your phone."), style = MaterialTheme.typography.bodyMedium, color = Muted, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
        Spacer(Modifier.height(22.dp))
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Panel).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            listOf(
                tr("Open TiviBro on your TV") to tr("The phone and the TV need to be on the same Wi-Fi."),
                tr("Settings > Phone app and web editor") to tr("Then choose Pair the TiviBro app.  A code shows on the TV."),
                tr("Scan the code, or find the TV") to tr("Scanning is quickest.  Finding asks for the code shown on the TV."),
            ).forEachIndexed { n, (t, sub) ->
                Row(verticalAlignment = Alignment.Top) {
                    Box(Modifier.size(28.dp).clip(CircleShape).background(if (n == 2) Accent else Panel2), contentAlignment = Alignment.Center) {
                        Text("${n + 1}", color = if (n == 2) OnAccent else TextHi, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge)
                    }
                    Spacer(Modifier.width(12.dp))
                    Column { Text(t, fontWeight = FontWeight.SemiBold); Text(sub, color = Muted, style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
        Spacer(Modifier.height(22.dp))
        Button(onClick = onScan, modifier = Modifier.fillMaxWidth().height(54.dp)) {
            Icon(Icons.Rounded.QrCodeScanner, null); Spacer(Modifier.width(10.dp)); Text(tr("Scan the code on the TV"))
        }
        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = onFind, modifier = Modifier.fillMaxWidth().height(54.dp)) {
            Icon(Icons.Rounded.Search, null); Spacer(Modifier.width(10.dp)); Text(tr("Find TVs on this network"))
        }
        Spacer(Modifier.height(14.dp))
        TextButton(onClick = { runCatching { uri.openUri("https://tivibro.app/install") } }) { Text(tr("TiviBro isn't on my TV yet")) }
    }
}

private fun iconOf(s: Shortcut): ImageVector = when (s) {
    Shortcut.REMOTE -> Icons.Rounded.SettingsRemote
    Shortcut.GUIDE -> Icons.Rounded.CalendarMonth
    Shortcut.SPORTS -> Icons.Rounded.SportsFootball
    Shortcut.ON_NOW -> Icons.Rounded.Theaters
    Shortcut.VOD -> Icons.Rounded.Movie
    Shortcut.MEDIA -> Icons.Rounded.VideoLibrary
    Shortcut.PLEX -> Icons.Rounded.Subscriptions
    Shortcut.REMINDERS -> Icons.Rounded.Notifications
    Shortcut.RECORDINGS -> Icons.Rounded.FiberManualRecord
    Shortcut.EDITOR -> Icons.Rounded.Edit
    Shortcut.BACKUPS -> Icons.Rounded.Backup
    Shortcut.SETTINGS -> Icons.Rounded.Settings
}

/** Each shortcut's own colour (as in the design canvas's home), so they're quick to tell apart. */
private fun tintOf(s: Shortcut): Color = when (s) {
    Shortcut.SPORTS -> Color(0xFFFF7A45); Shortcut.ON_NOW -> Color(0xFFF5C842); Shortcut.MEDIA -> Good; Shortcut.PLEX -> Color(0xFFE5A00D); Shortcut.REMINDERS -> Warn
    Shortcut.RECORDINGS -> Bad; Shortcut.EDITOR -> Color(0xFFA78BFA); Shortcut.VOD -> Accent2; Shortcut.SETTINGS -> Color(0xFFC9D1E3)
    else -> Accent
}

@Composable
private fun ShortcutTile(s: Shortcut, enabled: Boolean, modifier: Modifier, live: Boolean = false, height: Int = 74, onClick: () -> Unit) {
    Column(
        modifier.height(height.dp).clip(MaterialTheme.shapes.small).background(Panel2)
            .clickable(enabled = enabled, onClickLabel = s.label, onClick = onClick).padding(6.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        // Recordings: red while something records on the TV.
        Icon(iconOf(s), if (live) tr("Recording now") else null, tint = if (live) Bad else if (enabled) tintOf(s) else Muted, modifier = Modifier.size(24.dp))
        Spacer(Modifier.height(6.dp))
        Text(s.label, color = if (enabled) TextHi else Muted, style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

/** The App update tile in a TV card's grid: [checking] while it asks GitHub, [ready] when an update is waiting. */
private class AppUpdateTile(val checking: Boolean, val ready: Boolean, val onClick: () -> Unit)

@Composable
private fun UpdateTile(t: AppUpdateTile, modifier: Modifier) {
    Column(
        modifier.height(74.dp).clip(MaterialTheme.shapes.small).background(Panel2)
            .clickable(enabled = !t.checking, onClickLabel = tr("Check for app updates"), onClick = t.onClick).padding(6.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        if (t.checking) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp, color = Accent)
        else Icon(Icons.Rounded.SystemUpdate, null, tint = if (t.ready) Good else Accent, modifier = Modifier.size(24.dp))
        Spacer(Modifier.height(6.dp))
        Text(
            if (t.checking) tr("Checking…") else if (t.ready) tr("Update ready") else tr("App update"),
            color = TextHi, style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun TvCard(
    u: TvUi, isTile: Boolean,
    onEditor: (String) -> Unit, onTab: (String, String) -> Unit, onReminders: (String) -> Unit, onOpen: (String) -> Unit, onWake: (String) -> Unit,
    onForget: (String) -> Unit, onTile: (String) -> Unit, onRepair: (String) -> Unit, onBackups: (String) -> Unit,
    bleLog: () -> String = { "" }, onBleListen: (String) -> Unit = {},
    appUpdate: AppUpdateTile? = null,
    onAddress: (String, String) -> Unit = { _, _ -> },
    onOff: (String) -> Unit = {},
    onRecordings: (String) -> Unit = {},
    /** Which of [count] TVs this is; [onSwitch] opens the list of them (tapping the name, with several). */
    position: Int = 0, count: Int = 1, onSwitch: () -> Unit = {},
) {
    var addressing by remember { mutableStateOf<String?>(null) }
    val tv = u.tv
    var menu by remember { mutableStateOf(false) }
    var logText by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf(false) }
    val (dot, status) = stateOf(u)
    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Panel), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(48.dp).clip(CircleShape).background(Panel2), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Tv, null, tint = if (u.power == Power.ON || u.power == Power.STARTING) Accent else Muted)
                }
                Spacer(Modifier.width(14.dp))
                // The name: with several TVs, tap it for the list of them (▾).
                Column(Modifier.weight(1f).then(if (count > 1) Modifier.clickable(onClickLabel = tr("Your TVs"), onClick = onSwitch) else Modifier)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(tv.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        if (count > 1) Icon(Icons.Rounded.ExpandMore, null, tint = Muted, modifier = Modifier.size(22.dp))
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(dot))
                        Spacer(Modifier.width(6.dp))
                        Text(listOfNotNull(status, if (count > 1) tr("TV {x} of {y}", "x" to position + 1, "y" to count) else tv.model.takeIf { it.isNotBlank() && !tv.name.contains(it, ignoreCase = true) }).joinToString("  ·  "),
                            style = MaterialTheme.typography.bodySmall, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (isTile) Text(tr("Quick Settings tile"), style = MaterialTheme.typography.labelSmall, color = Accent)
                }
                if (u.busy != null || u.power == Power.WAKING || u.power == Power.CHECKING || u.power == Power.STARTING) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                // Power: off when it's on, on when it's off (and can be woken).
                if (u.power == Power.ON || (u.power == Power.OFF && tv.canWake())) {
                    val on = u.power == Power.ON
                    IconButton(onClick = { if (on) onOff(tv.id) else onWake(tv.id) }, modifier = Modifier.padding(start = 4.dp).size(44.dp).clip(CircleShape).background(Panel2)) {
                        Icon(Icons.Rounded.PowerSettingsNew, if (on) tr("Turn off") else tr("Turn on"), tint = if (on) Bad else Good)
                    }
                }
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, tr("More")) }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        if (tv.canWake()) DropdownMenuItem(text = { Text(tr("Turn on")) }, leadingIcon = { Icon(Icons.Rounded.PowerSettingsNew, null) }, onClick = { menu = false; onWake(tv.id) })
                        if (u.power == Power.ON) DropdownMenuItem(text = { Text(tr("Turn off")) }, leadingIcon = { Icon(Icons.Rounded.PowerSettingsNew, null) }, onClick = { menu = false; onOff(tv.id) })
                        if (u.power == Power.ON) DropdownMenuItem(text = { Text(if (u.tivibroOpen) tr("Show TiviBro on the TV") else tr("Open TiviBro on the TV")) }, leadingIcon = { Icon(Icons.Rounded.PlayArrow, null) }, onClick = { menu = false; onOpen(tv.id) })
                        if (tv.bt.isNotBlank()) DropdownMenuItem(text = { Text(tr("Bluetooth log")) }, leadingIcon = { Icon(Icons.Rounded.Bluetooth, null) }, onClick = { menu = false; logText = bleLog() })
                        DropdownMenuItem(text = { Text(tr("The TV's address")) }, leadingIcon = { Icon(Icons.Rounded.Edit, null) }, onClick = { menu = false; addressing = tv.host + if (tv.port != 47810) ":" + tv.port else "" })
                        DropdownMenuItem(text = { Text(tr("Use for the Quick Settings tile")) }, leadingIcon = { Icon(Icons.Rounded.Tv, null) }, onClick = { menu = false; onTile(tv.id) })
                        DropdownMenuItem(text = { Text(tr("Forget this TV")) }, leadingIcon = { Icon(Icons.Rounded.LinkOff, null) }, onClick = { menu = false; confirm = true })
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            when (u.power) {
                Power.UNPAIRED -> Button(onClick = { onRepair(tv.id) }, modifier = Modifier.fillMaxWidth()) { Text(tr("Pair again")) }
                Power.STARTING -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    // The TV is on, but the helper TiviBro talks through hasn't started yet (it starts by itself
                    // shortly after the TV turns on, or at once when TiviBro is opened).
                    Text(tr("The TV is on.  TiviBro's connection starts by itself within a minute or so, or at once when you open TiviBro on the TV."), style = MaterialTheme.typography.bodySmall, color = Muted)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(onClick = { onEditor(tv.id) }, modifier = Modifier.weight(1f).height(48.dp)) { Text(tr("Edit channels anyway"), maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        OutlinedButton(onClick = { onBackups(tv.id) }, modifier = Modifier.weight(1f).height(48.dp)) { Text(tr("Backups"), maxLines = 1) }
                    }
                }
                Power.OFF -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (tv.canWake()) Button(onClick = { onWake(tv.id) }, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                        Icon(Icons.Rounded.PowerSettingsNew, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text(tr("Turn on"))
                    }
                    // Without the TV: its backups on this phone, and the editor (which tries the TV anyway).
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(onClick = { onEditor(tv.id) }, modifier = Modifier.weight(1f).height(48.dp)) { Text(tr("Edit channels anyway"), maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        OutlinedButton(onClick = { onBackups(tv.id) }, modifier = Modifier.weight(1f).height(48.dp)) { Text(tr("Backups"), maxLines = 1) }
                    }
                    // The app can be updated with the TV off too.
                    if (appUpdate != null) OutlinedButton(onClick = appUpdate.onClick, enabled = !appUpdate.checking, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                        Icon(Icons.Rounded.SystemUpdate, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp))
                        Text(if (appUpdate.checking) tr("Checking for an app update…") else tr("Check for an app update"))
                    }
                }
                else -> {
                    val on = u.power == Power.ON
                    val grid: List<Shortcut?> = Shortcut.forTv(u.caps).filter { it != Shortcut.REMOTE && it != Shortcut.GUIDE } + (if (appUpdate != null) listOf(null) else emptyList())
                    fun open(sc: Shortcut) = when (sc) {
                        Shortcut.REMINDERS -> onReminders(tv.id)
                        Shortcut.RECORDINGS -> onRecordings(tv.id)
                        Shortcut.EDITOR -> onEditor(tv.id)
                        Shortcut.BACKUPS -> onBackups(tv.id)
                        else -> onTab(tv.id, Shortcut.tab(sc, u.caps) ?: tr("Remote"))
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        NowOnTv(u)
                        // The two used most: Remote big, Guide beside it.
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { open(Shortcut.REMOTE) }, enabled = on, shape = MaterialTheme.shapes.medium, modifier = Modifier.weight(2f).height(60.dp)) {
                                Icon(Icons.Rounded.SettingsRemote, null); Spacer(Modifier.width(10.dp)); Text(Shortcut.REMOTE.label, fontWeight = FontWeight.Bold)
                            }
                            ShortcutTile(Shortcut.GUIDE, enabled = on, modifier = Modifier.weight(1f), height = 60) { open(Shortcut.GUIDE) }
                        }
                        grid.chunked(4).forEach { row ->
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                row.forEach { sc ->
                                    if (sc == null) { if (appUpdate != null) UpdateTile(appUpdate, Modifier.weight(1f)); return@forEach }
                                    ShortcutTile(sc, enabled = on || sc == Shortcut.BACKUPS, modifier = Modifier.weight(1f), live = sc == Shortcut.RECORDINGS && (u.caps?.recNow ?: 0) > 0) { open(sc) }
                                }
                                // Keeps the tiles of a short last row the same size.
                                repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
                            }
                        }
                    }
                }
            }
        }
    }
    logText?.let { text ->
        val ctx = LocalContext.current
        AlertDialog(
            onDismissRequest = { logText = null },
            title = { Text(tr("Bluetooth log")) },
            text = {
                Column {
                    Text(
                        tr("What the phone sent and heard the last time it turned {x} on.  Listen for the TV hears it for 20 seconds without waking it (try it with the TV off, then on).", "x" to tv.name),
                        style = MaterialTheme.typography.bodySmall, color = Muted,
                    )
                    Spacer(Modifier.height(10.dp))
                    Box(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState())) {
                        Text(text.ifBlank { tr("Nothing yet.  Press Turn on, or Listen for the TV.") }, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace)
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { logText = null; onBleListen(tv.id) }) { Text(tr("Listen for the TV")) }
            },
            dismissButton = {
                Row {
                    if (text.isNotBlank()) TextButton(onClick = {
                        val i = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
                        runCatching { ctx.startActivity(Intent.createChooser(i, tr("Share the Bluetooth log")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                    }) { Text(tr("Share")) }
                    TextButton(onClick = { logText = null }) { Text(tr("Close")) }
                }
            },
            containerColor = Panel,
        )
    }
    addressing?.let { cur ->
        AlertDialog(
            onDismissRequest = { addressing = null },
            title = { Text(tr("The TV's address")) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(tr("The app finds the TV again by itself when your router gives it another address.  If it doesn't, type the new one here (the TV shows it in Settings > Phone app and web editor).  The pairing stays: nothing to pair again."), style = MaterialTheme.typography.bodySmall, color = Muted)
                    OutlinedTextField(value = cur, onValueChange = { addressing = it }, singleLine = true, label = { Text(tr("Address")) },
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Uri))
                }
            },
            confirmButton = { TextButton(onClick = { val v = cur; addressing = null; onAddress(tv.id, v) }) { Text(tr("Save")) } },
            dismissButton = { TextButton(onClick = { addressing = null }) { Text(tr("Cancel")) } },
            containerColor = Panel,
        )
    }
    if (confirm) AlertDialog(
        onDismissRequest = { confirm = false },
        title = { Text(tr("Forget {x}?", "x" to tv.name)) },
        text = { Text(tr("This phone is removed from the TV too.  You can pair again any time.")) },
        confirmButton = { TextButton(onClick = { confirm = false; onForget(tv.id) }) { Text(tr("Forget"), color = Bad) } },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text(tr("Cancel")) } },
        containerColor = Panel,
    )
}



/** "A new TiviBro app is out" (checked once per app start, and from the App update tile).  Update now downloads
 *  it with a progress bar and installs it over this one (update/Updater.kt).  Test builds, and anything that
 *  goes wrong, fall back to the APK link in the browser. */
/** The Play build's update card: Google Play has a newer TiviBro app (or GitHub does, [note] says so). */
@Composable
private fun PlayUpdateCard(note: String, onOpen: () -> Unit, onLater: () -> Unit) {
    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Panel), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text(tr("A newer TiviBro app is out"), style = MaterialTheme.typography.titleMedium)
            Text(note.ifBlank { tr("Google Play has it.  Update there: TiviBro keeps your TVs and settings.") }, color = Muted, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = onOpen) { Text(tr("Update on Google Play")) }
                Spacer(Modifier.width(8.dp))
                TextButton(onClick = onLater) { Text(tr("Later")) }
            }
        }
    }
}

@Composable
private fun AppUpdateCard(rel: AppRelease, onLater: () -> Unit) {
    val ctx = LocalContext.current
    val step by Updater.step.collectAsStateWithLifecycle()
    // Back from Android's "Install unknown apps" setting: carry on if TiviBro may install now.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        val r = rel
        if (r != null && Updater.step.value == UpdateStep.NeedsPermission) {
            if (Updater.allowed(ctx)) Updater.start(ctx, r)
            else Updater.fail(tr("TiviBro isn't allowed to install apps, so it can't update itself."))
        }
    }
    val r = rel
    val inPlace = Updater.inPlace(ctx)
    fun open(url: String) { runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
    val small = MaterialTheme.typography.bodySmall
    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Panel), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text(tr("TiviBro app {x} is out", "x" to r.version), style = MaterialTheme.typography.titleMedium)
            when (val s = step) {
                is UpdateStep.Downloading -> {
                    Text(if (s.total > 0) "Downloading: ${mb(s.done)} of ${mb(s.total)} MB" else "Downloading: ${mb(s.done)} MB", color = Muted, style = small)
                    Spacer(Modifier.height(8.dp))
                    if (s.total > 0) LinearProgressIndicator(progress = { (s.done.toFloat() / s.total).coerceIn(0f, 1f) }, color = Accent, trackColor = Panel2, modifier = Modifier.fillMaxWidth())
                    else LinearProgressIndicator(color = Accent, trackColor = Panel2, modifier = Modifier.fillMaxWidth())
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = { Updater.cancel() }) { Text(tr("Cancel")) }
                    }
                }
                UpdateStep.Installing -> {
                    Text(tr("Installing.  Android may ask you to confirm."), color = Muted, style = small)
                    Spacer(Modifier.height(8.dp))
                    LinearProgressIndicator(color = Accent, trackColor = Panel2, modifier = Modifier.fillMaxWidth())
                }
                is UpdateStep.Confirm -> {
                    Text(tr("Android is asking you to confirm the update."), color = Muted, style = small)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = { runCatching { ctx.startActivity(s.confirm) }.onFailure { Updater.fail(tr("Android's install question didn't open.")) } }) { Text(tr("Continue")) }
                        TextButton(onClick = { Updater.reset() }) { Text(tr("Cancel")) }
                    }
                }
                UpdateStep.Done -> Text(tr("Updated.  If TiviBro closed, open it again."), color = Muted, style = small)
                is UpdateStep.Failed -> {
                    Text(s.message, color = Bad, style = small)
                    Text(tr("You can download it in the browser instead and install it over this one: your TVs and backups stay."), color = Muted, style = small)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = { open(r.apk) }) { Text(tr("Download")) }
                        if (inPlace) TextButton(onClick = { Updater.start(ctx, r) }) { Text(tr("Try again")) }
                        TextButton(onClick = { open(r.page) }) { Text("What's new") }
                    }
                }
                else -> {
                    val needs = s == UpdateStep.NeedsPermission
                    Text(
                        if (needs) tr("Allow TiviBro to install apps in the setting that opened, then come back here.")
                        else tr("Install it over this one: your TVs and backups stay."),
                        color = if (needs) Warn else Muted, style = small,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        // A test build has its own package name and key, so it can't update the release app in place.
                        if (inPlace) Button(onClick = { Updater.start(ctx, r) }) { Text(tr("Update now")) }
                        else TextButton(onClick = { open(r.apk) }) { Text(tr("Download")) }
                        TextButton(onClick = { open(r.page) }) { Text("What's new") }
                        TextButton(onClick = onLater) { Text(tr("Later")) }
                    }
                }
            }
        }
    }
}

private fun mb(bytes: Long) = "%.1f".format(bytes / 1_048_576.0)

/* About the app: its version, TiviBro's MIT license, and the open-source parts it is built with and their
   licenses (the phone app's part of THIRD-PARTY-NOTICES.md in the repository). */
private val APP_PARTS = listOf(
    "AndroidX: Jetpack Compose, Material 3 and its icons, Activity, Core, Lifecycle, Navigation, WorkManager, Browser" to "Apache-2.0",
    "Kotlin standard library and kotlinx.coroutines" to "Apache-2.0",
    "Coil" to "Apache-2.0",
    "Google code scanner (Google Play services)" to "Google APIs Terms of Service",
)

@Composable
private fun AboutDialog(version: String, onDismiss: () -> Unit, onOpen: (String) -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr("TiviBro app") + if (version.isNotBlank()) " $version" else "") },
        text = {
            Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState())) {
                Text(tr("Free software under the MIT License, copyright (c) 2026 OhMyBahGosh."), style = MaterialTheme.typography.bodyMedium)
                // The privacy policy (Google Play asks for it inside the app too).
                TextButton(onClick = { onOpen("https://tivibro.app/privacy/") }, contentPadding = PaddingValues(0.dp)) { Text(tr("Privacy policy")) }
                Spacer(Modifier.height(8.dp))
                Text(tr("Built with"), fontWeight = FontWeight.SemiBold)
                APP_PARTS.forEach { (name, lic) ->
                    Text(name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
                    Text(lic, style = MaterialTheme.typography.bodySmall, color = Muted)
                }
                Spacer(Modifier.height(16.dp))
                Text(tr("The TV app's own list is on the TV: Settings > System > Open-source licenses and credits.  The full license texts are in the repository."), style = MaterialTheme.typography.bodySmall, color = Muted)
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("OK") } },
        dismissButton = { TextButton(onClick = { onOpen("https://github.com/ohmybahgosh/TiviBro/blob/main/THIRD-PARTY-NOTICES.md") }) { Text(tr("Full texts")) } },
        containerColor = Panel,
    )
}
