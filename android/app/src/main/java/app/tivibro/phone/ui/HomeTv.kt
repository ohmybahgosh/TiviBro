/* The parts of the home screen around one TV's card (HomeScreen.kt): what's on the TV now, the reminders coming up on
   it, the dots under the card when there are several TVs (swipe between them), and the sheet that lists them all
   (tap the TV's name): each with its state and one action, Turn on, Open or Showing, plus Add a TV. */
package app.tivibro.phone.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Notifications
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.tivibro.phone.notify.PhoneReminders
import app.tivibro.phone.tr
import coil.compose.AsyncImage
import java.text.DateFormat
import java.util.Date

/** The TV's state in a few words, and its dot's colour (the card's status line and the TV sheet). */
fun stateOf(u: TvUi): Pair<Color, String> = when (u.power) {
    Power.CHECKING -> Muted to tr("Checking…")
    Power.WAKING -> Accent to tr("Turning on…")
    Power.ON -> Good to (if (u.tivibroOpen) tr("On · TiviBro open") else tr("On"))
    Power.STARTING -> Accent to tr("On · TiviBro's connection starting")
    Power.OFF -> Muted to (if (u.standby) tr("Off (standby)") else tr("Off or not reachable"))
    Power.UNPAIRED -> Bad to tr("This TV no longer knows this phone")
}

/* Now on the TV: the channel's logo and name, the programme, and how far into it (or the movie or episode playing).
   Nothing when TiviBro isn't open or shows nothing playing. */
@Composable
fun NowOnTv(u: TvUi) {
    val c = u.caps ?: return
    if (!c.open || (c.channel.isBlank() && c.vodTitle.isBlank())) return
    val now = System.currentTimeMillis()
    val title = if (c.vodTitle.isNotBlank()) c.vodTitle else c.now?.title ?: c.channel
    val frac = when {
        c.vodTitle.isNotBlank() && c.vodDur > 0 -> c.vodPos.toFloat() / c.vodDur
        c.now != null && c.now.end > c.now.start -> (now - c.now.start).toFloat() / (c.now.end - c.now.start)
        else -> -1f
    }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color(0xFF0F1A33)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(48.dp, 36.dp).clip(RoundedCornerShape(8.dp)).background(Color.White), contentAlignment = Alignment.Center) {
                if (c.logo.isNotBlank() && c.vodTitle.isBlank()) AsyncImage(c.logo, null, Modifier.padding(3.dp))
                else Text(if (c.vodTitle.isNotBlank()) "▶" else c.number, color = Ink, fontWeight = FontWeight.Black, style = MaterialTheme.typography.labelMedium)
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(tr("Now on the TV").uppercase(), color = Muted, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                Text(title, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (c.vodTitle.isBlank() && c.channel.isNotBlank()) Text(c.channel, color = Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (frac >= 0f) LinearProgressIndicator(progress = { frac.coerceIn(0f, 1f) }, color = Accent, trackColor = Panel2, modifier = Modifier.fillMaxWidth().height(4.dp).clip(CircleShape))
    }
}

/* The next reminders on this TV, from the phone's own copy (notify/PhoneReminders.kt, kept in step in the background),
   so it shows at once.  Nothing when there are none. */
@Composable
fun ComingUp(tvId: String, onAll: () -> Unit) {
    val ctx = LocalContext.current
    val now = System.currentTimeMillis()
    val l = PhoneReminders.all(ctx).filter { it.tv == tvId && it.end > now }.take(3)
    if (l.isEmpty()) return
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Panel).padding(14.dp, 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(tr("Coming up").uppercase(), color = Muted, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            TextButton(onClick = onAll) { Text(tr("All reminders")) }
        }
        l.forEach { r ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Notifications, null, tint = Warn, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(10.dp))
                Text(r.title + if (r.channel.isNotBlank()) "  ·  ${r.channel}" else "", maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                Text(if (r.start <= now) tr("On now") else DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(r.start)), color = TextHi, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/** Which TV of several shows (under its card): the current one long. */
@Composable
fun PageDots(count: Int, at: Int) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
        repeat(count) { i ->
            Box(Modifier.padding(horizontal = 3.dp).size(if (i == at) 18.dp else 6.dp, 6.dp).clip(CircleShape).background(if (i == at) Accent else Panel2))
        }
    }
}

/* Every paired TV (tap the TV's name on the home screen): its state and one thing to do.  Tapping a TV shows its card;
   Turn on wakes one that's off; Open puts TiviBro on one that's on something else.  Add a TV at the end. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TvSwitchSheet(tvs: List<TvUi>, at: Int, onPick: (Int) -> Unit, onWake: (String) -> Unit, onOpen: (String) -> Unit, onAdd: () -> Unit, onDismiss: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Panel) {
        Column(Modifier.padding(16.dp, 0.dp, 16.dp, 20.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(tr("Your TVs"), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(4.dp, 0.dp, 0.dp, 6.dp))
            tvs.forEachIndexed { i, u ->
                val (dot, state) = stateOf(u)
                val playing = u.caps?.takeIf { it.open }?.let { c -> c.vodTitle.ifBlank { listOf(c.channel, c.now?.title.orEmpty()).filter { it.isNotBlank() }.joinToString(" · ") } }.orEmpty()
                val here = i == at
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(if (here) Color(0xFF1D2A52) else Panel2)
                        .then(if (here) Modifier.border(BorderStroke(2.dp, Accent), RoundedCornerShape(16.dp)) else Modifier)
                        .clickable(onClickLabel = tr("Show {x}", "x" to u.tv.name)) { onPick(i) }.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(10.dp).clip(CircleShape).background(dot))
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(u.tv.name, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(playing.ifBlank { state }, color = Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    when {
                        here -> Text(tr("Showing"), color = Accent, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                        u.power == Power.OFF && u.tv.canWake() -> TextButton(onClick = { onWake(u.tv.id); onPick(i) }) { Text(tr("Turn on"), color = Good) }
                        u.power == Power.ON && !u.tivibroOpen -> TextButton(onClick = { onOpen(u.tv.id); onPick(i) }) { Text(tr("Open")) }
                    }
                }
            }
            OutlinedButton(onClick = { onDismiss(); onAdd() }, modifier = Modifier.fillMaxWidth().height(48.dp).padding(top = 4.dp)) {
                Icon(Icons.Rounded.Add, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text(tr("Add a TV"))
            }
        }
    }
}
