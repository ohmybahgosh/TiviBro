/* The first screen: each paired TV as a card (on, off, TiviBro open) with shortcuts straight to the
   Remote, Guide, On now, Movies and Shows, My media, Reminders, Edit channels, Backups and Settings (the
   ones this TV has, see Shortcuts.kt), and in its menu Turn on, Open TiviBro, the Quick Settings tile and
   Forget; plus adding a TV.  A TV that is off still offers Edit channels and its backups on the phone. */
package app.tivibro.phone.ui

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
import androidx.compose.material3.LinearProgressIndicator
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Backup
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Theaters
import androidx.compose.material.icons.rounded.VideoLibrary
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.LinkOff
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.PowerSettingsNew
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.SettingsRemote
import androidx.compose.material.icons.rounded.Tv
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
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
) {
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Scaffold(
        containerColor = Ink,
        topBar = {
            CenterAlignedTopAppBar(
                title = { Image(painterResource(R.drawable.wordmark), contentDescription = "TiviBro", modifier = Modifier.height(26.dp)) },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = Ink),
            )
        },
        floatingActionButton = {
            if (tvs.isNotEmpty()) ExtendedFloatingActionButton(onClick = onAdd, icon = { Icon(Icons.Rounded.Add, null) }, text = { Text("Add a TV") })
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
            LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.fillMaxSize()) {
                item(key = "app-update") { AppUpdateCard() }
                items(tvs, key = { it.tv.id }) { u ->
                    TvCard(u, isTile = tileTv == u.tv.id && tvs.size > 1, onEditor, onTab, onReminders, onOpen, onWake, onForget, onTile, onRepair, onBackups)
                }
            }
        }
    }
}

@Composable
private fun Empty(modifier: Modifier, onScan: () -> Unit, onFind: () -> Unit) {
    Column(modifier.fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Box(Modifier.size(96.dp).clip(CircleShape).background(Panel2), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.Tv, null, tint = Accent, modifier = Modifier.size(48.dp))
        }
        Spacer(Modifier.height(24.dp))
        Text("Pair your TV", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(10.dp))
        Text(
            "On the TV, open TiviBro and go to Settings, Phone app and web editor.  Switch on the connection, then choose Pair a phone.",
            style = MaterialTheme.typography.bodyLarge, color = Muted, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(28.dp))
        Button(onClick = onScan, modifier = Modifier.fillMaxWidth().height(54.dp)) {
            Icon(Icons.Rounded.QrCodeScanner, null); Spacer(Modifier.width(10.dp)); Text("Scan the code on the TV")
        }
        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = onFind, modifier = Modifier.fillMaxWidth().height(54.dp)) {
            Icon(Icons.Rounded.Search, null); Spacer(Modifier.width(10.dp)); Text("Find TVs on this network")
        }
    }
}

private fun iconOf(s: Shortcut): ImageVector = when (s) {
    Shortcut.REMOTE -> Icons.Rounded.SettingsRemote
    Shortcut.GUIDE -> Icons.Rounded.CalendarMonth
    Shortcut.ON_NOW -> Icons.Rounded.Theaters
    Shortcut.VOD -> Icons.Rounded.Movie
    Shortcut.MEDIA -> Icons.Rounded.VideoLibrary
    Shortcut.REMINDERS -> Icons.Rounded.Notifications
    Shortcut.EDITOR -> Icons.Rounded.Edit
    Shortcut.BACKUPS -> Icons.Rounded.Backup
    Shortcut.SETTINGS -> Icons.Rounded.Settings
}

