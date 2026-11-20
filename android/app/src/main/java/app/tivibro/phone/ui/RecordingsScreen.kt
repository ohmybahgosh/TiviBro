/* The recordings on the TV's USB drive (ask "recordings", app/js/phone.js): the drive and its room at the top,
   then Recording now, Scheduled, Recorded and Didn't record, as on the TV's Recordings screen.  Tap one: watch it on
   the TV (where it was left, or from the start), stop or cancel it, or delete it.  New ones are set from the Guide
   (a programme's Record button) or a channel's Record now. */
package app.tivibro.phone.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.FiberManualRecord
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Replay
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.Usb
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.tivibro.phone.proto.RecDrive
import app.tivibro.phone.proto.RecList
import app.tivibro.phone.proto.Recording
import app.tivibro.phone.proto.TbException
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

private fun dayStart(t: Long): Long = Calendar.getInstance().apply { timeInMillis = t; set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis
private fun clockOf(t: Long): String = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(t))

/** "Today 9:00 PM", "Tomorrow 8:00 PM", "Yesterday …" or "Sat 8 Nov 9:00 PM". */
internal fun recWhen(t: Long): String {
    val d = ((dayStart(t) - dayStart(System.currentTimeMillis())) / 86_400_000L).toInt()
    val day = when (d) { 0 -> "Today"; 1 -> "Tomorrow"; -1 -> "Yesterday"; else -> SimpleDateFormat("EEE d MMM", Locale.getDefault()).format(Date(t)) }
    return day + " " + clockOf(t)
}

/** 1.2 GB, 340 MB. */
internal fun recSize(b: Long): String = if (b >= 1_073_741_824L) String.format(Locale.US, "%.1f GB", b / 1_073_741_824.0) else "${maxOf(1L, b / 1_048_576L)} MB"

/** 1 h 05 min, 42 min. */
internal fun recLength(sec: Int): String { val m = maxOf(1, sec / 60); return if (m >= 60) "${m / 60} h " + String.format(Locale.US, "%02d", m % 60) + " min" else "$m min" }

