/* The helper's paginated My media shows.  Existing movie browsing stays compatible with older TVs.
   Shows and their seasons are posters, like the Movies tab and the TV; a season's episodes are wide cards
   with their picture, air date, length and summary. */
package app.tivibro.phone.ui

import app.tivibro.phone.tr
import app.tivibro.phone.trn

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import coil.compose.AsyncImage
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject

private data class MediaScreen(val level: String, val handle: String = "", val bucket: String = "", val title: String = tr("TV shows"))

@Composable
fun MyMediaTab(model: AppModel, id: String) {
    var shows by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            GroupChip(tr("Movies"), !shows) { shows = false }
            GroupChip(tr("TV shows"), shows) { shows = true }
        }
        if (!shows) VodTab(model, id, "media") else MediaShows(model, id)
    }
}

@Composable
private fun MediaShows(model: AppModel, id: String) {
    val stack = remember { mutableStateListOf(MediaScreen("shows")) }
    val screen = stack.last()
    var cursor by remember(screen) { mutableStateOf<JSONObject?>(null) }
    var next by remember(screen) { mutableStateOf<JSONObject?>(null) }
    var rows by remember(screen) { mutableStateOf<List<JSONObject>>(emptyList()) }
    var loading by remember(screen) { mutableStateOf(true) }
    var error by remember(screen) { mutableStateOf<String?>(null) }
    var attempt by remember(screen) { mutableIntStateOf(0) }
    var detail by remember(screen) { mutableStateOf<JSONObject?>(null) }
    val scope = rememberCoroutineScope()
    BackHandler(stack.size > 1) { stack.removeAt(stack.lastIndex) }
    LaunchedEffect(screen, cursor, attempt) {
        loading = true; error = null
        try {
            val args = JSONObject().put("limit", 60)
            val what = when (screen.level) {
                "show" -> { args.put("handle", screen.handle); "mediashow" }
                "episodes" -> { args.put("show", screen.handle).put("bucket", screen.bucket).put("full", true); "mediaepisodes" }
                "episode" -> { args.put("handle", screen.handle); "mediaepisode" }
                else -> { args.put("kind", "show"); "medialibrary" }
            }
            cursor?.let { args.put("cursor", it) }
            val result = model.ask(id, what, args)
            detail = result
            val array = result.optJSONArray(when (screen.level) { "show" -> "buckets"; "episode" -> "versions"; else -> "items" })
            val page = if (array == null) emptyList() else (0 until array.length()).mapNotNull { array.optJSONObject(it) }
            rows = if (cursor == null) page else rows + page
            next = result.optJSONObject("nextCursor")
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { error = e.message ?: tr("The TV could not read this library.") }
        finally { loading = false }
    }
    Column(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
        if (stack.size > 1) TextButton(onClick = { stack.removeAt(stack.lastIndex) }) { Text(tr("Back")) }
        Text(screen.title, style = MaterialTheme.typography.titleLarge)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error); TextButton(onClick = { attempt++ }) { Text(tr("Retry")) } }
        if (screen.level == "episode") {
            detail?.let { ep ->
                val watched = ep.optString("watchState") == "watched"
                TextButton(onClick = {
                    scope.launch {
                        try {
                            model.ask(id, "mediaedit", JSONObject().put("handle", screen.handle).put("expectedRevision", ep.optInt("revision")).put("operation", "setWatched").put("watched", !watched), tries = 1)
                            attempt++
                        } catch (e: CancellationException) { throw e }
                        catch (e: Exception) { error = e.message }
                    }
                }) { Text(if (watched) tr("Mark unwatched") else tr("Mark watched")) }
            }
        }
        val go: (JSONObject, String) -> Unit = { row, label ->
            cursor = null
            stack.add(when (screen.level) {
                "shows" -> MediaScreen("show", row.optString("handle"), title = label)
                "show" -> MediaScreen("episodes", screen.handle, row.optString("key"), label)
                else -> MediaScreen("episode", row.optString("handle"), title = label)
            })
        }
        if (screen.level == "shows" || screen.level == "show") {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(108.dp), modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(0.dp, 8.dp, 0.dp, 32.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                items(rows) { row ->
                    val md = row.optJSONObject("metadata")
                    val label = if (screen.level == "show") seasonLabel(row) else str(md?.optString("title")).ifBlank { str(row.optString("title")) }
                    val pic = if (screen.level == "show") str(row.optString("poster")).ifBlank { str(detail?.optJSONObject("metadata")?.optString("poster")) } else str(md?.optString("poster"))
                    val sub = if (screen.level == "show") trn(row.optInt("count"), "{n} episode", "{n} episodes") else str(md?.optString("year"))
                    MediaPoster(label, pic, sub) { go(row, label) }
                }
                if (next != null) item(span = { GridItemSpan(maxLineSpan) }) { TextButton(onClick = { cursor = next }) { Text(tr("Load more")) } }
                if (loading) item(span = { GridItemSpan(maxLineSpan) }) { CircularProgressIndicator(Modifier.padding(16.dp)) }
            }
        } else if (screen.level == "episodes") {
            LazyColumn(Modifier.weight(1f)) {
                items(rows) { row ->
                    val md = row.optJSONObject("metadata")
                    val num = str(row.optString("label")).ifBlank { "S${row.optInt("season")}E${row.optInt("number")}" }
                    val title = str(md?.optString("title")).ifBlank { str(row.optString("title")) }
                    val sub = listOf(str(md?.optString("airDate")), md?.optInt("runtime")?.takeIf { it > 0 }?.let { tr("{n} min", "n" to it) }.orEmpty(), if (row.optString("watchState") == "watched") tr("✓ watched") else "").filter { it.isNotBlank() }.joinToString("  ·  ")
                    Row(Modifier.fillMaxWidth().clickable { go(row, "$num $title".trim()) }.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.width(150.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(10.dp)).background(Panel2), contentAlignment = Alignment.Center) {
                            Text(num, color = Muted, style = MaterialTheme.typography.labelSmall)
                            val still = str(md?.optString("still"))
                            if (still.isNotBlank()) AsyncImage(model = still, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        }
                        Column(Modifier.weight(1f)) {
                            Text("$num  $title".trim(), style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            if (sub.isNotBlank()) Text(sub, color = Muted, style = MaterialTheme.typography.labelSmall)
                            val plot = str(md?.optString("plot"))
                            if (plot.isNotBlank()) Text(plot, color = Muted, style = MaterialTheme.typography.labelSmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                if (next != null) item { TextButton(onClick = { cursor = next }) { Text(tr("Load more")) } }
                if (loading) item { CircularProgressIndicator(Modifier.padding(16.dp)) }
            }
        } else LazyColumn(Modifier.weight(1f)) {
            items(rows) { row ->
                val label = when (screen.level) {
                    "show" -> row.optString("title").takeUnless { it.isBlank() || it == "null" } ?: if (row.optString("key") == "0") tr("Specials") else if (row.optString("key").length < 4 && row.optString("key").all { it.isDigit() }) "Season ${row.optString("key")}" else row.optString("key")
                    "episode" -> row.optString("label", tr("Version"))
                    else -> {
                        val md = row.optJSONObject("metadata")
                        val prefix = if (screen.level == "episodes") row.optString("label").takeUnless { it.isBlank() || it == "null" } ?: row.optString("airDate").takeUnless { it.isBlank() || it == "null" }
                            ?: row.opt("absoluteNumber")?.takeUnless { it == JSONObject.NULL }?.toString()
                            ?: "S${row.optInt("season")}E${row.optInt("number")}" else ""
                        "$prefix ${md?.optString("title") ?: row.optString("title")}".trim()
                    }
                }
                if (screen.level == "episode") {
                    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                        Text(label)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf(false, true).forEach { fromStart ->
                                OutlinedButton(enabled = row.optString("availability") != "missing", onClick = {
                                    scope.launch {
                                        try {
                                            model.ask(id, "mediaplay", JSONObject().put("handle", screen.handle).put("version", row.optString("handle")).put("fromStart", fromStart), tries = 1)
                                        } catch (e: CancellationException) { throw e }
                                        catch (e: Exception) { error = e.message }
                                    }
                                }) { Text(if (fromStart) tr("From start") else tr("Play on TV")) }
                            }
                        }
                    }
                } else {
                    Text(label, Modifier.fillMaxWidth().clickable {
                        cursor = null
                        stack.add(when (screen.level) {
                            "shows" -> MediaScreen("show", row.optString("handle"), title = label)
                            "show" -> MediaScreen("episodes", screen.handle, row.optString("key"), label)
                            else -> MediaScreen("episode", row.optString("handle"), title = label)
                        })
                    }.padding(vertical = 18.dp))
                }
            }
            if (next != null) item { TextButton(onClick = { cursor = next }) { Text(tr("Load more")) } }
            if (loading) item { CircularProgressIndicator(Modifier.padding(16.dp)) }
        }
    }
}

// A JSON string that may be missing or the word null.
private fun str(v: String?): String = if (v == null || v == "null") "" else v

private fun seasonLabel(row: JSONObject): String {
    val key = row.optString("key")
    return if (key == "0") tr("Specials") else if (key.isNotEmpty() && key.length < 4 && key.all { it.isDigit() }) "Season $key" else str(row.optString("title")).ifBlank { key }
}

@Composable
private fun MediaPoster(label: String, pic: String, sub: String, onClick: () -> Unit) {
    Column(Modifier.clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp)).background(Panel2), contentAlignment = Alignment.Center) {
            Text(label, color = Muted, style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.Center, maxLines = 4, modifier = Modifier.padding(8.dp))
            if (pic.isNotBlank()) AsyncImage(model = pic, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
        Spacer(Modifier.height(6.dp))
        Text(label, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (sub.isNotBlank()) Text(sub, color = Muted, style = MaterialTheme.typography.labelSmall)
    }
}
