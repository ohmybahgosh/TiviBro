/* Movies on now, on the phone: the TV's Movies on now (onnow.js, TMDB with the TV's own token) as big
   posters in shelves: Playing now, Starting soon, then the same movies by genre (the TV picks the genres).
   A tap opens the movie: its backdrop with the title logo, the facts and plot, and every channel
   showing it.  Watch on TV for one that's on; for one that starts later, a reminder on the TV (asked
   first) or the channel now. */
package app.tivibro.phone.ui

import app.tivibro.phone.tr

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import app.tivibro.phone.proto.OnNow
import app.tivibro.phone.proto.OnNowChan
import app.tivibro.phone.proto.OnNowMovie
import app.tivibro.phone.proto.TbException
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private fun time(t: Long): String = java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date(t))
private fun mins(ms: Long): String { val m = maxOf(1L, ms / 60_000); return if (m >= 60) tr("{n} h", "n" to m / 60) + (if (m % 60 > 0) " " + tr("{n} min", "n" to m % 60) else "") else tr("{n} min", "n" to m) }
/** When a movie starting later starts, as the TV says it: "in 35 min" within the hour, else the clock time. */
private fun whenStarts(start: Long, now: Long): String = if (start - now < 3_600_000) tr("in {x}", "x" to mins(start - now)) else time(start)
private fun count(n: Int, one: String, many: String) = if (n == 1) one else many.replace("{n}", n.toString())

@Composable
fun OnNowTab(model: AppModel, id: String, playing: String, now: Long) {
    var data by remember { mutableStateOf<OnNow?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var open by remember { mutableStateOf<OnNowMovie?>(null) }

    // Again every minute (what's left, new finds), and sooner while the TV is still looking.
    LaunchedEffect(attempt) {
        while (true) {
            try { data = model.onNow(id); error = null }
            catch (e: TbException) { error = e.message }
            catch (e: Exception) { if (data == null) error = tr("The TV didn't answer.  Is it on, and on the same network?") }
            delay(if (data?.looking == true) 15_000 else 60_000)
        }
    }
    val d = data
    when {
        d == null && error != null -> Column(Modifier.fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(error ?: ""); Spacer(Modifier.size(12.dp)); Button(onClick = { attempt++ }) { Text(tr("Try again")) }
        }
        d == null -> Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        d.off -> Text(d.msg, color = Muted, modifier = Modifier.padding(24.dp))
        d.on.isEmpty() && d.soon.isEmpty() -> Text(if (d.looking) tr("The TV is looking through its guide for movies…") else tr("No movies on right now.  New ones show up here as the TV finds them."),
            color = Muted, modifier = Modifier.padding(24.dp))
        else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            if (d.on.isNotEmpty()) item { Shelf(tr("Playing now"), count(d.on.size, tr("1 movie, join in progress"), tr("{n} movies, join in progress")), d.on, now) { open = it } }
            if (d.soon.isNotEmpty()) item { Shelf(tr("Starting soon"), count(d.soon.size, tr("1 movie in the next 3 hours"), tr("{n} movies in the next 3 hours")), d.soon, now) { open = it } }
            items(d.genreShelves(), key = { "g:" + it.first }) { (title, list) ->
                val on = list.count { it.live }
                val sub = listOfNotNull(if (on > 0) count(on, tr("1 playing now"), tr("{n} playing now")) else null,
                    if (list.size > on) count(list.size - on, tr("1 starting soon"), tr("{n} starting soon")) else null).joinToString(",  ")
                Shelf(title, sub, list, now) { open = it }
            }
        }
    }
    open?.let { m -> MovieSheet(model, id, m, now, playing, onDone = { open = null; attempt++ }) }
}

@Composable
private fun Shelf(title: String, sub: String, list: List<OnNowMovie>, now: Long, onOpen: (OnNowMovie) -> Unit) {
    Column(Modifier.padding(16.dp, 14.dp, 16.dp, 8.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        if (sub.isNotBlank()) Text(sub, color = Muted, style = MaterialTheme.typography.labelMedium)
    }
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items(list, key = { it.id + it.live }) { m -> PosterCard(m, now) { onOpen(m) } }
    }
}

@Composable
private fun PosterCard(m: OnNowMovie, now: Long, onClick: () -> Unit) {
    val c = m.first
    Column(Modifier.width(150.dp).clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp)).background(Panel2)) {
            Text(m.title, fontWeight = FontWeight.Bold, modifier = Modifier.align(Alignment.BottomStart).padding(10.dp))
            if (m.poster.isNotBlank()) AsyncImage(model = m.poster, contentDescription = m.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            if (m.live) LinearProgressIndicator(progress = { ((now - c.start).toFloat() / (c.end - c.start)).coerceIn(0f, 1f) }, color = Accent, trackColor = Color(0x99000000),
                modifier = Modifier.fillMaxWidth().height(4.dp).align(Alignment.BottomCenter))
            // Starting later: a quieter poster, so the ones playing now stand out.
            if (!m.live) Box(Modifier.fillMaxSize().background(Color(0x66000000)))
            StatusTag(m.live, if (m.live) "LIVE" else whenStarts(c.start, now).uppercase(), Modifier.align(Alignment.TopStart).padding(8.dp))
        }
        Spacer(Modifier.height(6.dp))
        Text(c.name + (if (m.chans.size > 1) "  +${m.chans.size - 1}" else ""), style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(if (m.live) tr("{x} left", "x" to mins(c.end - now)) else tr("Starts {x}", "x" to time(c.start)),
            color = if (m.live) TextHi else Muted, style = MaterialTheme.typography.labelSmall)
    }
}

