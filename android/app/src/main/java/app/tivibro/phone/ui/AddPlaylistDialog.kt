/* Add a playlist from the phone, all of it here (Settings > Playlists > Add playlist…): pick the playlist
   type, fill in the full link, an Xtream Codes login, an M3U address or a Stalker portal and MAC, and the TV tests and adds it the way
   the web editor's Add a playlist does.  The login is sealed on its way to the TV. */
package app.tivibro.phone.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.tivibro.phone.proto.TbException
import kotlinx.coroutines.launch
import org.json.JSONObject

private val TYPES = listOf(
    "link" to "Paste the full link from your provider",
    "xtream" to "Xtream Codes (server, username, password)",
    "m3u" to "M3U playlist address",
    "stalker" to "Stalker portal (portal address and MAC address)",
)

@Composable
fun AddPlaylistDialog(model: AppModel, id: String, onDone: (added: Boolean) -> Unit) = PlaylistDialog(model, id, null, "", "", onDone)

/** A playlist's connection changed from the phone (Settings > Playlists > the playlist > Connection): its type stays,
    and a field left blank keeps what the TV has.  [now]: the server, list or portal it uses now. */
@Composable
fun EditPlaylistDialog(model: AppModel, id: String, plId: String, plType: String, now: String, onDone: (changed: Boolean) -> Unit) = PlaylistDialog(model, id, plId, plType, now, onDone)

@Composable
private fun PlaylistDialog(model: AppModel, id: String, editId: String?, editType: String, now: String, onDone: (added: Boolean) -> Unit) {
    val scope = rememberCoroutineScope()
    val editing = editId != null
    var type by remember { mutableStateOf(if (editing) editType.ifBlank { "xtream" } else "link") }
    var open by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var link by remember { mutableStateOf("") }
    var server by remember { mutableStateOf("") }
    var user by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var m3u by remember { mutableStateOf("") }
    var portal by remember { mutableStateOf("") }
    var mac by remember { mutableStateOf("") }
    var sn by remember { mutableStateOf("") }
    var epg by remember { mutableStateOf("") }
    var use by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val ready = if (editing) listOf(name, server, user, pass, m3u, portal, mac, sn).any { it.isNotBlank() } else when (type) { "xtream" -> server.isNotBlank() && user.isNotBlank() && pass.isNotBlank(); "m3u" -> m3u.isNotBlank(); "stalker" -> portal.isNotBlank() && mac.isNotBlank(); else -> link.isNotBlank() }

    fun add() {
        busy = true; error = null
        val a = JSONObject().put("name", name.trim()).put("use", use).put("epg", epg.trim())
        if (editing) a.put("edit", editId)
        when (type) {
            "xtream" -> a.put("type", "xtream").put("server", server.trim()).put("user", user.trim()).put("pass", pass)
            "m3u" -> a.put("type", "m3u").put("m3u", m3u.trim())
            "stalker" -> a.put("type", "stalker").put("portal", portal.trim()).put("mac", mac.trim()).put("sn", sn.trim())
            else -> a.put("link", link.trim())
        }
        scope.launch {
            try { model.say(model.addPlaylistWith(id, a)); onDone(true) }
            catch (e: TbException) { error = e.message }
            catch (e: Exception) { error = "The TV didn't answer.  Is it on, and on the same network?" }
            busy = false
        }
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onDone(false) }, containerColor = Panel,
        title = { Text(if (editing) "Change the connection" else "Add a playlist") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text("The TV logs in and loads the channel list before saving it, so you know it works." + if (editing) "  Leave a box empty to keep what the TV has." else "", color = Muted, style = MaterialTheme.typography.bodySmall)
                if (editing && now.isNotBlank()) Text("Now: " + now, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
                Spacer(Modifier.size(10.dp))
                if (!editing) Text("Playlist type", style = MaterialTheme.typography.labelMedium, color = Muted)
                if (!editing) Row(Modifier.fillMaxWidth().clickable(enabled = !busy) { open = true }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(TYPES.first { it.first == type }.second, modifier = Modifier.weight(1f))
                    Icon(Icons.Rounded.ArrowDropDown, "Choose")
                    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                        TYPES.forEach { (k, l) -> DropdownMenuItem(text = { Text(l) }, onClick = { type = k; open = false }) }
                    }
                }
                OutlinedTextField(name, { name = it }, label = { Text("Name (optional)") }, singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth())
                when (type) {
                    "xtream" -> {
                        OutlinedTextField(server, { server = it.trim() }, label = { Text("Server") }, placeholder = { Text("http://provider.com:8080") }, singleLine = true, enabled = !busy,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(user, { user = it.trim() }, label = { Text("Username") }, singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(pass, { pass = it }, label = { Text("Password") }, singleLine = true, enabled = !busy,
                            visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                    }
                    "m3u" -> OutlinedTextField(m3u, { m3u = it.trim() }, label = { Text("Playlist address") }, placeholder = { Text("http://provider.com/get.php?…&type=m3u_plus") }, enabled = !busy,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth())
                    "stalker" -> {
                        OutlinedTextField(portal, { portal = it.trim() }, label = { Text("Portal address") }, placeholder = { Text("http://provider.com:8080/c/") }, singleLine = true, enabled = !busy,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(mac, { mac = it.trim() }, label = { Text("MAC address") }, placeholder = { Text("00:1A:79:12:34:56") }, singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(sn, { sn = it.trim() }, label = { Text("Serial number (optional)") }, singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth())
                        Text("The portal address your provider gave for a MAG box, and the MAC address they registered.  A serial number only if your provider gave you one.", color = Muted, style = MaterialTheme.typography.bodySmall)
                    }
                    else -> {
                        OutlinedTextField(link, { link = it.trim() }, label = { Text("Full link") }, placeholder = { Text("http://provider.com:8080/get.php?username=…") }, enabled = !busy,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth())
                        Text("The whole link your provider sent, the long one with the username and password in it (it often has get.php).", color = Muted, style = MaterialTheme.typography.bodySmall)
                    }
                }
                if (!editing) OutlinedTextField(epg, { epg = it.trim() }, label = { Text("Guide address (optional)") }, placeholder = { Text("XMLTV link, .xml or .xml.gz") }, singleLine = true, enabled = !busy,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth())
                if (!editing) Row(Modifier.fillMaxWidth().clickable(enabled = !busy) { use = !use }, verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = use, onCheckedChange = { use = it }, enabled = !busy)
                    Text("Switch the TV to it when it is added")
                }
                error?.let { Text(it, color = Bad, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp)) }
                if (busy) Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Accent)
                    Spacer(Modifier.size(10.dp))
                    Text("The TV is logging in and loading the channels.  This can take a minute…", style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = { TextButton(enabled = !busy && ready, onClick = { add() }) { Text(if (editing) "Test and save" else "Add and test") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { onDone(false) }) { Text("Cancel") } },
    )
}
