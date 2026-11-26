/* TiviBro's log on the phone (Settings tab > TiviBro log): the same text as Report a problem on the TV,
   the app's log for this and earlier sessions and the network helper's, with provider, guide and server
   names already taken out by the TV (ask "logs").  It follows along while it's open: every two seconds the
   TV sends the lines written since (ask "logs" with since), and the list stays at the newest line unless
   you've scrolled up to read (then "Newest" brings you back).  Lines are coloured: the time dim, warnings
   amber, errors red, each part of TiviBro (player, guide, net...) in its own colour.  Problems only shows
   the warnings and errors; Share sends the text to another app (a message, an email, a GitHub issue). */
package app.tivibro.phone.ui

import app.tivibro.phone.tr

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.tivibro.phone.proto.TbException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val PROBLEM = Regex("""^\d\d:\d\d:\d\d\s+(ERROR|WARN)|^\d+/\d+ \d\d:\d\d:\d\d\s+ERROR|ERROR """)
/** How often the open log asks the TV for new lines. */
private const val FOLLOW_MS = 2_000L
/** Lines kept on screen while following (the oldest go first), so a log left open all evening stays quick. */
private const val KEEP = 6_000

@Composable
fun LogScreen(model: AppModel, id: String, onBack: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var all by remember { mutableStateOf<List<String>?>(null) }
    var seq by remember { mutableIntStateOf(-1) }           // where the TV's log is up to; -1: can't follow (older TV)
    var live by remember { mutableStateOf(false) }          // the last ask for new lines was answered
    var error by remember { mutableStateOf<String?>(null) }
    var problems by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    val list = rememberLazyListState()
    BackHandler(onBack = onBack)

    // The whole log (on opening, Read it again, or after missing lines).
    LaunchedEffect(attempt) {
        error = null
        try { val (t, s) = model.tvLog(id); all = t.lines(); seq = s }
        catch (e: TbException) { error = e.message }
        catch (e: Exception) { error = tr("The TV didn't answer.  Is it on, and on the same network?") }
    }
    // Following along: the lines written since, every two seconds while this screen is open.  A failed ask (TiviBro
    // closed, the TV off) shows Paused and tries again; missed lines read the whole log again.
    LaunchedEffect(attempt, seq >= 0) {
        if (seq < 0) { live = false; return@LaunchedEffect }
        while (true) {
            delay(FOLLOW_MS)
            try {
                val (s, more, gap) = model.tvLogSince(id, seq)
                live = true
                if (gap) { attempt++; return@LaunchedEffect }
                if (more.isNotEmpty()) all = (all.orEmpty() + more).takeLast(KEEP)
                seq = s
            } catch (e: Exception) { live = false }
        }
    }
    val lines = remember(all, problems) {
        val l = all.orEmpty()
        if (problems) l.filter { PROBLEM.containsMatchIn(it) || it.startsWith("#") } else l
    }
    // At the newest line (or within two of it): new lines keep it there.  Scrolled up to read: it stays put.
    val atEnd by remember { derivedStateOf { val i = list.layoutInfo; i.totalItemsCount == 0 || (i.visibleItemsInfo.lastOrNull()?.index ?: 0) >= i.totalItemsCount - 3 } }
    var follow by remember { mutableStateOf(true) }
    LaunchedEffect(atEnd, list.isScrollInProgress) { if (list.isScrollInProgress) follow = atEnd }
    LaunchedEffect(lines.size, problems) { if (lines.isNotEmpty() && follow) list.scrollToItem(lines.size - 1) }

    Box(Modifier.fillMaxSize()) {
      Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(4.dp, 2.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, tr("Back")) }
            Text(tr("TiviBro log"), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            if (seq >= 0 && all != null) LiveBadge(live)
            IconButton(onClick = { all = null; follow = true; attempt++ }) { Icon(Icons.Rounded.Refresh, tr("Read it again")) }
            IconButton(enabled = all != null, onClick = {
                val t = all?.joinToString("\n") ?: return@IconButton
                val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, tr("TiviBro log"))
                    .putExtra(Intent.EXTRA_TEXT, if (t.length > 300_000) "…" + t.takeLast(300_000) else t)
                runCatching { ctx.startActivity(Intent.createChooser(send, tr("Share the TiviBro log"))) }
            }) { Icon(Icons.Rounded.Share, tr("Share")) }
        }
        Row(Modifier.padding(16.dp, 0.dp, 16.dp, 6.dp), verticalAlignment = Alignment.CenterVertically) {
            GroupChip(tr("Everything"), !problems) { problems = false; follow = true }
            Spacer(Modifier.width(8.dp))
            GroupChip(tr("Problems only"), problems) { problems = true; follow = true }
        }
        Text(tr("From the TV, with provider, guide and server names taken out."), color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(16.dp, 0.dp, 16.dp, 6.dp))
        when {
            all == null && error != null -> Column(Modifier.fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(error!!); Spacer(Modifier.size(12.dp)); Button(onClick = { attempt++ }) { Text(tr("Try again")) }
            }
            all == null -> Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            lines.isEmpty() -> Text(if (problems) tr("No warnings or errors.  Nice.") else tr("The log is empty."), color = Muted, modifier = Modifier.padding(16.dp))
            else -> LazyColumn(state = list, contentPadding = PaddingValues(12.dp, 4.dp, 12.dp, 80.dp)) {
                itemsIndexed(lines) { _, l -> Text(colourLine(l), fontFamily = FontFamily.Monospace, fontSize = 11.sp, lineHeight = 14.sp) }
            }
        }
      }
      // Scrolled up while new lines come in: back to the newest, and following again.
      if (!follow && lines.isNotEmpty()) ExtendedFloatingActionButton(
          onClick = { follow = true; scope.launch { list.animateScrollToItem(lines.size - 1) } },
          icon = { Icon(Icons.Rounded.KeyboardArrowDown, null) }, text = { Text(tr("Newest")) },
          containerColor = Accent, contentColor = OnAccent,
          modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp))
    }
}

