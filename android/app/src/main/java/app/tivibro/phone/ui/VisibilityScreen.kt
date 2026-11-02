/* Show or hide channels (channel sheet > Show or hide channels…): every channel of a group, hidden ones
   too, with a tick for the ones the TV shows.  Like the TV's own list: nothing changes until you leave,
   then one save (Back, the arrow, or Save).  Hiding is the TV's: a hidden channel is hidden in every group. */
package app.tivibro.phone.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.tivibro.phone.proto.TbException
import app.tivibro.phone.proto.VisList
import kotlinx.coroutines.launch

@Composable
fun VisibilityScreen(model: AppModel, id: String, group: String, k: String, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<VisList?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var saving by remember { mutableStateOf(false) }
    val on = remember { mutableStateMapOf<String, Boolean>() }

    LaunchedEffect(attempt) {
        error = null
        try { val d = model.visList(id, group, k); on.clear(); d.rows.forEach { on[it.key] = it.on }; data = d }
        catch (e: TbException) { error = e.message }
        catch (e: Exception) { error = "The TV didn't answer.  Is it on, and on the same network?" }
    }
    fun done() {
        val d = data
        if (d == null || saving) { if (!saving) onClose(); return }
        val changes = d.rows.filter { (on[it.key] ?: it.on) != it.on }.associate { it.key to (on[it.key] ?: it.on) }
        if (changes.isEmpty()) { onClose(); return }
        saving = true
        scope.launch {
            try { model.visSave(id, d.group, changes); onClose() }
            catch (e: TbException) { model.say(e.message ?: "The TV said no"); saving = false }
            catch (e: Exception) { model.say("The TV didn't answer.  Nothing was changed."); saving = false }
        }
    }

    Dialog(onDismissRequest = { done() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        BackHandler { done() }
        Column(Modifier.fillMaxSize().background(Ink)) {
            Row(Modifier.fillMaxWidth().padding(4.dp, 6.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { done() }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Save and close") }
                Column(Modifier.weight(1f)) {
                    Text(data?.title ?: "Show or hide channels", style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    data?.let { d -> Text("${d.rows.count { on[it.key] ?: it.on }} of ${d.rows.size} shown", color = Muted, style = MaterialTheme.typography.bodySmall) }
                }
                if (saving) CircularProgressIndicator(Modifier.size(20.dp).padding(end = 4.dp), strokeWidth = 2.dp, color = Accent2)
                else TextButton(onClick = { done() }, enabled = data != null) { Text("Save") }
            }
            val d = data
            when {
                d == null && error != null -> Column(Modifier.fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(error ?: ""); Spacer(Modifier.size(12.dp)); Button(onClick = { attempt++ }) { Text("Try again") }
                }
                d == null -> Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                else -> {
                    LazyRow(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        item { AssistChip(onClick = { d.rows.forEach { on[it.key] = true } }, label = { Text("Show all") }) }
                        item { AssistChip(onClick = { d.rows.forEach { on[it.key] = false } }, label = { Text("Hide all") }) }
                        item { AssistChip(onClick = { d.rows.forEach { if (!it.guide) on[it.key] = false } }, label = { Text("Hide ones with no guide") }) }
                    }
                    Text("A hidden channel is hidden in every group on the TV.", color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(16.dp, 4.dp, 16.dp, 6.dp))
                    LazyColumn(Modifier.fillMaxSize()) {
                        items(d.rows, key = { it.key }) { r ->
                            val shown = on[r.key] ?: r.on
                            Row(Modifier.fillMaxWidth().clickable { on[r.key] = !shown }.padding(16.dp, 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(40.dp).alpha(if (shown) 1f else 0.4f)) { Logo(r.logo, r.number, 40.dp) }
                                Spacer(Modifier.width(14.dp))
                                Text((if (r.number.isNotBlank()) r.number + "  " else "") + r.name, color = if (shown) TextHi else Muted,
                                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                Checkbox(checked = shown, onCheckedChange = { on[r.key] = it }, colors = CheckboxDefaults.colors(checkedColor = Accent, uncheckedColor = Muted))
                            }
                        }
                    }
                }
            }
        }
    }
}
