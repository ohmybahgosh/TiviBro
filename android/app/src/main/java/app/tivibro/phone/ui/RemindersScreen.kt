/* The reminders TiviBro on the TV will give, soonest first (ask "reminders"): when, the channel with its
   logo, the programme, and the watchlist word or team that set it.  Cancel one, or all of them.  Set new
   ones from the Guide (tap a channel, then the bell next to a programme) or On now. */
package app.tivibro.phone.ui

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.tivibro.phone.proto.Reminder
import app.tivibro.phone.proto.TbException
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

private fun dayOf(t: Long): Long = Calendar.getInstance().apply { timeInMillis = t; set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis

/** "Today", "Tomorrow" or "Sat 8 Nov", and the time. */
private fun whenOf(t: Long): Pair<String, String> {
    val d = ((dayOf(t) - dayOf(System.currentTimeMillis())) / 86_400_000L).toInt()
    val day = when (d) { 0 -> "Today"; 1 -> "Tomorrow"; else -> SimpleDateFormat("EEE d MMM", Locale.getDefault()).format(Date(t)) }
    return day to DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(t))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemindersScreen(model: AppModel, id: String, name: String, snack: SnackbarHostState, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<List<Reminder>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    var clearing by remember { mutableStateOf(false) }

    fun run(op: String, r: Reminder? = null) {
        busy = true; error = null
        scope.launch {
            try {
                val (msg, l) = model.reminders(id, op, r?.k.orEmpty(), r?.start ?: 0)
                list = l
                if (op != "list" && msg.isNotBlank()) model.say(msg)
            } catch (e: TbException) { error = e.message ?: "The TV said no" }
            catch (e: Exception) { error = "$name didn't answer.  Is it on, and on the same network?" }
            busy = false
        }
    }
    LaunchedEffect(attempt) { run("list") }

    Scaffold(
        containerColor = Ink, snackbarHost = { SnackbarHost(snack) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Reminders", maxLines = 1)
                        Text(name, color = Muted, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") } },
                actions = {
                    if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Accent)
                    if (!list.isNullOrEmpty()) TextButton(onClick = { clearing = true }, enabled = !busy) { Text("Cancel all", color = Bad) }
                    IconButton(onClick = { attempt++ }, enabled = !busy) { Icon(Icons.Rounded.Refresh, "Look again") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Ink),
            )
        },
    ) { pad ->
        val l = list
        when {
            l == null && error != null -> Column(Modifier.padding(pad).fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text(error ?: "", textAlign = TextAlign.Center)
                Spacer(Modifier.height(16.dp))
                Button(onClick = { attempt++ }) { Text("Try again") }
            }
            l == null -> Box(Modifier.padding(pad).fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            l.isEmpty() -> Column(Modifier.padding(pad).fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text("No reminders", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(8.dp))
                Text("Set one from the Guide: tap a channel, then the bell next to a programme.  Words and teams on your watchlist set them too.",
                    color = Muted, textAlign = TextAlign.Center)
            }
            else -> LazyColumn(Modifier.padding(pad).fillMaxSize(), contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                error?.let { e -> item { Text(e, color = Bad, style = MaterialTheme.typography.bodySmall) } }
                item {
                    Text("TiviBro on the TV tells you when these start, also while it is closed.", color = Muted, style = MaterialTheme.typography.bodySmall)
                }
                items(l, key = { it.k + "@" + it.start }) { r -> ReminderRow(r, enabled = !busy) { run("cancel", r) } }
            }
        }
    }

    if (clearing) AlertDialog(
        onDismissRequest = { clearing = false }, containerColor = Panel,
        title = { Text("Cancel all reminders?") },
        text = { Text("Every reminder on $name goes, also the ones your watchlist set.  Your watchlist itself stays and sets new ones as programmes come up.") },
        confirmButton = { TextButton(onClick = { clearing = false; run("clear") }) { Text("Cancel all", color = Bad) } },
        dismissButton = { TextButton(onClick = { clearing = false }) { Text("Keep them") } },
    )
}

@Composable
private fun ReminderRow(r: Reminder, enabled: Boolean, onCancel: () -> Unit) {
    val (day, time) = whenOf(r.start)
    Surface(color = Panel, shape = MaterialTheme.shapes.medium) {
        Row(Modifier.fillMaxWidth().padding(14.dp, 12.dp, 4.dp, 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.width(88.dp)) {
                Text(time, fontWeight = FontWeight.SemiBold, maxLines = 1, softWrap = false)  // "10:00 PM" whole: 76 dp cut off its PM
                // Started already: a Live badge, as on the TV.
                if (r.live) Surface(color = Bad, shape = MaterialTheme.shapes.small, modifier = Modifier.padding(top = 2.dp)) {
                    Text("Live", color = TextHi, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(8.dp, 1.dp))
                }
                else Text(day, color = Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1)
            }
            Logo(r.logo, "", 40.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(r.title.ifBlank { "Programme" }, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(r.channel, color = Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (r.from.isNotBlank()) Text(r.from, color = Accent, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            IconButton(onClick = onCancel, enabled = enabled) { Icon(Icons.Rounded.Close, "Cancel this reminder", tint = Muted) }
        }
    }
}