/** "Live" with a green dot while new lines are coming in; grey "Paused" when the TV stopped answering. */
@Composable
private fun LiveBadge(on: Boolean) {
    Row(Modifier.padding(end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(if (on) Good else Muted))
        Spacer(Modifier.width(6.dp))
        Text(if (on) tr("Live") else tr("Paused"), color = if (on) Good else Muted, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
    }
}

/** The colours of the parts of TiviBro in the log (a line's category: player, guide, net...), picked by its name. */
private val CATS = listOf(Color(0xFF7DA2FF), Color(0xFF5BD0FF), Color(0xFFA78BFA), Color(0xFF30D17A), Color(0xFFF59ACB), Color(0xFF9FE870), Color(0xFFFFB86B), Color(0xFF6EE7D8))
private val APP_LINE = Regex("""^(\d\d:\d\d:\d\d)(\s+)(ERROR|WARN|debug)?(\s*)(\S+)(\s{2})(.*)$""")
private val HELPER_LINE = Regex("""^(\d+/\d+ \d\d:\d\d:\d\d)(\s+)(.*)$""")

/* One log line in colour.  The app's lines ("12:01:05  WARN  player  ...") get a dim time, the level in amber
   or red, the category in its own colour and the message bright for problems, plain otherwise.  The helper's
   ("11/26 12:01:05 ...") get a dim time.  Section headings (# ...) and session lines stand out. */
internal fun colourLine(l: String): AnnotatedString {
    if (l.startsWith("#") || l.startsWith("────")) return AnnotatedString(l, SpanStyle(color = Accent, fontWeight = FontWeight.Bold))
    val err = l.contains("ERROR"); val warn = !err && l.contains("WARN")
    val body = when { err -> Color(0xFFFF9A9D); warn -> Warn; else -> TextHi.copy(alpha = 0.82f) }
    APP_LINE.matchEntire(l)?.let { m ->
        val (time, gap, lv, gap2, cat, gap3, msg) = m.destructured
        return buildAnnotatedString {
            withStyle(SpanStyle(color = Muted)) { append(time) }
            append(gap)
            when (lv) {
                "ERROR" -> withStyle(SpanStyle(color = Bad, fontWeight = FontWeight.Bold)) { append(lv) }
                "WARN" -> withStyle(SpanStyle(color = Warn, fontWeight = FontWeight.Bold)) { append(lv) }
                "debug" -> withStyle(SpanStyle(color = Muted)) { append(lv) }
            }
            append(gap2)
            withStyle(SpanStyle(color = CATS[Math.floorMod(cat.hashCode(), CATS.size)], fontWeight = FontWeight.SemiBold)) { append(cat) }
            append(gap3)
            withStyle(SpanStyle(color = body)) { append(msg) }
        }
    }
    HELPER_LINE.matchEntire(l)?.let { m ->
        val (time, gap, rest) = m.destructured
        return buildAnnotatedString {
            withStyle(SpanStyle(color = Muted)) { append(time) }
            append(gap)
            withStyle(SpanStyle(color = body)) { append(rest) }
        }
    }
    return AnnotatedString(l, SpanStyle(color = if (err || warn) body else Muted))
}
