/* Long press on a channel (in the Guide and Channels tabs): watch it on the TV, its schedule, Favorites,
   your own groups (in or out, or a new group with it), rename it, or hide it on the TV.  The changes are
   made by TiviBro on the TV (ask "chan" in app/js/phone.js), the same as from the TV's own menus. */
package app.tivibro.phone.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarOutline
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.tivibro.phone.proto.Chan
import app.tivibro.phone.proto.ChanEdit
import app.tivibro.phone.proto.TbException
import kotlinx.coroutines.launch
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChannelSheet(
    model: AppModel, id: String, c: Chan, playing: Boolean,
    onPlay: () -> Unit, onSchedule: (() -> Unit)?, onDismiss: () -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var info by remember { mutableStateOf<ChanEdit?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var newGroup by remember { mutableStateOf(false) }
    var hiding by remember { mutableStateOf(false) }
    var fav by remember { mutableStateOf(c.fav) }

    LaunchedEffect(c.k) {
        try { info = model.chanEdit(id, c.k, "info") }
        catch (e: TbException) { error = e.message }
        catch (e: Exception) { error = "The TV didn't answer.  Is it on, and on the same network?" }
    }
    fun change(op: String, args: JSONObject = JSONObject(), close: Boolean = false) {
        busy = true
        scope.launch {
            try { info = model.chanEdit(id, c.k, op, args); if (close) onDismiss() }
            catch (e: TbException) { model.say(e.message ?: "The TV said no") }
            catch (e: Exception) { model.say("The TV didn't answer.  Is it on, and on the same network?") }
            busy = false
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Ink) {
        Column(Modifier.padding(bottom = 24.dp).verticalScroll(rememberScrollState())) {
            Row(Modifier.padding(20.dp, 0.dp, 20.dp, 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Logo(c.logo, c.number, 40.dp)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text((if (c.number.isNotBlank()) c.number + "  " else "") + (info?.name ?: c.name), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    info?.let { i -> Text(i.group + (if (i.renamed) "   ·   was " + i.provider else ""), color = Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Accent2)
            }
            Option(Icons.Rounded.PlayArrow, if (playing) "On the TV now" else "Watch on TV") { onPlay(); onDismiss() }
            onSchedule?.let { s -> Option(Icons.Rounded.CalendarMonth, "Schedule and reminders") { onDismiss(); s() } }
            Option(if (fav) Icons.Rounded.Star else Icons.Rounded.StarOutline, if (fav) "Remove from Favorites" else "Add to Favorites") {
                fav = !fav; model.favorite(id, c.k, fav)
            }
            HorizontalDivider(color = Line, modifier = Modifier.padding(vertical = 6.dp))
            Text("Your groups", color = Muted, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(20.dp, 6.dp))
            val i = info
            when {
                error != null -> Text(error ?: "", color = Bad, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(20.dp, 4.dp))
                i == null -> Text("Asking the TV…", color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(20.dp, 4.dp))
                else -> {
                    i.groups.filter { it.id != "c_fav" }.forEach { g ->
                        Option(if (g.has) Icons.Rounded.Check else null, g.name, sub = if (g.has) "In this group: tap to take it out" else null) {
                            change("group", JSONObject().put("group", g.id).put("on", !g.has))
                        }
                    }
                    Option(Icons.Rounded.Add, "New group with this channel…") { newGroup = true }
                    HorizontalDivider(color = Line, modifier = Modifier.padding(vertical = 6.dp))
                    Option(Icons.Rounded.Edit, "Rename…", sub = if (i.renamed) "Provider's name: " + i.provider else null) { renaming = true }
                    Option(Icons.Rounded.VisibilityOff, "Hide on the TV", sub = "Back in the TV's Settings > Groups, sorting, hidden") { hiding = true }
                }
            }
        }
    }

    if (renaming) NameDialog("Rename channel", info?.name ?: c.name, "Rename", extra = if (info?.renamed == true) "Use the provider's name" else null,
        onExtra = { renaming = false; change("rename", JSONObject().put("name", "")) },
        onDismiss = { renaming = false }) { n -> renaming = false; change("rename", JSONObject().put("name", n)) }
    if (newGroup) NameDialog("New group", "", "Create", onDismiss = { newGroup = false }) { n -> newGroup = false; change("newgroup", JSONObject().put("name", n)) }
    if (hiding) AlertDialog(
        onDismissRequest = { hiding = false }, containerColor = Panel,
        title = { Text("Hide " + (info?.name ?: c.name) + "?") },
        text = { Text("It leaves the TV's lists and the guide.  Bring it back in the TV's Settings > Groups, sorting, hidden, or in the web editor.") },
        confirmButton = { TextButton(onClick = { hiding = false; change("hide", JSONObject().put("on", true), close = true) }) { Text("Hide") } },
        dismissButton = { TextButton(onClick = { hiding = false }) { Text("Cancel") } },
    )
}

@Composable
private fun Option(icon: ImageVector?, label: String, sub: String? = null, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(20.dp, 12.dp), verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) Icon(icon, null, tint = Accent2, modifier = Modifier.size(22.dp)) else Spacer(Modifier.size(22.dp))
        Spacer(Modifier.width(16.dp))
        Column {
            Text(label)
            if (sub != null) Text(sub, color = Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun NameDialog(title: String, start: String, ok: String, extra: String? = null, onExtra: () -> Unit = {}, onDismiss: () -> Unit, onOk: (String) -> Unit) {
    var t by remember { mutableStateOf(start) }
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = Panel,
        title = { Text(title) },
        text = {
            Column {
                OutlinedTextField(t, { t = it }, singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { if (t.isNotBlank()) onOk(t.trim()) }))
                if (extra != null) TextButton(onClick = onExtra) { Text(extra) }
            }
        },
        confirmButton = { TextButton(onClick = { onOk(t.trim()) }, enabled = t.isNotBlank()) { Text(ok) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