@Composable
private fun ShortcutTile(s: Shortcut, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier.height(76.dp).clip(MaterialTheme.shapes.small).background(Panel2)
            .clickable(enabled = enabled, onClickLabel = s.label, onClick = onClick).padding(6.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Icon(iconOf(s), null, tint = if (enabled) Accent else Muted, modifier = Modifier.size(24.dp))
        Spacer(Modifier.height(6.dp))
        Text(s.label, color = if (enabled) TextHi else Muted, style = MaterialTheme.typography.labelMedium, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun TvCard(
    u: TvUi, isTile: Boolean,
    onEditor: (String) -> Unit, onTab: (String, String) -> Unit, onReminders: (String) -> Unit, onOpen: (String) -> Unit, onWake: (String) -> Unit,
    onForget: (String) -> Unit, onTile: (String) -> Unit, onRepair: (String) -> Unit, onBackups: (String) -> Unit,
) {
    val tv = u.tv
    var menu by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    val (dot, status) = when (u.power) {
        Power.CHECKING -> Muted to "Checking…"
        Power.WAKING -> Accent to "Turning on…"
        Power.ON -> Good to (if (u.tivibroOpen) "On · TiviBro open" else "On")
        Power.OFF -> Muted to "Off or not reachable"
        Power.UNPAIRED -> Bad to "This TV no longer knows this phone"
    }
    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Panel), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(48.dp).clip(CircleShape).background(Panel2), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Tv, null, tint = if (u.power == Power.ON) Accent else Muted)
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(tv.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(dot))
                        Spacer(Modifier.width(6.dp))
                        Text(listOfNotNull(status, tv.model.ifBlank { null }).joinToString("  ·  "), style = MaterialTheme.typography.bodySmall, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (isTile) Text("Quick Settings tile", style = MaterialTheme.typography.labelSmall, color = Accent)
                }
                if (u.busy != null || u.power == Power.WAKING || u.power == Power.CHECKING) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, "More") }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        if (tv.canWake()) DropdownMenuItem(text = { Text("Turn on") }, leadingIcon = { Icon(Icons.Rounded.PowerSettingsNew, null) }, onClick = { menu = false; onWake(tv.id) })
                        if (u.power == Power.ON) DropdownMenuItem(text = { Text(if (u.tivibroOpen) "Show TiviBro on the TV" else "Open TiviBro on the TV") }, leadingIcon = { Icon(Icons.Rounded.PlayArrow, null) }, onClick = { menu = false; onOpen(tv.id) })
                        DropdownMenuItem(text = { Text("Use for the Quick Settings tile") }, leadingIcon = { Icon(Icons.Rounded.Tv, null) }, onClick = { menu = false; onTile(tv.id) })
                        DropdownMenuItem(text = { Text("Forget this TV") }, leadingIcon = { Icon(Icons.Rounded.LinkOff, null) }, onClick = { menu = false; confirm = true })
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            when (u.power) {
                Power.UNPAIRED -> Button(onClick = { onRepair(tv.id) }, modifier = Modifier.fillMaxWidth()) { Text("Pair again") }
                Power.OFF -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (tv.canWake()) Button(onClick = { onWake(tv.id) }, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                        Icon(Icons.Rounded.PowerSettingsNew, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("Turn on")
                    }
                    // Without the TV: its backups on this phone, and the editor (which tries the TV anyway).
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(onClick = { onEditor(tv.id) }, modifier = Modifier.weight(1f).height(48.dp)) { Text("Edit channels anyway", maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        OutlinedButton(onClick = { onBackups(tv.id) }, modifier = Modifier.weight(1f).height(48.dp)) { Text("Backups", maxLines = 1) }
                    }
                }
                else -> {
                    val on = u.power == Power.ON
                    val list = Shortcut.forTv(u.caps)
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        list.chunked(3).forEach { row ->
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                row.forEach { sc ->
                                    ShortcutTile(sc, enabled = on || sc == Shortcut.BACKUPS, modifier = Modifier.weight(1f)) {
                                        when (sc) {
                                            Shortcut.REMINDERS -> onReminders(tv.id)
                                            Shortcut.EDITOR -> onEditor(tv.id)
                                            Shortcut.BACKUPS -> onBackups(tv.id)
                                            else -> onTab(tv.id, Shortcut.tab(sc, u.caps) ?: "Remote")
                                        }
                                    }
                                }
                                // Keeps the tiles of a short last row the same size.
                                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                            }
                        }
                    }
                }
            }
        }
    }
    if (confirm) AlertDialog(
        onDismissRequest = { confirm = false },
        title = { Text("Forget ${tv.name}?") },
        text = { Text("This phone is removed from the TV too.  You can pair again any time.") },
        confirmButton = { TextButton(onClick = { confirm = false; onForget(tv.id) }) { Text("Forget", color = Bad) } },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
        containerColor = Panel,
    )
}



