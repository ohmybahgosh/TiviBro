/* The guide on the phone, built for a small screen instead of a squeezed TV grid: pick a time (Now, or
   any hour in the next day and a half) and a group, and each channel shows what is on then and what
   comes after.  Tap a channel for its whole schedule, day by day, with descriptions: watch it on the TV,
   or set a reminder that the TV keeps (the TV's own reminders, also while TiviBro is closed). */
package app.tivibro.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.tivibro.phone.proto.Chan
import app.tivibro.phone.proto.GuideRow
import app.tivibro.phone.proto.Lineup
import app.tivibro.phone.proto.Programme
import app.tivibro.phone.proto.Schedule
import app.tivibro.phone.proto.TbException
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

private const val PAGE = 60
private fun time(t: Long): String = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(t))
private fun dayStart(t: Long): Long = Calendar.getInstance().apply { timeInMillis = t; set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis
private fun dayName(t: Long, now: Long): String {
    val d = ((dayStart(t) - dayStart(now)) / 86_400_000L).toInt()
    return when (d) { 0 -> "Today"; 1 -> "Tomorrow"; -1 -> "Yesterday"; else -> SimpleDateFormat("EEE d MMM", Locale.getDefault()).format(Date(t)) }
}

/** The times to pick from: Now, then every hour for a day and a half. */
private fun times(now: Long): List<Pair<Long?, String>> {
    val c = Calendar.getInstance().apply { timeInMillis = now; set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0); add(Calendar.HOUR_OF_DAY, 1) }
    val out = mutableListOf<Pair<Long?, String>>(null to "Now")
    for (i in 0 until 36) {
        val t = c.timeInMillis
        val h = c.get(Calendar.HOUR_OF_DAY)
        out += t to (if (h == 0 || i == 0 && dayStart(t) != dayStart(now)) dayName(t, now) + " " else "") + time(t)
        c.add(Calendar.HOUR_OF_DAY, 1)
    }
    return out
}

@Composable
fun GuideTab(model: AppModel, id: String, lineup: Lineup?, lineupNote: String, playing: String, now: Long, onPlay: (Chan) -> Unit, onOpen: () -> Unit, onRetry: () -> Unit) {
    if (lineup == null) { LineupWaiting(lineupNote, onOpen, onRetry); return }
    var at by rememberSaveable { mutableStateOf<Long?>(null) }
    var group by rememberSaveable { mutableStateOf("") }
    // Guide rows by channel key, for the time and group picked; pages asked for as the list scrolls.
    val rows = remember(at, group) { mutableStateMapOf<String, GuideRow>() }
    val asked = remember(at, group) { mutableStateMapOf<Int, Boolean>() }
    var error by remember(at, group) { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf<Chan?>(null) }
    val scope = rememberCoroutineScope()
    val list = remember(lineup, group) { if (group.isBlank()) lineup.all else lineup.groups.firstOrNull { it.id == group }?.keys?.mapNotNull { lineup.byKey[it] } ?: lineup.all }
    val state = rememberLazyListState()
    val choices = remember(now / 3_600_000L) { times(now) }

    fun load(page: Int) {
        if (asked[page] == true) return
        asked[page] = true
        scope.launch {
            try {
                val p = model.guide(id, group, at, page * PAGE, PAGE)
                p.rows.forEach { rows[it.key] = it }
            } catch (e: TbException) { error = e.message; asked.remove(page) }
            catch (e: Exception) { error = "The TV didn't answer.  Is it on, and on the same network?"; asked.remove(page) }
        }
    }
    LaunchedEffect(at, group) { state.scrollToItem(0); load(0) }

    Column(Modifier.fillMaxSize()) {
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 10.dp)) {
            items(choices, key = { it.first ?: 0L }) { (t, label) -> GroupChip(label, at == t) { at = t } }
        }
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 6.dp)) {
            item { GroupChip("All", group.isBlank()) { group = "" } }
            items(lineup.groups, key = { it.id }) { g -> GroupChip(g.name, group == g.id) { group = g.id } }
        }
        error?.let { Text(it, color = Bad, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(16.dp, 4.dp)) }
        LazyColumn(state = state, contentPadding = PaddingValues(bottom = 24.dp), modifier = Modifier.fillMaxSize()) {
            itemsIndexed(list, key = { _, c -> c.k }) { i, c ->
                LaunchedEffect(i / PAGE) { load(i / PAGE) }
                GuideChannelRow(c, rows[c.k], c.k == playing, at ?: now, now) { open = c }
                HorizontalDivider(color = Line.copy(alpha = 0.5f), thickness = 0.5.dp, modifier = Modifier.padding(start = 74.dp))
            }
        }
    }
    open?.let { c -> ScheduleSheet(model, id, c, at, c.k == playing, onPlay = { onPlay(c); open = null }, onDismiss = { open = null }) }
}

