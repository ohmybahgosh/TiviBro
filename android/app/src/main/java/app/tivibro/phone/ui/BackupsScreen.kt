/* Backups and restore points: the one place for them on the phone (the home screen's shortcut, the
   Settings tab's Backups rows and the web editor's Backup page all come here).
   Saved on this phone: back up now, the weekly automatic backups (on unless switched off), put one back
   on this TV or another paired TV.  Without the TV (discussion #23): name, duplicate and merge backups,
   change settings inside one, edit a playlist's channels in the web editor on the phone
   (OfflineEditorScreen.kt), and delete with two confirmations.  Each of those makes a new backup and
   leaves the one it came from alone.
   Backup file: save a locked backup file to the phone's storage (the web editor reads it too), and
   restore from one.
   Restore points on the TV (ask "snaps"): copies of the channel edits and names the TV keeps by itself
   and when asked; make one, go back to one (TiviBro restarts on the TV) or delete one. */
package app.tivibro.phone.ui

import app.tivibro.phone.tr
import app.tivibro.phone.trn

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Backup
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.FolderOpen
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Save
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.tivibro.phone.data.BackupTools
import app.tivibro.phone.data.SavedBackup
import app.tivibro.phone.proto.RestorePoint
import app.tivibro.phone.proto.TbException
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BackupsScreen(model: AppModel, id: String, tvs: List<TvUi>, snack: SnackbarHostState, onBack: () -> Unit, onEditOffline: (SavedBackup, String) -> Unit = { _, _ -> }) {
    val tv = tvs.firstOrNull { it.tv.id == id }?.tv ?: return
    var version by remember { mutableIntStateOf(0) }
    val list = remember(version) { model.backups.list(id) }
    // Which playlists in each backup can be edited on the phone (a channel list is kept for them).
    val offline by produceState(emptyMap<String, List<String>>(), version) {
        value = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { list.associate { it.file.name to model.offlinePlaylists(it) } }
    }
    var auto by remember { mutableStateOf(model.backups.auto) }
    var busy by remember { mutableStateOf(false) }
    var restoring by remember { mutableStateOf<Pair<SavedBackup, String>?>(null) }
    var exporting by remember { mutableStateOf<SavedBackup?>(null) }
    var pass by remember { mutableStateOf("") }
    var passAgain by remember { mutableStateOf("") }
    var renaming by remember { mutableStateOf<SavedBackup?>(null) }
    var newName by remember { mutableStateOf("") }
    var merging by remember { mutableStateOf<SavedBackup?>(null) }
    var settingsOf by remember { mutableStateOf<SavedBackup?>(null) }
    var deleting by remember { mutableStateOf<Pair<SavedBackup, Int>?>(null) }
    var picking by remember { mutableStateOf<Pair<SavedBackup, List<Pair<String, String>>>?>(null) }
    var noCopy by remember { mutableStateOf(false) }
    var showAll by remember { mutableStateOf(false) }
    // A backup file: saving one (asks a passphrase first), and opening one (a passphrase when it is locked).
    var fileOut by remember { mutableStateOf(false) }
    var filePass by remember { mutableStateOf("") }
    var fileAgain by remember { mutableStateOf("") }
    var fileIn by remember { mutableStateOf<android.net.Uri?>(null) }
    var fileBusy by remember { mutableStateOf(false) }
    // Restore points on the TV.
    var points by remember { mutableStateOf<List<RestorePoint>?>(null) }
    var pointsError by remember { mutableStateOf<String?>(null) }
    var pointsBusy by remember { mutableStateOf(false) }
    var pointsTry by remember { mutableIntStateOf(0) }
    var making by remember { mutableStateOf(false) }
    var pointName by remember { mutableStateOf("") }
    var backTo by remember { mutableStateOf<RestorePoint?>(null) }
    var dropping by remember { mutableStateOf<RestorePoint?>(null) }
    val scope = rememberCoroutineScope()
    fun snaps(op: String, name: String = "", p: RestorePoint? = null) {
        pointsBusy = true; pointsError = null
        scope.launch {
            try {
                val (msg, l) = model.snaps(id, op, name, p?.id.orEmpty())
                points = l
                if (op != "list" && op != "restore" && msg.isNotBlank()) model.say(msg)
                if (op == "restore") model.say(tr("Restored \"{x}\".  TiviBro restarts on the TV.", "x" to p?.name.orEmpty().ifBlank { tr("the restore point") }))
            } catch (e: TbException) { pointsError = e.message ?: tr("The TV said no") }
            catch (e: Exception) { pointsError = tr("{x} didn't answer.  Is it on, and on the same network?", "x" to tv.name) }
            pointsBusy = false
        }
    }
    LaunchedEffect(pointsTry) { snaps("list") }
    fun act(what: suspend () -> String) { scope.launch { try { model.say(what()); version++ } catch (e: TbException) { model.say(e.message ?: tr("That didn't work")) } catch (e: Exception) { model.say(e.message ?: tr("That didn't work")) } } }
    // Edit a playlist's channels on the phone: needs the channel list the web editor kept (EditorCopies.kt).
    fun editOffline(b: SavedBackup) {
        val pls = runCatching { BackupTools.playlists(model.openBackup(b)) }.getOrDefault(emptyList()).filter { model.copies.has(id, it.first) }
        when (pls.size) { 0 -> noCopy = true; 1 -> onEditOffline(b, pls[0].first); else -> picking = b to pls }
    }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val b = exporting; val p = pass
        exporting = null; pass = ""; passAgain = ""
        if (uri != null && b != null) scope.launch {
            try { model.exportBackup(b, p, uri); model.say(tr("Saved.  Restore it here with Restore a file, or in the web editor.")) } catch (e: Exception) { model.say(e.message ?: tr("Couldn't save the file.")) }
        }
    }

    val saveFile = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val p = filePass
        filePass = ""; fileAgain = ""
        if (uri != null) { fileBusy = true; scope.launch {
            try { model.say(model.exportNow(id, p, uri)) } catch (e: Exception) { model.say(e.message ?: tr("Couldn't save the file.")) }
            fileBusy = false
        } }
    }
    // Opens the backup on the phone as a new backup of this TV, then asks before putting it on the TV.
    fun importFrom(uri: android.net.Uri, pass: String?) {
        fileBusy = true
        scope.launch {
            try { val b = model.importFile(id, uri, pass); version++; model.say(tr("Kept on this phone as \"From a file\"")); restoring = b to id }
            catch (e: TbException) { model.say(e.message ?: tr("Couldn't open the file.")) }
            catch (e: Exception) { model.say(tr("Couldn't open the file.")) }
            fileBusy = false
        }
    }
    val openFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            try { if (model.backupFileLocked(uri)) { filePass = ""; fileAgain = ""; fileIn = uri } else importFrom(uri, null) }
            catch (e: TbException) { model.say(e.message ?: tr("Couldn't open the file.")) }
            catch (e: Exception) { model.say(tr("Couldn't open the file.")) }
        }
    }

    Scaffold(
        containerColor = Ink, snackbarHost = { SnackbarHost(snack) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(tr("Backups and restore points"), maxLines = 1)
                        Text(tv.name, color = Muted, style = MaterialTheme.typography.labelMedium, maxLines = 1)
                    }
                },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, tr("Back")) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Ink))
        },
    ) { pad ->
        LazyColumn(Modifier.padding(pad).fillMaxSize(), contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { Heading(tr("Saved on this phone")) }
            item {
                Text(tr("Everything on the TV: playlists with their logins, your channel edits, favorites, groups and settings.  Kept on this phone, encrypted, and never sent anywhere else."),
                    color = Muted, style = MaterialTheme.typography.bodySmall)
            }
            item {
                Button(
                    onClick = {
                        busy = true
                        scope.launch {
                            try { model.backupNow(id); version++; model.say(tr("Backed up {x}", "x" to tv.name)) }
                            catch (e: TbException) { model.say(e.message ?: tr("The TV said no")) }
                            catch (e: Exception) { model.say(tr("The TV didn't answer.  Is it on, and on the same network?")) }
                            finally { busy = false }
                        }
                    },
                    enabled = !busy, modifier = Modifier.fillMaxWidth().height(52.dp),
                ) {
                    if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Rounded.Backup, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(10.dp)); Text(tr("Back up now"))
                }
            }
            item {
                Surface(color = Panel, shape = MaterialTheme.shapes.medium) {
                    Row(Modifier.fillMaxWidth().clickable { auto = !auto; model.backups.auto = auto }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(tr("Back up every week"))
                            Text(tr("When the phone is on your Wi-Fi and TiviBro is open on the TV.  The newest {x} automatic ones are kept; named, copied and edited ones stay until you delete them.", "x" to app.tivibro.phone.data.BackupStore.KEEP), color = Muted, style = MaterialTheme.typography.bodySmall)
                        }
                        Switch(auto, { auto = it; model.backups.auto = it })
                    }
                }
            }
            if (list.isEmpty()) item { Text(tr("No backups on this phone yet."), color = Muted, modifier = Modifier.padding(top = 4.dp)) }
            // The newest few; the rest on request, so the file and restore points stay near.
            items(if (showAll) list else list.take(SHOWN), key = { it.file.name }) { b ->
                BackupRow(b, offline = offline[b.file.name], others = tvs.filter { it.tv.id != id }.map { it.tv.id to it.tv.name },
                    onRestore = { to, _ -> restoring = b to to },
                    onExport = { exporting = b },
                    onDelete = { deleting = b to 1 },
                    onEdit = { editOffline(b) },
                    onSettings = { settingsOf = b },
                    onRename = { renaming = b; newName = b.label },
                    onDuplicate = { act { model.duplicate(b); tr("Copied") } },
                    onMerge = { if (list.size < 2) model.say(tr("Make another backup first: merging adds the playlists of one backup to another.")) else merging = b })
            }
            if (list.size > SHOWN) item {
                TextButton(onClick = { showAll = !showAll }) { Text(if (showAll) tr("Show fewer") else tr("Show all {x} backups", "x" to list.size)) }
            }

            item { Spacer(Modifier.height(8.dp)); Heading(tr("Backup file")) }
            item {
                Text(tr("A backup file on the phone's storage, locked with a passphrase you pick (it holds your logins).  Restore it here, or on any TV in the web editor."),
                    color = Muted, style = MaterialTheme.typography.bodySmall)
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = { filePass = ""; fileAgain = ""; fileOut = true }, enabled = !fileBusy, modifier = Modifier.weight(1f).height(48.dp)) {
                        Icon(Icons.Rounded.Save, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("Save a file", maxLines = 1)
                    }
                    OutlinedButton(onClick = { runCatching { openFile.launch(arrayOf("application/json", "application/octet-stream", "text/plain", "*/*")) } }, enabled = !fileBusy, modifier = Modifier.weight(1f).height(48.dp)) {
                        Icon(Icons.Rounded.FolderOpen, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("Restore a file", maxLines = 1)
                    }
                }
            }
            if (fileBusy) item { Row(verticalAlignment = Alignment.CenterVertically) { CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp); Spacer(Modifier.width(10.dp)); Text(tr("Working on it…"), color = Muted) } }

            item { Spacer(Modifier.height(8.dp)); Heading(tr("Restore points on the TV")) }
            item {
                Text(tr("The TV keeps these by itself before big changes, and when you make one.  Going back to one puts your channel edits, groups and names back as they were; your playlists and logins stay."),
                    color = Muted, style = MaterialTheme.typography.bodySmall)
            }
            item {
                Button(onClick = { pointName = ""; making = true }, enabled = !pointsBusy && points != null, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                    Icon(Icons.Rounded.Add, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text(tr("Make a restore point"))
                }
            }
            val pl = points
            when {
                pointsError != null -> item {
                    Column {
                        Text(pointsError ?: "", color = Bad, style = MaterialTheme.typography.bodySmall)
                        TextButton(onClick = { pointsTry++ }) { Text(tr("Try again")) }
                    }
                }
                pl == null -> item { Row(verticalAlignment = Alignment.CenterVertically) { CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp); Spacer(Modifier.width(10.dp)); Text(tr("Asking the TV…"), color = Muted) } }
                pl.isEmpty() -> item { Text(tr("No restore points on the TV yet."), color = Muted) }
            }
            if (pl != null) items(pl, key = { "snap:" + it.id }) { p ->
                PointRow(p, enabled = !pointsBusy, onRestore = { backTo = p }, onDelete = { dropping = p })
            }
        }
    }

    restoring?.let { (b, to) ->
        val toName = tvs.firstOrNull { it.tv.id == to }?.tv?.name ?: tr("the TV")
        AlertDialog(
            onDismissRequest = { restoring = null }, containerColor = Panel,
            title = { Text(tr("Restore on {x}?", "x" to toName)) },
            text = { Text(tr("This replaces the playlists, edits and settings on {x} with the backup from {y}.  TiviBro restarts on the TV.", "x" to toName, "y" to (stamp(b.at)))) },
            confirmButton = {
                TextButton(onClick = {
                    restoring = null
                    scope.launch {
                        try { model.say(model.restore(to, b)) } catch (e: TbException) { model.say(e.message ?: tr("The TV said no")) } catch (e: Exception) { model.say(tr("The TV didn't answer.  Is it on, and on the same network?")) }
                    }
                }) { Text(tr("Restore")) }
            },
            dismissButton = { TextButton(onClick = { restoring = null }) { Text(tr("Cancel")) } },
        )
    }
    if (fileOut) AlertDialog(
        onDismissRequest = { fileOut = false; filePass = ""; fileAgain = "" }, containerColor = Panel,
        title = { Text(tr("Save a backup file")) },
        text = {
            Column {
                Text(tr("A backup of {x} as it is now.  Pick a passphrase to lock the file: you'll need it to restore the file.", "x" to tv.name), color = Muted, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(12.dp))
                NewPassphrase(filePass, { filePass = it }, fileAgain, { fileAgain = it })
            }
        },
        confirmButton = { TextButton(onClick = { fileOut = false; saveFile.launch("tivibro-backup-" + SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date()) + ".json") }, enabled = passphraseOk(filePass, fileAgain)) { Text(tr("Save")) } },
        dismissButton = { TextButton(onClick = { fileOut = false; filePass = ""; fileAgain = "" }) { Text(tr("Cancel")) } },
    )
    fileIn?.let { uri ->
        AlertDialog(
            onDismissRequest = { fileIn = null; filePass = ""; fileAgain = "" }, containerColor = Panel,
            title = { Text(tr("This file is locked")) },
            text = {
                Column {
                    Text(tr("Type the passphrase it was saved with."), color = Muted, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(12.dp))
                    SecretField(filePass, { filePass = it }, tr("Passphrase"), onDone = { if (filePass.isNotEmpty()) { val p = filePass; fileIn = null; filePass = ""; fileAgain = ""; importFrom(uri, p) } })
                }
            },
            confirmButton = { TextButton(onClick = { val p = filePass; fileIn = null; filePass = ""; fileAgain = ""; importFrom(uri, p) }, enabled = filePass.isNotEmpty()) { Text(tr("Open")) } },
            dismissButton = { TextButton(onClick = { fileIn = null; filePass = ""; fileAgain = "" }) { Text(tr("Cancel")) } },
        )
    }
    if (making) AlertDialog(
        onDismissRequest = { making = false }, containerColor = Panel,
        title = { Text(tr("Make a restore point")) },
        text = {
            Column {
                Text(tr("Saved on {x}: your channel edits, groups and names as they are now.", "x" to tv.name), color = Muted, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(pointName, { pointName = it.take(60) }, singleLine = true, label = { Text(tr("A name, like \"Before the clean-up\"")) })
            }
        },
        confirmButton = { TextButton(onClick = { making = false; snaps("make", pointName.trim().ifBlank { tr("Restore point") }) }) { Text(tr("Make it")) } },
        dismissButton = { TextButton(onClick = { making = false }) { Text(tr("Cancel")) } },
    )
    backTo?.let { p ->
        AlertDialog(
            onDismissRequest = { backTo = null }, containerColor = Panel,
            title = { Text(tr("Go back to \"{x}\"?", "x" to pointTitle(p))) },
            text = { Text(tr("Your channel edits, groups and names on {x} go back to how they were on {y}.  A restore point of how things are now is made first, so you can change your mind.  TiviBro restarts on the TV.", "x" to tv.name, "y" to (stamp(p.at)))) },
            confirmButton = { TextButton(onClick = { backTo = null; snaps("restore", p = p) }) { Text(tr("Restore")) } },
            dismissButton = { TextButton(onClick = { backTo = null }) { Text(tr("Cancel")) } },
        )
    }
    dropping?.let { p ->
        AlertDialog(
            onDismissRequest = { dropping = null }, containerColor = Panel,
            title = { Text("Delete \"" + pointTitle(p) + "\"?") },
            text = { Text(tr("The restore point from {x} goes from {y}.  Your channels aren't changed.", "x" to (stamp(p.at)), "y" to tv.name)) },
            confirmButton = { TextButton(onClick = { dropping = null; snaps("delete", p = p) }) { Text(tr("Delete"), color = Bad) } },
            dismissButton = { TextButton(onClick = { dropping = null }) { Text(tr("Keep it")) } },
        )
    }
    exporting?.let { b ->
        AlertDialog(
            onDismissRequest = { exporting = null; pass = ""; passAgain = "" }, containerColor = Panel,
            title = { Text("Save a copy") },
            text = {
                Column {
                    Text(tr("Pick a passphrase to protect the file (it holds your logins).  You'll need it to restore the file."), color = Muted, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(12.dp))
                    NewPassphrase(pass, { pass = it }, passAgain, { passAgain = it })
                }
            },
            confirmButton = { TextButton(onClick = { save.launch("tivibro-backup-" + SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(b.at)) + ".json") }, enabled = passphraseOk(pass, passAgain)) { Text(tr("Save")) } },
            dismissButton = { TextButton(onClick = { exporting = null; pass = ""; passAgain = "" }) { Text(tr("Cancel")) } },
        )
    }
    renaming?.let { b ->
        AlertDialog(
            onDismissRequest = { renaming = null }, containerColor = Panel,
            title = { Text(tr("Name this backup")) },
            text = { OutlinedTextField(newName, { newName = it.take(80) }, singleLine = true, label = { Text(tr("Like \"Before the big clean-up\"")) }) },
            confirmButton = { TextButton(onClick = { renaming = null; act { model.rename(b, newName); if (newName.isBlank()) tr("Name removed") else tr("Named") } }) { Text(tr("Save")) } },
            dismissButton = { TextButton(onClick = { renaming = null }) { Text(tr("Cancel")) } },
        )
    }
    merging?.let { a ->
        AlertDialog(
            onDismissRequest = { merging = null }, containerColor = Panel,
            title = { Text(tr("Add playlists from…")) },
            text = {
                Column {
                    Text(tr("A new backup: {x}, with the playlists (and their edits) from the one you pick that it doesn't have.", "x" to (model.backupName(a))), color = Muted, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(8.dp))
                    list.filter { it != a }.take(12).forEach { o ->
                        TextButton(onClick = { merging = null; act { val n = model.merge(a, o); trn(n, "Merged: {n} playlist added", "Merged: {n} playlists added") } }) {
                            Text(model.backupName(o) + "  ·  " + trn(o.playlists, "{n} playlist", "{n} playlists"))
                        }
                    }
                }
            },
            confirmButton = {}, dismissButton = { TextButton(onClick = { merging = null }) { Text(tr("Cancel")) } },
        )
    }
    settingsOf?.let { b -> SettingsDialog(model, b, onDone = { values ->
        settingsOf = null
        if (values.isNotEmpty()) act { model.withSettings(b, values, tr("Settings changed: {x}", "x" to model.backupName(b))); tr("Saved as a new backup") }
    }) }
    picking?.let { (b, pls) ->
        AlertDialog(
            onDismissRequest = { picking = null }, containerColor = Panel,
            title = { Text(tr("Which playlist?")) },
            text = { Column { pls.forEach { (pid, name) -> TextButton(onClick = { picking = null; onEditOffline(b, pid) }) { Text(name) } } } },
            confirmButton = {}, dismissButton = { TextButton(onClick = { picking = null }) { Text(tr("Cancel")) } },
        )
    }
    if (noCopy) AlertDialog(
        onDismissRequest = { noCopy = false }, containerColor = Panel,
        title = { Text(tr("Open the editor with the TV once")) },
        text = { Text(tr("To edit channels without the TV, the phone needs the channel list.  Open Edit channels with {x} once (on the same Wi-Fi) and wait a few seconds for \"channel list saved\".  The phone keeps a copy of each playlist you open there, and this list then shows which ones you can edit.", "x" to tv.name)) },
        confirmButton = { TextButton(onClick = { noCopy = false }) { Text("OK") } },
    )
    // Delete asks twice: a backup is the only copy of the logins it holds.
    deleting?.let { (b, step) ->
        AlertDialog(
            onDismissRequest = { deleting = null }, containerColor = Panel,
            title = { Text(if (step == 1) tr("Delete this backup?") else tr("Delete it for good?")) },
            text = { Text(if (step == 1) "${model.backupName(b)}, with ${b.playlists} playlist" + (if (b.playlists == 1) "" else "s") + "." else tr("It can't be brought back.  Your TV and your other backups aren't changed.")) },
            confirmButton = { TextButton(onClick = { if (step == 1) deleting = b to 2 else { deleting = null; model.backups.delete(b); version++; model.say(tr("Deleted")) } }) { Text(if (step == 1) tr("Delete") else tr("Delete for good"), color = Bad) } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text(tr("Keep it")) } },
        )
    }
}

