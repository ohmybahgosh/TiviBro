/* Backups of a TV kept on the phone: back up now, the weekly automatic backups (on unless switched off),
   put one back on this TV or another paired TV, and save a copy as a file the web editor can restore on
   any TV (sealed with a passphrase, like the editor's own backups). */
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.tivibro.phone.data.SavedBackup
import app.tivibro.phone.proto.TbException
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BackupsScreen(model: AppModel, id: String, tvs: List<TvUi>, snack: SnackbarHostState, onBack: () -> Unit) {
    val tv = tvs.firstOrNull { it.tv.id == id }?.tv ?: return
    var version by remember { mutableIntStateOf(0) }
    val list = remember(version) { model.backups.list(id) }
    var auto by remember { mutableStateOf(model.backups.auto) }
    var busy by remember { mutableStateOf(false) }
    var restoring by remember { mutableStateOf<Pair<SavedBackup, String>?>(null) }
    var exporting by remember { mutableStateOf<SavedBackup?>(null) }
    var pass by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
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
                            Text("When the phone is on your Wi-Fi and TiviBro is open on the TV.  The newest ${app.tivibro.phone.data.BackupStore.KEEP} are kept.", color = Muted, style = MaterialTheme.typography.bodySmall)
                        }
                        Switch(auto, { auto = it; model.backups.auto = it })
                    }
                }
            }
            if (list.isEmpty()) item { Text("No backups yet.", color = Muted, modifier = Modifier.padding(top = 8.dp)) }
            items(list, key = { it.file.name }) { b ->
                BackupRow(b, others = tvs.filter { it.tv.id != id }.map { it.tv.id to it.tv.name },
                    onRestore = { to, _ -> restoring = b to to },
                    onExport = { exporting = b },
                    onDelete = { model.backups.delete(b); version++ })
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
}

private fun stamp(t: Long) = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(t))

@Composable
private fun BackupRow(b: SavedBackup, others: List<Pair<String, String>>, onRestore: (String, String) -> Unit, onExport: () -> Unit, onDelete: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Surface(color = Panel, shape = MaterialTheme.shapes.medium) {
        Row(Modifier.fillMaxWidth().padding(16.dp, 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stamp(b.at), fontWeight = FontWeight.SemiBold)
                Text(listOf("${b.playlists} playlist" + (if (b.playlists == 1) "" else "s"), if (b.auto) "automatic" else "", b.version.ifBlank { "" }).filter { it.isNotBlank() }.joinToString("  ·  "),
                    color = Muted, style = MaterialTheme.typography.labelSmall)
            }
            TextButton(onClick = { onRestore(b.tvId, "") }) { Text("Restore") }
            IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, "More") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                others.forEach { (tid, name) -> DropdownMenuItem(text = { Text("Restore on $name") }, onClick = { menu = false; onRestore(tid, name) }) }
                DropdownMenuItem(text = { Text("Save a copy as a file") }, onClick = { menu = false; onExport() })
                DropdownMenuItem(text = { Text("Delete", color = Bad) }, onClick = { menu = false; onDelete() })
            }
        }
    }
}
