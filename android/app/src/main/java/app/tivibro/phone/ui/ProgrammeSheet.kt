/* One programme in full, from the guide or a channel's schedule (ask "prog", app/js/phone.js): TMDB's picture
   across the top for a movie or show (the episode's own still when it has one), the title and the episode's
   title, playing now or when it starts in the TV's words, its facts and the whole description.  The buttons
   fit the moment: Watch on TV, Watch from the start (catch-up), a reminder, other showings, and the channel's
   whole schedule.  The kind, NEW and season and episode marks are the TV guide's (KindTags), also in the
   guide's rows. */
package app.tivibro.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.FiberManualRecord
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Replay
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.tivibro.phone.proto.ProgDetail
import app.tivibro.phone.proto.Programme
import app.tivibro.phone.proto.TbException
import coil.compose.AsyncImage
import kotlinx.coroutines.launch

private fun clock(t: Long): String = java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date(t))
private fun minsOf(ms: Long): String { val m = maxOf(1L, ms / 60_000); return if (m >= 60) "${m / 60} h" + (if (m % 60 > 0) " ${m % 60} min" else "") else "$m min" }
private fun dayOf(t: Long, now: Long): String {
    val d = java.util.Calendar.getInstance().apply { timeInMillis = t }; val n = java.util.Calendar.getInstance().apply { timeInMillis = now }
    if (d.get(java.util.Calendar.YEAR) == n.get(java.util.Calendar.YEAR) && d.get(java.util.Calendar.DAY_OF_YEAR) == n.get(java.util.Calendar.DAY_OF_YEAR)) return ""
    n.add(java.util.Calendar.DAY_OF_YEAR, 1)
    if (d.get(java.util.Calendar.YEAR) == n.get(java.util.Calendar.YEAR) && d.get(java.util.Calendar.DAY_OF_YEAR) == n.get(java.util.Calendar.DAY_OF_YEAR)) return "Tomorrow "
    return java.text.SimpleDateFormat("EEE d MMM ", java.util.Locale.getDefault()).format(java.util.Date(t))
}

// The TV guide's colours for each kind (its default theme).
private val KINDS = mapOf("m" to ("Movie" to Color(0xFFB48CFF)), "s" to ("Sports" to Color(0xFF3DDC97)), "n" to ("News" to Color(0xFFF2B33D)),
    "c" to ("Kids" to Color(0xFFFF7EB6)), "d" to ("Documentary" to Color(0xFF33C9E1)))

/** The guide's marks for a programme: its kind in its colour, NEW, and the season and episode.  Nothing when there are none. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun KindTags(p: Programme, modifier: Modifier = Modifier) {
    val kind = KINDS[if (p.kind.isBlank() && p.movie != null && !p.movie.series) "m" else p.kind]
    if (kind == null && !p.isNew && p.ep.isBlank()) return
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        kind?.let { (name, c) -> Mark(name, c) }
        if (p.isNew) Mark("NEW", Color(0xFFFFC56B))
        if (p.ep.isNotBlank()) Mark(p.ep, Muted)
    }
}

@Composable
private fun Mark(text: String, color: Color) {
    Text(text, color = color, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(5.dp)).background(Panel2).padding(horizontal = 6.dp, vertical = 1.dp))
}

/** Playing now with how long is left, or when it starts: the same words as the TV's Movies on now. */
@Composable
fun WhenLine(p: Programme, now: Long) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        when {
            p.on(now) -> {
                StatusTag(true, "Playing now")
                Spacer(Modifier.width(8.dp))
                Text(clock(p.start) + " – " + clock(p.end) + "  ·  " + minsOf(p.end - now) + " left", color = Muted, style = MaterialTheme.typography.labelMedium)
            }
            p.start > now -> {
                StatusTag(false, "Starts at " + dayOf(p.start, now) + clock(p.start))
                Spacer(Modifier.width(8.dp))
                Text(if (p.start - now < 86_400_000) "in " + minsOf(p.start - now) else clock(p.start) + " – " + clock(p.end), color = Muted, style = MaterialTheme.typography.labelMedium)
            }
            else -> Text("Aired " + dayOf(p.start, now) + clock(p.start) + " – " + clock(p.end), color = Muted, style = MaterialTheme.typography.labelMedium)
        }
    }
}