/** "A new TiviBro app is out", checked once per app start.  Update now downloads it with a progress bar and
 *  installs it over this one (update/Updater.kt).  Test builds, and anything that goes wrong, fall back to
 *  the APK link in the browser. */
@Composable
private fun AppUpdateCard() {
    val ctx = LocalContext.current
    var rel by remember { mutableStateOf<AppRelease?>(null) }
    var hidden by remember { mutableStateOf(false) }
    val step by Updater.step.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) {
        val cur = runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName }.getOrNull().orEmpty()
        rel = withContext(Dispatchers.IO) { AppUpdate.check(cur) }
    }
    // Back from Android's "Install unknown apps" setting: carry on if TiviBro may install now.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        val r = rel
        if (r != null && Updater.step.value == UpdateStep.NeedsPermission) {
            if (Updater.allowed(ctx)) Updater.start(ctx, r)
            else Updater.fail("TiviBro isn't allowed to install apps, so it can't update itself.")
        }
    }
    val r = rel ?: return
    if (hidden) return
    val inPlace = Updater.inPlace(ctx)
    fun open(url: String) { runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
    val small = MaterialTheme.typography.bodySmall
    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Panel), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text("TiviBro app ${r.version} is out", style = MaterialTheme.typography.titleMedium)
            when (val s = step) {
                is UpdateStep.Downloading -> {
                    Text(if (s.total > 0) "Downloading: ${mb(s.done)} of ${mb(s.total)} MB" else "Downloading: ${mb(s.done)} MB", color = Muted, style = small)
                    Spacer(Modifier.height(8.dp))
                    if (s.total > 0) LinearProgressIndicator(progress = { (s.done.toFloat() / s.total).coerceIn(0f, 1f) }, color = Accent, trackColor = Panel2, modifier = Modifier.fillMaxWidth())
                    else LinearProgressIndicator(color = Accent, trackColor = Panel2, modifier = Modifier.fillMaxWidth())
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = { Updater.cancel() }) { Text("Cancel") }
                    }
                }
                UpdateStep.Installing -> {
                    Text("Installing.  Android may ask you to confirm.", color = Muted, style = small)
                    Spacer(Modifier.height(8.dp))
                    LinearProgressIndicator(color = Accent, trackColor = Panel2, modifier = Modifier.fillMaxWidth())
                }
                is UpdateStep.Confirm -> {
                    Text("Android is asking you to confirm the update.", color = Muted, style = small)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = { runCatching { ctx.startActivity(s.confirm) }.onFailure { Updater.fail("Android's install question didn't open.") } }) { Text("Continue") }
                        TextButton(onClick = { Updater.reset() }) { Text("Cancel") }
                    }
                }
                UpdateStep.Done -> Text("Updated.  If TiviBro closed, open it again.", color = Muted, style = small)
                is UpdateStep.Failed -> {
                    Text(s.message, color = Bad, style = small)
                    Text("You can download it in the browser instead and install it over this one: your TVs and backups stay.", color = Muted, style = small)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = { open(r.apk) }) { Text("Download") }
                        if (inPlace) TextButton(onClick = { Updater.start(ctx, r) }) { Text("Try again") }
                        TextButton(onClick = { open(r.page) }) { Text("What's new") }
                    }
                }
                else -> {
                    val needs = s == UpdateStep.NeedsPermission
                    Text(
                        if (needs) "Allow TiviBro to install apps in the setting that opened, then come back here."
                        else "Install it over this one: your TVs and backups stay.",
                        color = if (needs) Warn else Muted, style = small,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        // A test build has its own package name and key, so it can't update the release app in place.
                        if (inPlace) Button(onClick = { Updater.start(ctx, r) }) { Text("Update now") }
                        else TextButton(onClick = { open(r.apk) }) { Text("Download") }
                        TextButton(onClick = { open(r.page) }) { Text("What's new") }
                        TextButton(onClick = { hidden = true }) { Text("Later") }
                    }
                }
            }
        }
    }
}

private fun mb(bytes: Long) = "%.1f".format(bytes / 1_048_576.0)
