/* TiviBro's log on the phone (Settings tab > TiviBro log): the same text as Report a problem on the TV,
   the app's log for this and earlier sessions and the network helper's, with provider, guide and server
   names already taken out by the TV (ask "logs").  Problems only shows the warnings and errors; Share
   sends the text to another app (a message, an email, a GitHub issue). */
package app.tivibro.phone.ui

import android.content.Intent
import androidx.activity.compose.BackHandler
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.tivibro.phone.proto.TbException

private val PROBLEM = Regex("""^\d\d:\d\d:\d\d\s+(ERROR|WARN)|^\d+/\d+ \d\d:\d\d:\d\d\s+ERROR|ERROR """)

@Composable
fun LogScreen(model: AppModel, id: String, onBack: () -> Unit) {
    val ctx = LocalContext.current
    var text by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var problems by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    val list = rememberLazyListState()
    BackHandler(onBack = onBack)

    LaunchedEffect(attempt) {
        error = null
        try { text = model.tvLog(id) }
        catch (e: TbException) { error = e.message }
        catch (e: Exception) { error = "The TV didn't answer.  Is it on, and on the same network?" }
    }
    val lines = remember(text, problems) {
        val all = text?.lines().orEmpty()
        if (problems) all.filter { PROBLEM.containsMatchIn(it) || it.startsWith("#") } else all
    }
    // Newest at the bottom, like the TV: open there.
    LaunchedEffect(lines) { if (lines.isNotEmpty() && !problems) list.scrollToItem(lines.size - 1) }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(4.dp, 2.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
            Text("TiviBro log", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            IconButton(onClick = { text = null; attempt++ }) { Icon(Icons.Rounded.Refresh, "Read it again") }
            IconButton(enabled = text != null, onClick = {
                val t = text ?: return@IconButton
                val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, "TiviBro log")
                    .putExtra(Intent.EXTRA_TEXT, if (t.length > 300_000) "…" + t.takeLast(300_000) else t)
                runCatching { ctx.startActivity(Intent.createChooser(send, "Share the TiviBro log")) }
            }) { Icon(Icons.Rounded.Share, "Share") }
        }
        Row(Modifier.padding(16.dp, 0.dp, 16.dp, 6.dp), verticalAlignment = Alignment.CenterVertically) {
            FilterChip(selected = !problems, onClick = { problems = false }, label = { Text("Everything") })
            Spacer(Modifier.width(8.dp))
            FilterChip(selected = problems, onClick = { problems = true }, label = { Text("Problems only") })
        }
        Text("From the TV, with provider, guide and server names taken out.", color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(16.dp, 0.dp, 16.dp, 6.dp))
        when {
            text == null && error != null -> Column(Modifier.fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(error!!); Spacer(Modifier.size(12.dp)); Button(onClick = { attempt++ }) { Text("Try again") }
            }
            text == null -> Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            lines.isEmpty() -> Text(if (problems) "No warnings or errors.  Nice." else "The log is empty.", color = Muted, modifier = Modifier.padding(16.dp))
            else -> LazyColumn(state = list, contentPadding = PaddingValues(12.dp, 4.dp, 12.dp, 24.dp)) {
                itemsIndexed(lines) { _, l ->
                    Text(l, fontFamily = FontFamily.Monospace, fontSize = 11.sp, lineHeight = 14.sp,
                        color = when { l.contains("ERROR") -> Bad; l.contains("WARN") -> Accent2; l.startsWith("#") || l.startsWith("────") -> TextHi; else -> Muted })
                }
            }
        }
    }
}