/* A few settings inside a backup, changed on the phone (BackupTools.CHOICES): tap one to change it. */
@Composable
private fun SettingsDialog(model: AppModel, b: SavedBackup, onDone: (Map<BackupTools.Choice, Any>) -> Unit) {
    val backup = remember(b) { runCatching { model.openBackup(b) }.getOrNull() }
    val changed = remember { androidx.compose.runtime.mutableStateMapOf<BackupTools.Choice, Any>() }
    AlertDialog(
        onDismissRequest = { onDone(emptyMap()) }, containerColor = Panel,
        title = { Text(tr("Settings in this backup")) },
        text = {
            Column {
                Text(tr("Saved as a new backup; restore it to use them on the TV."), color = Muted, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(6.dp))
                BackupTools.CHOICES.forEach { c ->
                    val cur = changed[c] ?: backup?.let { BackupTools.get(it, c) } ?: c.default
                    val i = c.values.indexOfFirst { it.first == cur }.coerceAtLeast(0)
                    Row(Modifier.fillMaxWidth().clickable { changed[c] = c.values[(i + 1) % c.values.size].first }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(c.label, Modifier.weight(1f))
                        Text(c.values[i].second, color = if (changed.containsKey(c)) Accent else Muted)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onDone(changed.toMap()) }, enabled = changed.isNotEmpty()) { Text(tr("Save as new backup")) } },
        dismissButton = { TextButton(onClick = { onDone(emptyMap()) }) { Text(tr("Cancel")) } },
    )
}

private fun stamp(t: Long) = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(t))