/** One programme in full.  [onSchedule]: the channel's whole schedule (left out when it was opened from there). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProgrammeSheet(model: AppModel, id: String, key: String, start: Long, first: Programme?, playing: String, onPlay: (String) -> Unit, onSchedule: (() -> Unit)?, onDismiss: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var d by remember { mutableStateOf<ProgDetail?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reminder by remember { mutableStateOf<Boolean?>(null) }
    // Recording it on the TV's USB drive: null until changed here, then "rec", "sched" or "" and the recording's id.
    var rec by remember { mutableStateOf<Pair<String, String>?>(null) }
    var recBusy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val now = System.currentTimeMillis()
    LaunchedEffect(key, start) {
        try { d = model.prog(id, key, start) } catch (e: TbException) { error = e.message } catch (e: Exception) { error = "The TV didn't answer." }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Panel) {
        Column(Modifier.fillMaxHeight(0.92f).verticalScroll(rememberScrollState()).padding(bottom = 32.dp)) {
            val x = d
            val p = x?.prog ?: first
            if (p == null) {
                if (error != null) Text(error!!, color = Bad, modifier = Modifier.padding(16.dp))
                else Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                return@Column
            }
            val tm = x?.tmdb
            // The picture: the episode's still, else the movie's or show's backdrop, faded into the sheet.
            val pic = tm?.epStill?.ifBlank { null } ?: tm?.backdrop?.ifBlank { null }
            if (pic != null) Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f)) {
                AsyncImage(model = pic, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Panel), startY = 200f)))
            }
            Row(Modifier.padding(16.dp, if (pic != null) 0.dp else 4.dp, 16.dp, 0.dp), verticalAlignment = Alignment.Top) {
                tm?.poster?.takeIf { it.isNotBlank() }?.let { url ->
                    AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.width(76.dp).height(114.dp).clip(RoundedCornerShape(8.dp)))
                    Spacer(Modifier.width(14.dp))
                }
                Column(Modifier.weight(1f)) {
                    Text(p.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    if (!tm?.epTitle.isNullOrBlank()) Text((if (p.ep.isNotBlank()) p.ep + "  ·  " else "") + tm!!.epTitle, color = TextHi, style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(6.dp))
                    KindTags(p)
                    Text(x?.channel ?: "", color = Accent, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 6.dp))
                }
            }
            Column(Modifier.padding(16.dp, 12.dp, 16.dp, 0.dp)) {
                WhenLine(p, now)
                if (p.on(now)) LinearProgressIndicator(progress = { ((now - p.start).toFloat() / (p.end - p.start)).coerceIn(0f, 1f) }, color = Accent, trackColor = Panel2,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp).height(4.dp))
                val facts = listOfNotNull(tm?.facts, if ((x?.catchupDays ?: 0) > 0) "Catch-up ${x!!.catchupDays} days" else null).filter { it.isNotBlank() }.joinToString("  ·  ")
                if (facts.isNotBlank()) Text(facts, color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 10.dp))
                // The guide's description; TMDB's summary of the episode, or of the movie or show, when it adds something.
                val desc = p.desc
                when {
                    desc.isNotBlank() -> Text(desc, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 10.dp))
                    x == null && error != null -> Text(if (error!!.contains("unknown question", true)) "Update TiviBro on the TV to see everything about a programme here." else error!!,
                        color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 10.dp))
                    x == null || x.descPending -> Text("Getting the description from the TV…", color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 10.dp))
                    tm == null -> Text("No description in the guide.", color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 10.dp))
                }
                val more = tm?.epPlot?.ifBlank { null } ?: tm?.plot?.ifBlank { null }
                if (more != null && !desc.contains(more.take(40))) {
                    Text(if (tm?.epPlot.isNullOrBlank()) "From TMDB" else "This episode, from TMDB", color = Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 12.dp))
                    Text(more, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 2.dp))
                }
            }
            if (x != null) {
                // What can be done with it now.
                val set = reminder ?: p.reminder
                FlowRow2(Modifier.padding(16.dp, 16.dp, 16.dp, 0.dp)) {
                    if (p.on(now)) Button(onClick = { onPlay(x.key); onDismiss() }, enabled = playing != x.key) {
                        Icon(Icons.Rounded.PlayArrow, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(if (playing == x.key) "On the TV" else "Watch on TV")
                    }
                    if (x.fromStart) OutlinedButton(onClick = {
                        scope.launch { try { model.catchup(id, x.key, p.start); model.say("Playing from the start on the TV"); onDismiss() } catch (e: Exception) { model.say(e.message ?: "The TV didn't answer.") } }
                    }) { Icon(Icons.Rounded.Replay, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Watch from the start") }
                    if (p.start > now) OutlinedButton(onClick = {
                        scope.launch {
                            try { reminder = model.remind(id, x.key, p.start, !set); model.say(if (!set) "Reminder set on the TV for ${clock(p.start)}" else "Reminder removed") }
                            catch (e: Exception) { model.say(e.message ?: "The TV didn't answer.") }
                        }
                    }) { Icon(if (set) Icons.Rounded.NotificationsActive else Icons.Rounded.Notifications, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(if (set) "Cancel the reminder" else "Remind me") }
                    // Record to the TV's USB drive (an older TiviBro says nothing about it, and the TV explains when there is no drive).
                    if (p.end > now) {
                        val (rs, rid) = rec ?: (p.rec to x.recId)
                        OutlinedButton(enabled = !recBusy, onClick = {
                            recBusy = true
                            scope.launch {
                                try {
                                    val l = if (rs.isBlank()) model.recordings(id, "add", k = x.key, start = p.start) else model.recordings(id, "stop", recId = rid)
                                    val mine = l.items.firstOrNull { (it.recording || it.scheduled) && it.key == x.key && it.end >= p.end && it.start <= p.start + 600_000 }
                                    rec = if (mine == null) "" to "" else (if (mine.recording) "rec" else "sched") to mine.id
                                    if (l.msg.isNotBlank()) model.say(l.msg)
                                } catch (e: TbException) {
                                    model.say(if ((e.message ?: "").contains("unknown question", true)) "Update TiviBro on the TV to record from here." else e.message ?: "The TV said no")
                                } catch (e: Exception) { model.say("The TV didn't answer.") }
                                recBusy = false
                            }
                        }) {
                            Icon(Icons.Rounded.FiberManualRecord, null, Modifier.size(18.dp), tint = if (rs.isBlank()) Accent else Bad); Spacer(Modifier.width(6.dp))
                            Text(when (rs) { "rec" -> "Stop recording"; "sched" -> "Cancel recording"; else -> "Record" })
                        }
                    }
                    if (onSchedule != null) TextButton(onClick = { onDismiss(); onSchedule() }) { Text("Channel schedule") }
                }
                if (x.more.isNotEmpty()) {
                    Text("Other showings", color = Muted, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(16.dp, 18.dp, 16.dp, 4.dp))
                    x.more.forEach { o ->
                        val on = o.start <= now && o.end > now
                        Row(Modifier.fillMaxWidth().clickable { if (on) { onPlay(o.key); onDismiss() } else scope.launch {
                            try { model.remind(id, o.key, o.start, true); model.say("Reminder set on the TV for ${clock(o.start)} on ${o.channel}") } catch (e: Exception) { model.say(e.message ?: "The TV didn't answer.") }
                        } }.padding(16.dp, 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(o.channel, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(if (on) "Playing now  ·  " + minsOf(o.end - now) + " left" else dayOf(o.start, now) + clock(o.start) + " – " + clock(o.end), color = Muted, style = MaterialTheme.typography.labelSmall)
                            }
                            Icon(if (on) Icons.Rounded.PlayArrow else Icons.Rounded.Notifications, if (on) "Watch on TV" else "Remind me", tint = if (on) Accent else Muted)
                        }
                    }
                }
            }
        }
    }
}

// Buttons that wrap onto a second line on a narrow phone, rather than being cut off.
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FlowRow2(modifier: Modifier, content: @Composable () -> Unit) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
}
