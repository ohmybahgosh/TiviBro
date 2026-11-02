/* Backups of a TV kept on the phone: back up now, the weekly automatic backups (on unless switched off),
   put one back on this TV or another paired TV, and save a copy as a file the web editor can restore on
   any TV (sealed with a passphrase, like the editor's own backups).
   Without the TV (discussion #23): name, duplicate and merge backups, change settings inside one, edit
   a playlist's channels in the web editor on the phone (OfflineEditorScreen.kt), and delete with two
   confirmations.  Each of those makes a new backup and leaves the one it came from alone. */
package app.tivibro.phone.ui

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
import androidx.compose.material.icons.rounded.Backup
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.tivibro.phone.data.BackupTools
import app.tivibro.phone.data.SavedBackup
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
    var renaming by remember { mutableStateOf<SavedBackup?>(null) }
    var newName by remember { mutableStateOf("") }
    var merging by remember { mutableStateOf<SavedBackup?>(null) }
    var settingsOf by remember { mutableStateOf<SavedBackup?>(null) }
    var deleting by remember { mutableStateOf<Pair<SavedBackup, Int>?>(null) }
    var picking by remember { mutableStateOf<Pair<SavedBackup, List<Pair<String, String>>>?>(null) }
    var noCopy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun act(what: suspend () -> String) { scope.launch { try { model.say(what()); version++ } catch (e: TbException) { model.say(e.message ?: "That didn't work") } catch (e: Exception) { model.say(e.message ?: "That didn't work") } } }
    // Edit a playlist's channels on the phone: needs the channel list the web editor kept (EditorCopies.kt).
    fun editOffline(b: SavedBackup) {
        val pls = runCatching { BackupTools.playlists(model.openBackup(b)) }.getOrDefault(emptyList()).filter { model.copies.has(id, it.first) }
        when (pls.size) { 0 -> noCopy = true; 1 -> onEditOffline(b, pls[0].first); else -> picking = b to pls }
    }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val b = exporting; val p = pass
        exporting = null; pass = ""
        if (uri != null && b != null) scope.launch {
            try { model.exportBackup(b, p, uri); model.say("Saved.  Restore it in the web editor: Backup and restore.") } catch (e: Exception) { model.say(e.message ?: "Couldn't save the file.") }
        }
    }

    Scaffold(
        containerColor = Ink, snackbarHost = { SnackbarHost(snack) },
        topBar = {
            TopAppBar(title = { Text("Backups: ${tv.name}") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Ink))
        },
    ) { pad ->
        LazyColumn(Modifier.padding(pad).fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Text("Everything on the TV: playlists with their logins, your channel edits, favorites, groups and settings.  Kept on this phone, encrypted, and never sent anywhere else.",
                    color = Muted, style = MaterialTheme.typography.bodySmall)
            }
            item {
                Button(
                    onClick = {
                        busy = true
                        scope.launch {
                            try { model.backupNow(id); version++; model.say("Backed up ${tv.name}") }
                            catch (e: TbException) { model.say(e.message ?: "The TV said no") }
                            catch (e: Exception) { model.say("The TV didn't answer.  Is it on, and on the same network?") }
                            finally { busy = false }
                        }
                    },
                    enabled = !busy, modifier = Modifier.fillMaxWidth().height(52.dp),
                ) {
                    if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Rounded.Backup, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(10.dp)); Text("Back up now")
                }
            }
            item {
                Surface(color = Panel, shape = MaterialTheme.shapes.medium) {
                    Row(Modifier.fillMaxWidth().clickable { auto = !auto; model.backups.auto = auto }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Back up every week")
                            Text("When the phone is on your Wi-Fi and TiviBro is open on the TV.  The newest ${app.tivibro.phone.data.BackupStore.KEEP} automatic ones are kept; named, copied and edited ones stay until you delete them.", color = Muted, style = MaterialTheme.typography.bodySmall)
                        }
                        Switch(auto, { auto = it; model.backups.auto = it })
                    }
                }
            }
            if (list.isEmpty()) item { Text("No backups yet.", color = Muted, modifier = Modifier.padding(top = 8.dp)) }
            items(list, key = { it.file.name }) { b ->
                BackupRow(b, offline = offline[b.file.name], others = tvs.filter { it.tv.id != id }.map { it.tv.id to it.tv.name },
                    onRestore = { to, _ -> restoring = b to to },
                    onExport = { exporting = b },
                    onDelete = { deleting = b to 1 },
                    onEdit = { editOffline(b) },
                    onSettings = { settingsOf = b },
                    onRename = { renaming = b; newName = b.label },
                    onDuplicate = { act { model.duplicate(b); "Copied" } },
                    onMerge = { if (list.size < 2) model.say("Make another backup first: merging adds the playlists of one backup to another.") else merging = b })
            }
        }
    }

    restoring?.let { (b, to) ->
        val toName = tvs.firstOrNull { it.tv.id == to }?.tv?.name ?: "the TV"
        AlertDialog(
            onDismissRequest = { restoring = null }, containerColor = Panel,
            title = { Text("Restore on $toName?") },
            text = { Text("This replaces the playlists, edits and settings on $toName with the backup from ${stamp(b.at)}.  TiviBro restarts on the TV.") },
            confirmButton = {
                TextButton(onClick = {
                    restoring = null
                    scope.launch {
                        try { model.say(model.restore(to, b)) } catch (e: TbException) { model.say(e.message ?: "The TV said no") } catch (e: Exception) { model.say("The TV didn't answer.  Is it on, and on the same network?") }
                    }
                }) { Text("Restore") }
            },
            dismissButton = { TextButton(onClick = { restoring = null }) { Text("Cancel") } },
        )
    }
    exporting?.let { b ->
        AlertDialog(
            onDismissRequest = { exporting = null; pass = "" }, containerColor = Panel,
            title = { Text("Save a copy") },
            text = {
                Column {
                    Text("Pick a passphrase to protect the file (it holds your logins).  You'll need it to restore the file in the web editor.", color = Muted, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(pass, { pass = it }, singleLine = true, label = { Text("Passphrase, 8 or more characters") }, visualTransformation = PasswordVisualTransformation())
                }
            },
            confirmButton = { TextButton(onClick = { save.launch("tivibro-backup-" + SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(b.at)) + ".json") }, enabled = pass.length >= 8) { Text("Save") } },
            dismissButton = { TextButton(onClick = { exporting = null; pass = "" }) { Text("Cancel") } },
        )
    }
    renaming?.let { b ->
        AlertDialog(
            onDismissRequest = { renaming = null }, containerColor = Panel,
            title = { Text("Name this backup") },
            text = { OutlinedTextField(newName, { newName = it.take(80) }, singleLine = true, label = { Text("Like \"Before the big clean-up\"") }) },
            confirmButton = { TextButton(onClick = { renaming = null; act { model.rename(b, newName); if (newName.isBlank()) "Name removed" else "Named" } }) { Text("Save") } },
            dismissButton = { TextButton(onClick = { renaming = null }) { Text("Cancel") } },
        )
    }
    merging?.let { a ->
        AlertDialog(
            onDismissRequest = { merging = null }, containerColor = Panel,
            title = { Text("Add playlists from…") },
            text = {
                Column {
                    Text("A new backup: ${model.backupName(a)}, with the playlists (and their edits) from the one you pick that it doesn't have.", color = Muted, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(8.dp))
                    list.filter { it != a }.take(12).forEach { o ->
                        TextButton(onClick = { merging = null; act { val n = model.merge(a, o); "Merged: $n playlist" + (if (n == 1) "" else "s") + " added" } }) {
                            Text(model.backupName(o) + "  ·  ${o.playlists} playlist" + (if (o.playlists == 1) "" else "s"))
                        }
                    }
                }
            },
            confirmButton = {}, dismissButton = { TextButton(onClick = { merging = null }) { Text("Cancel") } },
        )
    }
    settingsOf?.let { b -> SettingsDialog(model, b, onDone = { values ->
        settingsOf = null
        if (values.isNotEmpty()) act { model.withSettings(b, values, "Settings changed: " + model.backupName(b)); "Saved as a new backup" }
    }) }
    picking?.let { (b, pls) ->
        AlertDialog(
            onDismissRequest = { picking = null }, containerColor = Panel,
            title = { Text("Which playlist?") },
            text = { Column { pls.forEach { (pid, name) -> TextButton(onClick = { picking = null; onEditOffline(b, pid) }) { Text(name) } } } },
            confirmButton = {}, dismissButton = { TextButton(onClick = { picking = null }) { Text("Cancel") } },
        )
    }
    if (noCopy) AlertDialog(
        onDismissRequest = { noCopy = false }, containerColor = Panel,
        title = { Text("Open the editor with the TV once") },
        text = { Text("To edit channels without the TV, the phone needs the channel list.  Open Edit channels with ${tv.name} once (on the same Wi-Fi) and wait a few seconds for \"channel list saved\".  The phone keeps a copy of each playlist you open there, and this list then shows which ones you can edit.") },
        confirmButton = { TextButton(onClick = { noCopy = false }) { Text("OK") } },
    )
    // Delete asks twice: a backup is the only copy of the logins it holds.
    deleting?.let { (b, step) ->
        AlertDialog(
            onDismissRequest = { deleting = null }, containerColor = Panel,
            title = { Text(if (step == 1) "Delete this backup?" else "Delete it for good?") },
            text = { Text(if (step == 1) "${model.backupName(b)}, with ${b.playlists} playlist" + (if (b.playlists == 1) "" else "s") + "." else "It can't be brought back.  Your TV and your other backups aren't changed.") },
            confirmButton = { TextButton(onClick = { if (step == 1) deleting = b to 2 else { deleting = null; model.backups.delete(b); version++; model.say("Deleted") } }) { Text(if (step == 1) "Delete" else "Delete for good", color = Bad) } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Keep it") } },
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
        title = { Text("Settings in this backup") },
        text = {
            Column {
                Text("Saved as a new backup; restore it to use them on the TV.", color = Muted, style = MaterialTheme.typography.bodySmall)
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
        confirmButton = { TextButton(onClick = { onDone(changed.toMap()) }, enabled = changed.isNotEmpty()) { Text("Save as new backup") } },
        dismissButton = { TextButton(onClick = { onDone(emptyMap()) }) { Text("Cancel") } },
    )
}

private fun stamp(t: Long) = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(t))

@Composable
private fun BackupRow(b: SavedBackup, offline: List<String>?, others: List<Pair<String, String>>, onRestore: (String, String) -> Unit, onExport: () -> Unit, onDelete: () -> Unit,
                      onEdit: () -> Unit, onSettings: () -> Unit, onRename: () -> Unit, onDuplicate: () -> Unit, onMerge: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Surface(color = Panel, shape = MaterialTheme.shapes.medium) {
        Row(Modifier.fillMaxWidth().padding(16.dp, 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(b.label.ifBlank { stamp(b.at) }, fontWeight = FontWeight.SemiBold)
                Text(listOf(if (b.label.isNotBlank()) stamp(b.at) else "", "${b.playlists} playlist" + (if (b.playlists == 1) "" else "s"), if (b.auto) "automatic" else "", b.version.ifBlank { "" }).filter { it.isNotBlank() }.joinToString("  ·  "),
                    color = Muted, style = MaterialTheme.typography.labelSmall)
                // Says up front which playlists Edit channels on the phone can open (discussion #23).
                if (offline != null) Text(
                    if (offline.isEmpty()) "To edit on the phone: open Edit channels with the TV once"
                    else "Edit on the phone: " + offline.joinToString(", "),
                    color = if (offline.isEmpty()) Muted else Accent, style = MaterialTheme.typography.labelSmall)
            }
            TextButton(onClick = { onRestore(b.tvId, "") }) { Text("Restore") }
            IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, "More") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                others.forEach { (tid, name) -> DropdownMenuItem(text = { Text("Restore on $name") }, onClick = { menu = false; onRestore(tid, name) }) }
                DropdownMenuItem(text = { Text("Edit channels on the phone") }, onClick = { menu = false; onEdit() })
                DropdownMenuItem(text = { Text("Change settings") }, onClick = { menu = false; onSettings() })
                DropdownMenuItem(text = { Text("Name it") }, onClick = { menu = false; onRename() })
                DropdownMenuItem(text = { Text("Duplicate") }, onClick = { menu = false; onDuplicate() })
                DropdownMenuItem(text = { Text("Add playlists from another backup") }, onClick = { menu = false; onMerge() })
                DropdownMenuItem(text = { Text("Save a copy as a file") }, onClick = { menu = false; onExport() })
                DropdownMenuItem(text = { Text("Delete", color = Bad) }, onClick = { menu = false; onDelete() })
            }
        }
    }
}
