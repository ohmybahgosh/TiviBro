/* TiviBro's Settings on the phone: every page the TV has, built by the TV's own code and sent as rows
   (ask "settings", see Settings.phone in app/js/settings.js), so the phone always matches the TV.
   Switches and choices change the TV at once.  Buttons run on the TV, and any question they ask (a box
   to type in, a menu, an "are you sure") is asked here instead (TvDialogs.kt), so nothing needs
   answering on the TV.  Some buttons open the phone's own screens: My media sources and the TMDB token
   (MediaSourcesDialogs.kt), the log, Reminders, Backups and restore points, and the web editor.  A few
   things only make sense on the TV's screen (the button tester, the set-up tour): those say so.
   Locked with the TV's PIN when its Settings are. */
package app.tivibro.phone.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.style.TextOverflow
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
import androidx.compose.material.icons.rounded.Tv
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.rounded.Article
import androidx.compose.material.icons.rounded.CalendarViewWeek
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.EmojiEvents
import androidx.compose.material.icons.rounded.FiberManualRecord
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.PhoneAndroid
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Restore
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.SettingsRemote
import androidx.compose.material.icons.rounded.Subtitles
import androidx.compose.material.icons.rounded.Translate
import androidx.compose.material.icons.rounded.UnfoldMore
import androidx.compose.material.icons.rounded.VideoLibrary
import androidx.compose.material.icons.rounded.ViewList
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.ImeAction
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
import androidx.compose.ui.platform.LocalUriHandler
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
import app.tivibro.phone.proto.TvDialog
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/** One row of a settings page, as the TV sends it. */
data class SetRow(
    val i: Int, val kind: String, val label: String, val sub: String, val value: String,
    val on: Boolean, val options: List<String>, val cur: Int, val swatch: String,
    /** A button the phone does itself (Settings.phone's phoneDoes): media-add, media-source (with [sid]), tmdb-token,
        log, reminders, backups, editor (on the editor page [epage]). */
    val phone: String = "", val sid: String = "", val epage: String = "",
    /** It happens on the TV's screen (the button tester, learning a button, the set-up tour). */
    val tv: Boolean = false,
    /** edit-playlist: the playlist's type (its id is [sid]). */
    val ptype: String = "",
    /** The row's look on the TV (the Settings overhaul): head, choice, toggle, page, action, status, note.  Older TVs send none. */
    val look: String = "",
    /** It wants you: an update ready, a problem.  Drawn so it stands out. */
    val attn: Boolean = false,
    /** tip (a note to read first), jump (goes to a setting), adv-row (the page's Advanced settings). */
    val style: String = "",
    /** The note's first sentence, when it has more ([sub] is all of it). */
    val brief: String = "",
    /** A row that opens another section (the TV's link()): its id.  The phone opens it here; older TVs send none. */
    val go: String = "",
    /** A button's weight (settings.js actionTone): "go" does its job right now (Reload guide now), "danger" deletes
        or resets and asks first.  Blank for the rest; older TVs send none. */
    val tone: String = "",
) {
    companion object {
        fun from(j: JSONObject) = SetRow(
            j.optInt("i"), j.optString("kind"), j.optString("label"), j.optString("sub"), j.optString("value"),
            j.optBoolean("on"), j.optJSONArray("options")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty(), j.optInt("cur", -1), j.optString("swatch"),
            j.optString("phone"), j.optString("sid"), j.optString("epage"), j.optInt("tv") == 1 || j.optBoolean("tv"), j.optString("ptype"),
            j.optString("look"), j.optInt("attn") == 1, j.optString("style"), j.optString("brief"), j.optString("go"), j.optString("tone"),
        )
    }
}
/** The buttons this app does with its own forms; others run on the TV. */
private val NATIVE = setOf("media-add", "media-source", "tmdb-token", "add-playlist", "edit-playlist")
/** The buttons that open one of the phone's own screens ([SettingsTab]'s onGo, except the log, shown here). */
private val SCREENS = setOf("reminders", "backups", "editor")
private data class SetPage(val title: String, val rows: List<SetRow>)
private fun pageOf(j: JSONObject) = SetPage(j.optString("title"), j.optJSONArray("rows")?.let { a -> (0 until a.length()).map { SetRow.from(a.getJSONObject(it)) } }.orEmpty())