/** The four groups, in the TV's order. */
internal fun recGroups(l: List<Recording>): List<Pair<String, List<Recording>>> = listOf(
    "Recording now" to l.filter { it.recording }.sortedByDescending { it.at },
    "Scheduled" to l.filter { it.scheduled }.sortedBy { it.start },
    "Recorded" to l.filter { it.done }.sortedByDescending { it.at },
    "Didn't record" to l.filter { !it.recording && !it.scheduled && !it.done }.sortedByDescending { it.at },
).filter { it.second.isNotEmpty() }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecordingsScreen(model: AppModel, id: String, name: String, snack: SnackbarHostState, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var got by remember { mutableStateOf<RecList?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    var picked by remember { mutableStateOf<Recording?>(null) }
    var deleting by remember { mutableStateOf<Recording?>(null) }

    fun run(op: String, r: Recording? = null, fromStart: Boolean = false, quiet: Boolean = false) {
        if (!quiet) { busy = true; error = null }
        scope.launch {
            try {
                val l = model.recordings(id, op, r?.id.orEmpty(), fromStart = fromStart)
                got = l
                if (op != "list" && l.msg.isNotBlank()) model.say(l.msg)
            } catch (e: TbException) {
                val m = e.message ?: "The TV said no"
                if (!quiet) error = if (m.contains("unknown question", true)) "Update TiviBro on the TV to see its recordings here." else m
            } catch (e: Exception) { if (!quiet) error = "$name didn't answer.  Is it on, and on the same network?" }
            if (!quiet) busy = false
        }
    }
    LaunchedEffect(attempt) { run("list") }
    // While something records, its size and length grow: look again now and then.
    val live = got?.items?.any { it.recording } == true
    LaunchedEffect(live) { while (live) { delay(15_000); run("list", quiet = true) } }
    // While one converts, how far it is: every few seconds.
    val converting = got?.items?.any { it.converting } == true
    LaunchedEffect(converting) { while (converting) { delay(3_000); run("list", quiet = true) } }

    Scaffold(
        containerColor = Ink, snackbarHost = { SnackbarHost(snack) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Recordings", maxLines = 1)
                        Text(name, color = Muted, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") } },
                actions = {
                    if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Accent)
                    IconButton(onClick = { attempt++ }, enabled = !busy) { Icon(Icons.Rounded.Refresh, "Look again") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Ink),
            )
        },
    ) { pad ->
        val g = got
        when {
            g == null && error != null -> Column(Modifier.padding(pad).fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text(error ?: "", textAlign = TextAlign.Center)
                Spacer(Modifier.height(16.dp))
                Button(onClick = { attempt++ }) { Text("Try again") }
            }
            g == null -> Box(Modifier.padding(pad).fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            else -> LazyColumn(Modifier.padding(pad).fillMaxSize(), contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                error?.let { e -> item { Text(e, color = Bad, style = MaterialTheme.typography.bodySmall) } }
                item { DriveLine(g.drive) }
                if (g.items.isEmpty()) item {
                    Column(Modifier.fillMaxWidth().padding(top = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Nothing recorded yet", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(8.dp))
                        Text(if (g.drive == null) "Plug a USB drive into the TV to record to." else "Record from the Guide: tap a programme, then Record.  Or tap a channel, then Record now.",
                            color = Muted, textAlign = TextAlign.Center)
                    }
                }
                recGroups(g.items).forEach { (title, list) ->
                    item(key = "h:$title") { Text(title, color = Muted, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 6.dp)) }
                    items(list, key = { it.id }) { r -> RecRow(r, enabled = !busy) { picked = r } }
                }
            }
        }
    }

    picked?.let { r ->
        AlertDialog(
            onDismissRequest = { picked = null }, containerColor = Panel,
            title = { Text(r.title.ifBlank { "Recording" }, maxLines = 2, overflow = TextOverflow.Ellipsis) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(listOf(r.channel, recWhen(r.at)).filter { it.isNotBlank() }.joinToString("  ·  "), color = Muted, style = MaterialTheme.typography.bodySmall)
                    if (r.desc.isNotBlank()) Text(r.desc, style = MaterialTheme.typography.bodySmall, maxLines = 6, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.height(8.dp))
                    if (r.bytes > 0) {
                        val resume = r.pos > 30 && !r.watched && !r.recording
                        ActionRow(Icons.Rounded.PlayArrow, if (resume) "Resume on TV" else if (r.recording) "Watch on TV from the start" else "Watch on TV") {
                            picked = null; run("watch", r, fromStart = r.recording)
                        }
                        if (resume) ActionRow(Icons.Rounded.Replay, "Watch from the start") { picked = null; run("watch", r, fromStart = true) }
                    }
                    if (r.converting) Text("Converting to MP4: " + r.conv.removePrefix("running ").trim() + "%", color = Muted, style = MaterialTheme.typography.bodySmall)
                    else if (r.conv.startsWith("error")) Text("Couldn't convert: " + r.conv.removePrefix("error: "), color = Bad, style = MaterialTheme.typography.bodySmall)
                    if (r.folder.isNotBlank()) Text("On the drive: TiviBro Recordings/" + r.folder + (if (r.conv == "mp4" || r.conv == "mkv") "  ·  " + r.conv.uppercase() else ""), color = Muted, style = MaterialTheme.typography.bodySmall)
                    if (r.canConvert) ActionRow(Icons.Rounded.Movie, "Convert to MP4") { picked = null; run("convert", r) }
                    if (r.recording) ActionRow(Icons.Rounded.Stop, "Stop recording", Bad) { picked = null; run("stop", r) }
                    if (r.scheduled) ActionRow(Icons.Rounded.Stop, "Cancel recording", Bad) { picked = null; run("stop", r) }
                    if (!r.recording) ActionRow(Icons.Rounded.Delete, "Delete" + (if (r.bytes > 0) "  ·  " + recSize(r.bytes) else ""), Bad) { picked = null; deleting = r }
                }
            },
            confirmButton = { TextButton(onClick = { picked = null }) { Text("Close") } },
        )
    }

    deleting?.let { r ->
        AlertDialog(
            onDismissRequest = { deleting = null }, containerColor = Panel,
            title = { Text("Delete this recording?") },
            text = { Text("\"${r.title}\" is deleted from the USB drive in the TV.  It can't be undone.") },
            confirmButton = { TextButton(onClick = { deleting = null; run("delete", r) }) { Text("Delete", color = Bad) } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Keep it") } },
        )
    }
}

@Composable
private fun ActionRow(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, tint: androidx.compose.ui.graphics.Color = Accent, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(MaterialTheme.shapes.small).clickable(onClick = onClick).padding(8.dp, 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Text(label, color = TextHi)
    }
}

@Composable
private fun DriveLine(d: RecDrive?) {
    Surface(color = Panel, shape = MaterialTheme.shapes.medium) {
        Row(Modifier.fillMaxWidth().padding(14.dp, 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Usb, null, tint = if (d == null) Muted else if (d.low) Bad else Accent, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                if (d == null) Text("No USB drive in the TV", fontWeight = FontWeight.SemiBold)
                else {
                    Text(d.name.ifBlank { "USB drive" }, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (d.freeMB >= 0 && d.totalMB > 0) {
                        Text((if (d.freeMB >= 1024) String.format(Locale.US, "%.1f GB", d.freeMB / 1024.0) else "${d.freeMB} MB") + " free of " +
                            String.format(Locale.US, "%.0f GB", d.totalMB / 1024.0) + (if (d.low) "  ·  nearly full" else ""),
                            color = if (d.low) Bad else Muted, style = MaterialTheme.typography.bodySmall)
                        LinearProgressIndicator(progress = { (1f - d.freeMB.toFloat() / d.totalMB).coerceIn(0f, 1f) }, color = if (d.low) Bad else Accent, trackColor = Panel2,
                            modifier = Modifier.fillMaxWidth().padding(top = 6.dp).height(4.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun RecRow(r: Recording, enabled: Boolean, onClick: () -> Unit) {
    Surface(color = Panel, shape = MaterialTheme.shapes.medium) {
        Row(Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).padding(12.dp, 10.dp), verticalAlignment = Alignment.CenterVertically) {
            if (r.poster.isNotBlank()) AsyncImage(model = r.poster, contentDescription = null, contentScale = ContentScale.Crop,
                modifier = Modifier.width(44.dp).height(66.dp).clip(RoundedCornerShape(6.dp)))
            else Logo(r.logo, "", 44.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (r.recording) { Icon(Icons.Rounded.FiberManualRecord, "Recording", tint = Bad, modifier = Modifier.size(12.dp)); Spacer(Modifier.width(6.dp)) }
                    Text(r.title.ifBlank { r.channel }, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                val facts = listOf(
                    if (r.ep.isNotBlank()) r.ep else "",
                    r.channel.takeIf { it != r.title }.orEmpty(),
                    if (r.scheduled) recWhen(r.start) + " – " + clockOf(r.end) else recWhen(r.at),
                ).filter { it.isNotBlank() }.joinToString("  ·  ")
                Text(facts, color = Muted, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val more = listOf(
                    if (r.recording) "until " + clockOf(r.end) else "",
                    if (r.dur > 0) recLength(r.dur) else "",
                    if (r.bytes > 0) recSize(r.bytes) else "",
                    if (r.watched) "Watched" else "",
                    if (r.error.isNotBlank() && !r.done) r.error else "",
                ).filter { it.isNotBlank() }.joinToString("  ·  ")
                if (more.isNotBlank()) Text(more, color = if (r.error.isNotBlank() && !r.done && !r.recording) Bad else Muted, style = MaterialTheme.typography.labelSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (r.done && r.dur > 0 && r.pos > 0 && !r.watched) LinearProgressIndicator(progress = { (r.pos.toFloat() / r.dur).coerceIn(0f, 1f) }, color = Accent, trackColor = Panel2,
                    modifier = Modifier.fillMaxWidth().padding(top = 6.dp).height(3.dp))
            }
        }
    }
}