/** The TV's badges: LIVE outlined in the accent with a dot, or how soon a later one starts. */
@Composable
fun StatusTag(live: Boolean, text: String, modifier: Modifier = Modifier) {
    Row(modifier.clip(RoundedCornerShape(6.dp)).background(Color(0xB8000000))
        .then(if (live) Modifier.border(1.5.dp, Accent, RoundedCornerShape(6.dp)) else Modifier).padding(horizontal = 7.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically) {
        if (live) { Box(Modifier.size(6.dp).clip(RoundedCornerShape(3.dp)).background(Accent)); Spacer(Modifier.width(5.dp)) }
        Text(text, color = if (live) Accent else TextHi, fontSize = 11.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MovieSheet(model: AppModel, id: String, m: OnNowMovie, now: Long, playing: String, onDone: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var ask by remember { mutableStateOf<OnNowChan?>(null) }
    var reminded by remember { mutableStateOf(m.chans.filter { it.reminder }.map { it.key }.toSet()) }
    ModalBottomSheet(onDismissRequest = onDone, sheetState = sheet, containerColor = Panel) {
        Column(Modifier.padding(bottom = 24.dp).verticalScroll(rememberScrollState())) {
            // The backdrop, with the title logo (or the title) over its lower edge.
            Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f)) {
                if (m.backdrop.isNotBlank()) AsyncImage(model = m.backdrop, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Ink), startY = 120f)))
                Box(Modifier.align(Alignment.BottomStart).padding(16.dp)) {
                    if (m.logo.isNotBlank()) AsyncImage(model = m.logo, contentDescription = m.title, contentScale = ContentScale.Fit, alignment = Alignment.BottomStart,
                        modifier = Modifier.widthIn(max = 260.dp).heightIn(max = 90.dp))
                    else Text(m.title, fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 32.sp)
                }
            }
            if (m.logo.isNotBlank()) Text(m.title, color = Muted, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(16.dp, 0.dp))
            Text(m.facts, color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(16.dp, 4.dp))
            if (m.plot.isNotBlank()) Text(m.plot, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(16.dp, 8.dp))
            Text(if (m.live) tr("Playing now") else tr("Starting soon"), color = Muted, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(16.dp, 12.dp, 16.dp, 4.dp))
            m.chans.forEach { c ->
                val set = c.key in reminded
                Row(Modifier.fillMaxWidth().clickable { if (m.live) { model.playOnTv(id, c.key, c.name); onDone() } else ask = c }.padding(16.dp, 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Logo(c.logo, "", 40.dp)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(c.name, color = if (c.key == playing) Accent else TextHi, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(time(c.start) + " – " + time(c.end) + "   ·   " + (if (m.live) tr("{x} left", "x" to mins(c.end - now)) else tr("in {x}", "x" to mins(c.start - now))), color = Muted, style = MaterialTheme.typography.labelSmall)
                    }
                    Icon(if (m.live) Icons.Rounded.PlayArrow else if (set) Icons.Rounded.NotificationsActive else Icons.Rounded.Notifications,
                        if (m.live) tr("Watch on TV") else if (set) tr("Reminder set") else tr("Remind me"), tint = if (m.live || set) Accent else Muted)
                }
            }
        }
    }
    // A movie starting later: ask first, so a stray tap sets nothing.
    ask?.let { c ->
        val set = c.key in reminded
        AlertDialog(
            onDismissRequest = { ask = null }, containerColor = Panel,
            title = { Text(m.title) },
            text = { Text(if (set) tr("A reminder is set on {x}.", "x" to c.name) else tr("Starts at {x} on {y}.", "x" to time(c.start), "y" to c.name)) },
            confirmButton = {
                TextButton(onClick = {
                    ask = null
                    scope.launch {
                        try { val on = model.remind(id, c.key, c.start, !set); reminded = if (on) reminded + c.key else reminded - c.key }
                        catch (e: TbException) { model.say(e.message ?: tr("The TV said no")) }
                        catch (e: Exception) { model.say(tr("The TV didn't answer.  Is it on, and on the same network?")) }
                    }
                }) { Text(if (set) tr("Cancel the reminder") else tr("Remind me")) }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = { ask = null; model.playOnTv(id, c.key, c.name); onDone() }) { Text(tr("Watch the channel now")) }
                    TextButton(onClick = { ask = null }) { Text(tr("Cancel")) }
                }
            },
        )
    }
}