/** [startSec]: a section to open first (one of the TV's section ids, such as "media").  [onGo] opens one of
    the phone's own screens: "reminders", "backups" or "editor" (with an editor page id, or ""). */
@Composable
fun SettingsTab(model: AppModel, id: String, startSec: String? = null, onGo: (String, String) -> Unit = { _, _ -> }) {
    val scope = rememberCoroutineScope()
    val uri = LocalUriHandler.current
    var pin by remember { mutableStateOf("") }
    var askPin by remember { mutableStateOf<String?>(null) }
    var sections by remember { mutableStateOf<List<Pair<String, String>>?>(null) }
    var sec by remember { mutableStateOf(startSec?.takeIf { it.isNotBlank() }) }
    var path by remember { mutableStateOf(listOf<Int>()) }
    var page by remember { mutableStateOf<SetPage?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf<SetRow?>(null) }
    var showLog by remember { mutableStateOf(false) }
    var native by remember { mutableStateOf<SetRow?>(null) }      // a media-add, media-source or tmdb-token row open here
    var question by remember { mutableStateOf<TvDialog?>(null) }  // a question from the TV, asked here
    if (showLog) { LogScreen(model, id) { showLog = false }; return }

    // Every request carries where we are and the PIN (if one was typed); the answer may say "locked".
    fun send(op: String, extra: JSONObject = JSONObject(), timeoutMs: Int = 45_000, tries: Int = 2, then: (JSONObject) -> Unit) {
        busy = true; error = null
        scope.launch {
            try {
                val a = extra.put("op", op)
                sec?.let { a.put("sec", it) }
                a.put("path", JSONArray(path))
                if (pin.isNotEmpty()) a.put("pin", pin)
                val r = model.ask(id, "settings", a, seal = true, timeoutMs = timeoutMs, tries = tries)
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
    // A reply to a change or an answer: the page again, what the TV would have said, and maybe the next question.
    fun reply(r: JSONObject) {
        r.optJSONObject("page")?.let { page = pageOf(it) }
        r.optString("msg").takeIf { it.isNotBlank() }?.let { model.say(it) }
        question = TvDialog.from(r)
    }
    fun change(op: String, row: SetRow, extra: JSONObject = JSONObject()) =
        if (op == "action") send(op, extra.put("i", row.i), timeoutMs = 25_000, tries = 1) { reply(it) }
        else send(op, extra.put("i", row.i)) { reply(it) }
    fun answer(a: JSONObject) { question = null; send("answer", a, timeoutMs = 25_000, tries = 1) { reply(it) } }
    fun press(r: SetRow) {
        when {
            r.phone in NATIVE -> native = r
            r.phone == "log" -> showLog = true
            r.phone == "open-url" && r.epage.startsWith("https://") -> runCatching { uri.openUri(r.epage) }.onFailure { change("action", r) }
            r.phone in SCREENS -> onGo(r.phone, r.epage)
            else -> change("action", r)
        }
    }

    LaunchedEffect(Unit) { loadSections() }
    // A Dropbox folder added (its dialog is MainActivity's): the open page shows the new source.
    LaunchedEffect(Unit) { model.mediaChanged.collect { if (sec != null) loadPage() } }
    LaunchedEffect(sec, path) { if (sec != null) { page = null; loadPage() } }
    BackHandler(enabled = sec != null) { if (path.isNotEmpty()) path = path.dropLast(1) else { sec = null; page = null } }

    var query by remember { mutableStateOf("") }
    var hits by remember { mutableStateOf<List<SetHit>?>(null) }
    var found by remember { mutableStateOf("") }      // a search hit's name, lit up once its page opens
    // Searching every setting on the TV (settings.js find), a moment after typing stops.
    LaunchedEffect(query) {
        val q = query.trim()
        if (q.length < 2) { hits = null; return@LaunchedEffect }
        kotlinx.coroutines.delay(300)
        send("find", JSONObject().put("q", q)) { r -> hits = r.optJSONArray("hits")?.let { a -> (0 until a.length()).map { SetHit.from(a.getJSONObject(it)) } }.orEmpty() }
    }

    Column(Modifier.fillMaxSize()) {
        if (sec != null) Row(Modifier.fillMaxWidth().padding(4.dp, 2.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { if (path.isNotEmpty()) path = path.dropLast(1) else { sec = null; page = null } }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
            Text(page?.title ?: sections?.firstOrNull { it.first == sec }?.second ?: "", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            if (busy) CircularProgressIndicator(Modifier.size(18.dp).padding(end = 4.dp), strokeWidth = 2.dp, color = Accent)
            Spacer(Modifier.width(12.dp))
        }
        error?.let { Text(it, color = Bad, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(16.dp, 6.dp)) }
        when {
            sec == null -> {
                val l = sections
                if (l == null) Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { if (error == null) CircularProgressIndicator() else Button(onClick = { loadSections() }) { Text("Try again") } }
                else LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    item { SearchBox(query, { query = it }) }
                    val h = hits
                    if (h != null) {
                        item { Text(if (h.isEmpty()) "No setting has that in its name or its note." else "${h.size} setting${if (h.size == 1) "" else "s"}", color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(4.dp, 4.dp)) }
                        if (h.isNotEmpty()) item {
                            SetCard { h.forEachIndexed { n, x ->
                                if (n > 0) HorizontalDivider(color = Line.copy(alpha = 0.5f), thickness = 0.5.dp)
                                Row(Modifier.fillMaxWidth().clickable { found = x.label; query = ""; path = x.path; sec = x.sec }.padding(16.dp, 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(x.label, fontWeight = FontWeight.Medium)
                                        Text(x.trail + if (x.sub.isNotBlank()) "  ·  " + x.sub else "", color = Muted, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    }
                                    Icon(Icons.Rounded.ChevronRight, null, tint = Muted)
                                }
                            } }
                        }
                    } else {
                        // The sections in four groups, each a card, with an icon apiece (SectionGroups).
                        SECTION_GROUPS.forEach { (title, ids) ->
                            val mine = ids.mapNotNull { sid -> l.firstOrNull { it.first == sid } }
                            if (mine.isNotEmpty()) {
                                item(key = "h-$title") { SetHead(title) }
                                item(key = "c-$title") { SetCard { mine.forEachIndexed { n, (sid, t) ->
                                    if (n > 0) HorizontalDivider(color = Line.copy(alpha = 0.5f), thickness = 0.5.dp, modifier = Modifier.padding(start = 64.dp))
                                    SectionRow(sid, t) { path = emptyList(); sec = sid }
                                } } }
                            }
                        }
                        // Sections a newer TV has that this app doesn't group yet: at the end, so none goes missing.
                        val rest = l.filter { s0 -> SECTION_GROUPS.none { s0.first in it.second } }
                        item(key = "c-more") { SetCard {
                            rest.forEach { (sid, t) -> SectionRow(sid, t) { path = emptyList(); sec = sid }; HorizontalDivider(color = Line.copy(alpha = 0.5f), thickness = 0.5.dp, modifier = Modifier.padding(start = 64.dp)) }
                            SectionRow("log", "TiviBro log", "What TiviBro on the TV did and what went wrong") { showLog = true }
                        } }
                    }
                }
            }
            page == null -> Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { if (error == null) CircularProgressIndicator() else Button(onClick = { loadPage() }) { Text("Try again") } }
            else -> {
              // The rows are read later by the list, after Back may have cleared the page: keep this page's.
              val cards = cardsOf(page?.rows.orEmpty())
              val lit = found
              LazyColumn(contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                cards.forEachIndexed { n, (head, rows) ->
                  if (head.isNotBlank()) item(key = "h$n") { SetHead(head) }
                  item(key = "c$n") { SetCard { rows.forEachIndexed { k, r ->
                    if (k > 0) HorizontalDivider(color = Line.copy(alpha = 0.45f), thickness = 0.5.dp)
                    SettingRow(r, lit = lit.isNotBlank() && r.label == lit,
                        onToggle = { v -> change("toggle", r, JSONObject().put("on", v)) },
                        onPick = { picking = r },
                        onChoose = { v -> change("choice", r, JSONObject().put("v", v)) },
                        onCycle = { d -> change("cycle", r, JSONObject().put("dir", d)) },
                        onOpen = { found = ""; path = path + r.i },
                        onAction = { if (r.go.isNotBlank() && sections?.any { it.first == r.go } != false) { path = emptyList(); sec = r.go } else press(r) })
                  } } }
                }
              }
            }
        }
    }

    question?.let { d -> TvQuestion(d) { a -> answer(a) } }
    native?.let { r ->
        val done: (Boolean) -> Unit = { changed -> native = null; if (changed) loadPage() }
        when (r.phone) {
            "media-add" -> MediaAddDialog(model, id, done)
            "media-source" -> MediaSourceDialog(model, id, r.sid, done)
            "tmdb-token" -> TmdbTokenDialog(model, id, r.value == "Saved", done)
            "add-playlist" -> AddPlaylistDialog(model, id, done)
            "edit-playlist" -> EditPlaylistDialog(model, id, r.sid, r.ptype, r.value, done)
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

/** A search hit (settings.js find): its name, where it is, and the rows to follow to its page. */
private data class SetHit(val label: String, val sub: String, val trail: String, val sec: String, val path: List<Int>) {
    companion object {
        fun from(j: JSONObject) = SetHit(j.optString("label"), j.optString("sub"), j.optString("trail"), j.optString("sec"),
            j.optJSONArray("path")?.let { a -> (0 until a.length()).map { a.optInt(it) } }.orEmpty())
    }
}

/* The TV's sections in four groups on the phone's Settings home, each with an icon and a colour, so the one
   you want is quick to spot.  Ids the TV sends that aren't here go in a last card (newer TVs). */
private val SECTION_GROUPS = listOf(
    "Watching" to listOf("guide", "sports", "playback", "audio", "recording", "reminders"),
    "Channels and library" to listOf("playlists", "channels", "names", "vod", "media"),
    "Look and control" to listOf("look", "remote", "language", "parental"),
    "System" to listOf("connect", "keys", "backups", "about"),
)
private fun sectionIcon(id: String): Pair<ImageVector, Color> = when (id) {
    "guide" -> Icons.Rounded.CalendarViewWeek to Accent
    "sports" -> Icons.Rounded.EmojiEvents to Warn
    "playback" -> Icons.Rounded.PlayArrow to Accent2
    "audio" -> Icons.Rounded.Subtitles to Accent2
    "recording" -> Icons.Rounded.FiberManualRecord to Bad
    "reminders" -> Icons.Rounded.Notifications to Warn
    "playlists" -> Icons.Rounded.Tv to Good
    "channels" -> Icons.Rounded.ViewList to Good
    "names" -> Icons.Rounded.Edit to Good
    "vod" -> Icons.Rounded.Movie to Accent
    "media" -> Icons.Rounded.VideoLibrary to Accent
    "look" -> Icons.Rounded.Palette to Accent2
    "remote" -> Icons.Rounded.SettingsRemote to Accent2
    "language" -> Icons.Rounded.Translate to Accent2
    "parental" -> Icons.Rounded.Lock to Warn
    "connect" -> Icons.Rounded.PhoneAndroid to Muted
    "keys" -> Icons.Rounded.Key to Muted
    "backups" -> Icons.Rounded.Restore to Muted
    "log" -> Icons.Rounded.Article to Muted
    else -> Icons.Rounded.Settings to Muted
}

@Composable
private fun SearchBox(q: String, set: (String) -> Unit) {
    OutlinedTextField(q, set, singleLine = true, placeholder = { Text("Search all settings") }, shape = RoundedCornerShape(14.dp),
        leadingIcon = { Icon(Icons.Rounded.Search, null, tint = Muted) },
        trailingIcon = { if (q.isNotEmpty()) IconButton(onClick = { set("") }) { Icon(Icons.Rounded.Close, "Clear") } },
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), modifier = Modifier.fillMaxWidth())
}
/** A heading above a card: small capitals in the accent colour. */
@Composable
private fun SetHead(t: String) = Text(t.uppercase(), color = Color(0xFF7DA2FF), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(6.dp, 10.dp, 6.dp, 0.dp))
/** A rounded card holding rows. */
@Composable
private fun SetCard(content: @Composable () -> Unit) =
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Panel).border(1.dp, Line.copy(alpha = 0.8f), RoundedCornerShape(18.dp))) { content() }
@Composable
private fun SectionRow(id: String, title: String, sub: String = "", onClick: () -> Unit) {
    val (icon, tint) = sectionIcon(id)
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(14.dp, 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(38.dp).clip(RoundedCornerShape(11.dp)).background(tint.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) { Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp)) }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.SemiBold)
            if (sub.isNotBlank()) Text(sub, color = Muted, style = MaterialTheme.typography.bodySmall)
        }
        Icon(Icons.Rounded.ChevronRight, null, tint = Muted)
    }
}
/** A page's rows in cards: each heading starts one; rows before the first heading get a card with no heading. */
private fun cardsOf(rows: List<SetRow>): List<Pair<String, List<SetRow>>> {
    val out = mutableListOf<Pair<String, MutableList<SetRow>>>()
    rows.forEach { r ->
        if (r.kind == "head") { if (r.label.isNotBlank() || out.isEmpty() || out.last().second.isNotEmpty()) out.add(r.label to mutableListOf()) }
        else { if (out.isEmpty()) out.add("" to mutableListOf()); out.last().second.add(r) }
    }
    return out.filter { it.second.isNotEmpty() }
}
/** A choice shown as a row of buttons: a few short options (the web editor does the same). */
private fun segmented(r: SetRow) = r.options.size in 2..3 && r.options.sumOf { it.length } <= 24

/* Each kind of row looks different, so you can tell at a glance what a tap does: a switch, a value in a pill
   (tap to pick), a few options as buttons, a page with a chevron, a filled button for one that does its job
   now (Reload guide now), a red one for one that deletes or resets, facts quiet on a darker band, notes with
   a bar beside them, and a row that wants you (an update ready) in green.  The note under a name is its first
   sentence; tap "more" for all of it.  [lit]: a search hit, lit up for a moment. */
@Composable
private fun SettingRow(r: SetRow, lit: Boolean, onToggle: (Boolean) -> Unit, onPick: () -> Unit, onChoose: (Int) -> Unit, onCycle: (Int) -> Unit, onOpen: () -> Unit, onAction: () -> Unit) {
    val look = r.look.ifBlank { if (r.kind == "info") (if (r.value.isBlank()) "note" else "status") else r.kind }
    if (r.kind == "info" && !r.attn) {
        if (look == "status") Row(Modifier.fillMaxWidth().background(Panel2.copy(alpha = 0.45f)).padding(16.dp, 10.dp)) {
            Text(r.label, color = Muted, modifier = Modifier.weight(1f))
            Spacer(Modifier.width(12.dp))
            Text(r.value, textAlign = TextAlign.End, modifier = Modifier.weight(1f))
        } else Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).padding(16.dp, 10.dp)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(if (r.style == "tip") Accent else Line))
            Spacer(Modifier.width(12.dp))
            Text(r.label, color = if (r.style == "tip") TextHi else Muted, style = MaterialTheme.typography.bodySmall)
        }
        return
    }
    val button = r.kind == "action" && (r.tone == "go" || r.tone == "danger") && !r.attn
    val seg = r.kind == "choice" && segmented(r)
    val click: (() -> Unit)? = when {
        button || seg -> null
        r.kind == "toggle" -> { { onToggle(!r.on) } }
        r.kind == "choice" -> onPick; r.kind == "page" -> onOpen; r.kind == "action" -> onAction; else -> null
    }
    var more by remember(r.i, r.label) { mutableStateOf(false) }
    val glow by animateColorAsState(if (lit) Accent2.copy(alpha = 0.16f) else Color.Transparent, tween(1800), label = "found")
    val bg = when { r.attn -> Good.copy(alpha = 0.14f); r.tone == "go" && button -> Accent.copy(alpha = 0.08f); else -> glow }
    Column(Modifier.fillMaxWidth().background(bg).let { if (click != null) it.clickable(onClick = click) else it }.padding(16.dp, 13.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(r.label, fontWeight = if (r.attn || button) FontWeight.SemiBold else FontWeight.Medium,
                    color = when { r.attn -> Good; r.tone == "danger" -> Color(0xFFFF9A9D); else -> TextHi })
                val note = if (more || r.brief.isBlank()) r.sub else r.brief
                if (note.isNotBlank()) Row(verticalAlignment = Alignment.Top) {
                    Text(note, color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f, fill = false), maxLines = if (more) Int.MAX_VALUE else 3, overflow = TextOverflow.Ellipsis)
                    if (r.brief.isNotBlank()) Text(if (more) "  less" else "  more", color = Accent, style = MaterialTheme.typography.bodySmall, modifier = Modifier.clickable { more = !more })
                }
                if (r.tv) Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.Tv, null, tint = Muted, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("On the TV: look at the TV's screen", color = Muted, style = MaterialTheme.typography.labelSmall)
                }
                if ((r.kind == "page" || r.kind == "action") && !r.attn && !button && r.value.isNotBlank() && r.value != "›") Text(r.value.removeSuffix("›").trim(), color = Muted, style = MaterialTheme.typography.bodyMedium)
            }
            if (r.swatch.isNotBlank()) {
                val col = runCatching { Color(android.graphics.Color.parseColor(r.swatch)) }.getOrNull()
                if (col != null) { Spacer(Modifier.width(8.dp)); Box(Modifier.size(18.dp).clip(CircleShape).background(col)) }
            }
            Spacer(Modifier.width(8.dp))
            when {
                r.attn && r.value.isNotBlank() -> Text(r.value, color = Ink, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(Good).padding(12.dp, 4.dp))
                r.kind == "toggle" -> Switch(checked = r.on, onCheckedChange = onToggle)
                r.kind == "choice" && !seg -> Row(Modifier.clip(RoundedCornerShape(10.dp)).background(Panel2).border(1.dp, Line, RoundedCornerShape(10.dp)).padding(12.dp, 7.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(r.value, color = TextHi, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 140.dp))
                    Icon(Icons.Rounded.UnfoldMore, null, tint = Muted, modifier = Modifier.size(16.dp))
                }
                r.kind == "page" || r.style == "jump" || r.go.isNotBlank() -> Icon(Icons.Rounded.ChevronRight, null, tint = Muted)
                r.kind == "action" && !button && (r.phone == "log" || r.phone in SCREENS || r.value.endsWith("›")) -> Icon(Icons.Rounded.ChevronRight, null, tint = Muted)
                r.kind == "cycle" -> {
                    IconButton(onClick = { onCycle(-1) }) { Icon(Icons.Rounded.ChevronLeft, "Previous") }
                    Text(r.value)
                    IconButton(onClick = { onCycle(1) }) { Icon(Icons.Rounded.ChevronRight, "Next") }
                }
            }
        }
        // A few options: all of them as buttons under the name, one tap.
        if (seg) Row(Modifier.padding(top = 10.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Ink).border(1.dp, Line, RoundedCornerShape(12.dp)).padding(3.dp)) {
            r.options.forEachIndexed { n, o ->
                val on = n == r.cur
                Box(Modifier.weight(1f).clip(RoundedCornerShape(9.dp)).background(if (on) Accent else Color.Transparent).clickable(enabled = !on) { onChoose(n) }.padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                    Text(o, color = if (on) OnAccent else Muted, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal, style = MaterialTheme.typography.labelLarge, maxLines = 1)
                }
            }
        }
        // Does its job now (filled) or deletes something (red outline): a real button, full width under the name.
        if (button) {
            Spacer(Modifier.height(10.dp))
            if (r.tone == "go") Button(onClick = onAction, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) {
                Icon(Icons.Rounded.Refresh, null, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text(r.label.replace(Regex("\\s+now$", RegexOption.IGNORE_CASE), ""), fontWeight = FontWeight.Bold)
            } else OutlinedButton(onClick = onAction, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, Bad.copy(alpha = 0.6f)),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFFF9A9D))) { Text(r.label, fontWeight = FontWeight.SemiBold) }
            if (r.value.isNotBlank() && r.value != "›") Text(r.value.removeSuffix("›").trim(), color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp).align(Alignment.CenterHorizontally))
        }
    }
}