@Composable
fun LineupWaiting(note: String, onOpen: () -> Unit, onRetry: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        when (note) {
            "closed" -> { Text("TiviBro is closed on the TV.", textAlign = TextAlign.Center); Spacer(Modifier.height(16.dp)); Button(onClick = onOpen) { Text("Open TiviBro") } }
            "none" -> { Text("The TV didn't send its channel list.", textAlign = TextAlign.Center); Spacer(Modifier.height(16.dp)); Button(onClick = onRetry) { Text("Try again") } }
            else -> { CircularProgressIndicator(); Spacer(Modifier.height(16.dp)); Text("Getting the channel list from the TV…", color = Muted) }
        }
    }
}

@Composable
private fun GuideChannelRow(c: Chan, row: GuideRow?, playing: Boolean, at: Long, now: Long, onClick: () -> Unit) {
    val progs = row?.progs
    val first = progs?.firstOrNull { it.end > at }
    val after = progs?.filter { it.start >= (first?.end ?: Long.MAX_VALUE) }?.take(2).orEmpty()
    Row(
        Modifier.fillMaxWidth().clickable(onClickLabel = "Schedule", onClick = onClick).background(if (playing) Panel else Color.Transparent).padding(16.dp, 12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Logo(c.logo, c.number, 44.dp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text((if (c.number.isNotBlank()) c.number + "  " else "") + c.name, color = if (playing) Accent2 else Muted, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            when {
                row == null || progs == null -> Text("…", color = Muted)
                first == null -> Text("No guide information", color = Muted, style = MaterialTheme.typography.bodyMedium)
                else -> {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(first.title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        if (first.reminder) { Spacer(Modifier.width(6.dp)); Icon(Icons.Rounded.NotificationsActive, "Reminder set", tint = Accent2, modifier = Modifier.size(14.dp)) }
                    }
                    Text(time(first.start) + " – " + time(first.end), color = Muted, style = MaterialTheme.typography.labelSmall)
                    if (first.on(now)) {
                        Spacer(Modifier.height(4.dp))
                        LinearProgressIndicator(progress = { ((now - first.start).toFloat() / (first.end - first.start)).coerceIn(0f, 1f) }, color = Accent, trackColor = Panel2, modifier = Modifier.fillMaxWidth(0.7f).height(3.dp))
                    }
                    after.forEach { p ->
                        Text(time(p.start) + "   " + p.title, color = Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 3.dp))
                    }
                }
            }
        }
    }
}

/** One channel's schedule, day by day: watch now, or set reminders for later. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ScheduleSheet(model: AppModel, id: String, c: Chan, at: Long?, playing: Boolean, onPlay: () -> Unit, onDismiss: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var sch by remember { mutableStateOf<Schedule?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val reminders = remember { mutableStateMapOf<Long, Boolean>() }
    var expanded by remember { mutableStateOf<Long?>(null) }
    val scope = rememberCoroutineScope()
    val now = System.currentTimeMillis()
    LaunchedEffect(c.k) {
        try { sch = model.schedule(id, c.k) } catch (e: TbException) { error = e.message } catch (e: Exception) { error = "The TV didn't answer." }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Ink) {
        Column(Modifier.fillMaxHeight(0.92f)) {
            Row(Modifier.padding(16.dp, 0.dp, 16.dp, 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Logo(c.logo, c.number, 48.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(c.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if ((sch?.catchupDays ?: 0) > 0) Text("Catch-up ${sch!!.catchupDays} days", color = Muted, style = MaterialTheme.typography.labelSmall)
                }
                Button(onClick = onPlay, enabled = !playing) { Icon(Icons.Rounded.PlayArrow, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(if (playing) "On the TV" else "Watch on TV") }
            }
            val s = sch
            when {
                error != null -> Text(error!!, color = Bad, modifier = Modifier.padding(16.dp))
                s == null -> Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                s.progs.isEmpty() -> Text("No guide information for this channel.", color = Muted, modifier = Modifier.padding(16.dp))
                else -> {
                    val days = remember(s) { s.progs.map { dayStart(it.start) }.distinct() }
                    var day by remember(s) { mutableStateOf(dayStart(at ?: now).takeIf { it in days } ?: days.first()) }
                    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 8.dp)) {
                        items(days) { d -> GroupChip(dayName(d, now), day == d) { day = d } }
                    }
                    val list = remember(s, day) { s.progs.filter { dayStart(it.start) == day } }
                    val listState = rememberLazyListState()
                    LaunchedEffect(list) {
                        val target = at ?: now
                        val i = list.indexOfFirst { it.end > target }
                        if (i > 0) listState.scrollToItem(i - 1)
                    }
                    LazyColumn(state = listState, contentPadding = PaddingValues(bottom = 32.dp)) {
                        items(list, key = { it.start }) { p ->
                            val set = reminders[p.start] ?: p.reminder
                            ProgrammeRow(p, now, set, expanded == p.start, onClick = { expanded = if (expanded == p.start) null else p.start },
                                onWatch = if (p.on(now)) onPlay else null,
                                onRemind = if (p.start > now) ({
                                    scope.launch {
                                        try { reminders[p.start] = model.remind(id, c.k, p.start, !set); model.say(if (!set) "Reminder set on the TV for ${time(p.start)}" else "Reminder removed") }
                                        catch (e: Exception) { model.say(e.message ?: "The TV didn't answer.") }
                                    }
                                    Unit
                                }) else null)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProgrammeRow(p: Programme, now: Long, reminder: Boolean, open: Boolean, onClick: () -> Unit, onWatch: (() -> Unit)?, onRemind: (() -> Unit)?) {
    val on = p.on(now)
    val past = p.end <= now
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).background(if (on) Panel else Color.Transparent).padding(16.dp, 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(time(p.start), color = if (on) Accent2 else Muted, style = MaterialTheme.typography.labelMedium, modifier = Modifier.width(72.dp))
            Column(Modifier.weight(1f)) {
                Text(p.title, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal, color = if (past) Muted else TextHi, maxLines = if (open) 3 else 1, overflow = TextOverflow.Ellipsis)
                if (on) {
                    Spacer(Modifier.height(4.dp))
                    LinearProgressIndicator(progress = { ((now - p.start).toFloat() / (p.end - p.start)).coerceIn(0f, 1f) }, color = Accent, trackColor = Panel2, modifier = Modifier.fillMaxWidth().height(3.dp))
                }
            }
            when {
                onWatch != null -> IconButton(onClick = onWatch) { Icon(Icons.Rounded.PlayArrow, "Watch on TV", tint = Accent2) }
                onRemind != null -> IconButton(onClick = onRemind) {
                    Icon(if (reminder) Icons.Rounded.NotificationsActive else Icons.Rounded.Notifications, if (reminder) "Remove the reminder" else "Remind me", tint = if (reminder) Accent2 else Muted)
                }
            }
        }
        if (open) {
            Text(time(p.start) + " – " + time(p.end), color = Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(start = 72.dp, top = 4.dp))
            Text(p.desc.ifBlank { "No description." }, color = if (p.desc.isBlank()) Muted else TextHi, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 72.dp, top = 4.dp))
        }
    }
}