/** How many backups on the phone show before "Show all". */
private const val SHOWN = 4

private fun pointTitle(p: RestorePoint) = p.name.ifBlank { if (p.auto) tr("Made by the TV") else tr("Restore point") }

/** A section heading: the one place teal is used. */
@Composable
private fun Heading(text: String) = Text(text, color = Accent2, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)

@Composable
private fun PointRow(p: RestorePoint, enabled: Boolean, onRestore: () -> Unit, onDelete: () -> Unit) {
    Surface(color = Panel, shape = MaterialTheme.shapes.medium) {
        Row(Modifier.fillMaxWidth().padding(16.dp, 10.dp, 4.dp, 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(pointTitle(p), fontWeight = FontWeight.SemiBold)
                Text(listOf(if (p.at > 0) stamp(p.at) else "", if (p.auto) tr("made by the TV") else "").filter { it.isNotBlank() }.joinToString("  ·  "),
                    color = Muted, style = MaterialTheme.typography.labelSmall)
            }
            TextButton(onClick = onRestore, enabled = enabled) { Text(tr("Restore")) }
            IconButton(onClick = onDelete, enabled = enabled) { Icon(Icons.Rounded.Delete, tr("Delete this restore point"), tint = Muted) }
        }
    }
}

@Composable
private fun BackupRow(b: SavedBackup, offline: List<String>?, others: List<Pair<String, String>>, onRestore: (String, String) -> Unit, onExport: () -> Unit, onDelete: () -> Unit,
                      onEdit: () -> Unit, onSettings: () -> Unit, onRename: () -> Unit, onDuplicate: () -> Unit, onMerge: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Surface(color = Panel, shape = MaterialTheme.shapes.medium) {
        Row(Modifier.fillMaxWidth().padding(16.dp, 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(b.label.ifBlank { stamp(b.at) }, fontWeight = FontWeight.SemiBold)
                Text(listOf(if (b.label.isNotBlank()) stamp(b.at) else "", trn(b.playlists, "{n} playlist", "{n} playlists"), if (b.auto) tr("automatic") else "", b.version.ifBlank { "" }).filter { it.isNotBlank() }.joinToString("  ·  "),
                    color = Muted, style = MaterialTheme.typography.labelSmall)
                // Says up front which playlists Edit channels on the phone can open (discussion #23).
                if (offline != null) Text(
                    if (offline.isEmpty()) tr("To edit on the phone: open Edit channels with the TV once")
                    else tr("Edit on the phone: {x}", "x" to offline.joinToString(", ")),
                    color = if (offline.isEmpty()) Muted else Accent, style = MaterialTheme.typography.labelSmall)
            }
            TextButton(onClick = { onRestore(b.tvId, "") }) { Text(tr("Restore")) }
            IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, tr("More")) }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                others.forEach { (tid, name) -> DropdownMenuItem(text = { Text(tr("Restore on {x}", "x" to name)) }, onClick = { menu = false; onRestore(tid, name) }) }
                DropdownMenuItem(text = { Text(tr("Edit channels on the phone")) }, onClick = { menu = false; onEdit() })
                DropdownMenuItem(text = { Text(tr("Change settings")) }, onClick = { menu = false; onSettings() })
                DropdownMenuItem(text = { Text(tr("Name it")) }, onClick = { menu = false; onRename() })
                DropdownMenuItem(text = { Text(tr("Duplicate")) }, onClick = { menu = false; onDuplicate() })
                DropdownMenuItem(text = { Text(tr("Add playlists from another backup")) }, onClick = { menu = false; onMerge() })
                DropdownMenuItem(text = { Text(tr("Save a copy as a file")) }, onClick = { menu = false; onExport() })
                DropdownMenuItem(text = { Text(tr("Delete"), color = Bad) }, onClick = { menu = false; onDelete() })
            }
        }
    }
}
