/* TiviBro's Settings on the phone: every page the TV has, built by the TV's own code and sent as rows
   (ask "settings", see Settings.phone in app/js/settings.js), so the phone always matches the TV.
   Switches and choices change the TV at once; buttons run on the TV (a box they open can be typed into
   from the phone).  Locked with the TV's PIN when its Settings are. */
package app.tivibro.phone.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.ChevronLeft
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.tivibro.phone.proto.TbException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/** One row of a settings page, as the TV sends it. */
data class SetRow(
    val i: Int, val kind: String, val label: String, val sub: String, val value: String,
    val on: Boolean, val options: List<String>, val cur: Int, val swatch: String,
) {
    companion object {
        fun from(j: JSONObject) = SetRow(
            j.optInt("i"), j.optString("kind"), j.optString("label"), j.optString("sub"), j.optString("value"),
            j.optBoolean("on"), j.optJSONArray("options")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty(), j.optInt("cur", -1), j.optString("swatch"),
        )
    }
}
private data class SetPage(val title: String, val rows: List<SetRow>)
private fun pageOf(j: JSONObject) = SetPage(j.optString("title"), j.optJSONArray("rows")?.let { a -> (0 until a.length()).map { SetRow.from(a.getJSONObject(it)) } }.orEmpty())

@Composable
fun SettingsTab(model: AppModel, id: String) {
    val scope = rememberCoroutineScope()
    var pin by remember { mutableStateOf("") }
    var askPin by remember { mutableStateOf<String?>(null) }
    var sections by remember { mutableStateOf<List<Pair<String, String>>?>(null) }
    var sec by remember { mutableStateOf<String?>(null) }
    var path by remember { mutableStateOf(listOf<Int>()) }
    var page by remember { mutableStateOf<SetPage?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf<SetRow?>(null) }

    // Every request carries where we are and the PIN (if one was typed); the answer may say "locked".
    fun send(op: String, extra: JSONObject = JSONObject(), then: (JSONObject) -> Unit) {
        busy = true; error = null
        scope.launch {
            try {
                val a = extra.put("op", op)
                sec?.let { a.put("sec", it) }
                a.put("path", JSONArray(path))
                if (pin.isNotEmpty()) a.put("pin", pin)
                val r = model.ask(id, "settings", a, seal = true, tries = 2)
                if (r.optBoolean("locked")) { askPin = r.optString("msg"); pin = "" } else then(r)
            } catch (e: TbException) { error = e.message }
            catch (e: Exception) { error = "The TV didn't answer.  Is it on, and on the same network?" }
            busy = false
        }
    }
    fun loadSections() = send("sections") { r ->
        val a = r.optJSONArray("sections") ?: JSONArray()
        sections = (0 until a.length()).map { a.getJSONObject(it).let { s -> s.optString("id") to s.optString("title") } }
    }
    fun loadPage() = send("page") { r -> page = pageOf(r) }
    fun change(op: String, row: SetRow, extra: JSONObject = JSONObject()) = send(op, extra.put("i", row.i)) { r ->
        r.optJSONObject("page")?.let { page = pageOf(it) }
        r.optString("msg").takeIf { it.isNotBlank() }?.let { model.say(it) }
    }

    LaunchedEffect(Unit) { loadSections() }
    LaunchedEffect(sec, path) { if (sec != null) { page = null; loadPage() } }
    BackHandler(enabled = sec != null) { if (path.isNotEmpty()) path = path.dropLast(1) else { sec = null; page = null } }

    Column(Modifier.fillMaxSize()) {
        if (sec != null) Row(Modifier.fillMaxWidth().padding(4.dp, 2.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { if (path.isNotEmpty()) path = path.dropLast(1) else { sec = null; page = null } }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
            Text(page?.title ?: sections?.firstOrNull { it.first == sec }?.second ?: "", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            if (busy) CircularProgressIndicator(Modifier.size(18.dp).padding(end = 4.dp), strokeWidth = 2.dp, color = Accent2)
            Spacer(Modifier.width(12.dp))
        }
        error?.let { Text(it, color = Bad, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(16.dp, 6.dp)) }
        when {
            sec == null -> {
                val l = sections
                if (l == null) Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { if (error == null) CircularProgressIndicator() else Button(onClick = { loadSections() }) { Text("Try again") } }
                else LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                    item { Text("The TV's own settings.  Changes apply on the TV right away.", color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(16.dp, 8.dp)) }
                    items(l, key = { it.first }) { (sid, title) ->
                        Row(Modifier.fillMaxWidth().clickable { path = emptyList(); sec = sid }.padding(16.dp, 16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(title, modifier = Modifier.weight(1f))
                            Icon(Icons.Rounded.ChevronRight, null, tint = Muted)
                        }
                        HorizontalDivider(color = Line.copy(alpha = 0.5f), thickness = 0.5.dp)
                    }
                }
            }
            page == null -> Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { if (error == null) CircularProgressIndicator() else Button(onClick = { loadPage() }) { Text("Try again") } }
            else -> LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                items(page!!.rows, key = { it.i }) { r -> SettingRow(r,
                    onToggle = { v -> change("toggle", r, JSONObject().put("on", v)) },
                    onPick = { picking = r },
                    onCycle = { d -> change("cycle", r, JSONObject().put("dir", d)) },
                    onOpen = { path = path + r.i },
                    onAction = { change("action", r) }) }
            }
        }
    }

    picking?.let { r ->
        AlertDialog(
            onDismissRequest = { picking = null }, containerColor = Panel,
            title = { Text(r.label) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    if (r.sub.isNotBlank()) Text(r.sub, color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 8.dp))
                    r.options.forEachIndexed { n, o ->
                        Row(Modifier.fillMaxWidth().clickable { picking = null; change("choice", r, JSONObject().put("v", n)) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = n == r.cur, onClick = { picking = null; change("choice", r, JSONObject().put("v", n)) })
                            Text(o)
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { picking = null }) { Text("Close") } },
        )
    }
    askPin?.let { why ->
        var t by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { askPin = null }, containerColor = Panel,
            title = { Text("PIN") },
            text = {
                Column {
                    Text(why, color = Muted, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.size(8.dp))
                    OutlinedTextField(t, { v -> t = v.filter { it.isDigit() }.take(4) }, singleLine = true, visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                }
            },
            confirmButton = { TextButton(onClick = { pin = t; askPin = null; if (sec == null) loadSections() else loadPage() }, enabled = t.length == 4) { Text("Unlock") } },
            dismissButton = { TextButton(onClick = { askPin = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun SettingRow(r: SetRow, onToggle: (Boolean) -> Unit, onPick: () -> Unit, onCycle: (Int) -> Unit, onOpen: () -> Unit, onAction: () -> Unit) {
    when (r.kind) {
        "head" -> Text(r.label, color = Accent2, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(16.dp, 18.dp, 16.dp, 4.dp))
        "info" -> {
            if (r.value.isBlank()) Text(r.label, color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(16.dp, 8.dp))
            else Row(Modifier.fillMaxWidth().padding(16.dp, 10.dp)) {
                Text(r.label, color = Muted, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(12.dp))
                Text(r.value, textAlign = TextAlign.End, modifier = Modifier.weight(1f))
            }
        }
        else -> {
            val click: (() -> Unit)? = when (r.kind) { "toggle" -> { { onToggle(!r.on) } }; "choice" -> onPick; "page" -> onOpen; "action" -> onAction; else -> null }
            Row(Modifier.fillMaxWidth().let { if (click != null) it.clickable(onClick = click) else it }.padding(16.dp, 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(r.label, fontWeight = if (r.kind == "action") FontWeight.SemiBold else FontWeight.Normal, color = if (r.kind == "action") Accent2 else TextHi)
                    if (r.sub.isNotBlank()) Text(r.sub, color = Muted, style = MaterialTheme.typography.bodySmall)
                    if (r.kind == "choice" || r.kind == "page" || r.kind == "action") if (r.value.isNotBlank()) Text(r.value, color = Accent, style = MaterialTheme.typography.bodyMedium)
                }
                if (r.swatch.isNotBlank()) {
                    val col = runCatching { Color(android.graphics.Color.parseColor(r.swatch)) }.getOrNull()
                    if (col != null) { Spacer(Modifier.width(8.dp)); Box(Modifier.size(18.dp).clip(CircleShape).background(col)) }
                }
                when (r.kind) {
                    "toggle" -> Switch(checked = r.on, onCheckedChange = onToggle)
                    "page" -> Icon(Icons.Rounded.ChevronRight, null, tint = Muted)
                    "cycle" -> {
                        IconButton(onClick = { onCycle(-1) }) { Icon(Icons.Rounded.ChevronLeft, "Previous") }
                        Text(r.value)
                        IconButton(onClick = { onCycle(1) }) { Icon(Icons.Rounded.ChevronRight, "Next") }
                    }
                }
            }
        }
    }
    if (r.kind != "head") HorizontalDivider(color = Line.copy(alpha = 0.35f), thickness = 0.5.dp, modifier = Modifier.padding(start = 16.dp))
}
