/* The helper's paginated My media shows.  Existing movie browsing stays compatible with older TVs. */
package app.tivibro.phone.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject

private data class MediaScreen(val level: String, val handle: String = "", val bucket: String = "", val title: String = "TV shows")

@Composable
fun MyMediaTab(model: AppModel, id: String) {
    var shows by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            GroupChip("Movies", !shows) { shows = false }
            GroupChip("TV shows", shows) { shows = true }
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
                "episodes" -> { args.put("show", screen.handle).put("bucket", screen.bucket); "mediaepisodes" }
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
        catch (e: Exception) { error = e.message ?: "The TV could not read this library." }
        finally { loading = false }
    }
    Column(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
        if (stack.size > 1) TextButton(onClick = { stack.removeAt(stack.lastIndex) }) { Text("Back") }
        Text(screen.title, style = MaterialTheme.typography.titleLarge)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error); TextButton(onClick = { attempt++ }) { Text("Retry") } }
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
                }) { Text(if (watched) "Mark unwatched" else "Mark watched") }
            }
        }
        LazyColumn(Modifier.weight(1f)) {
            items(rows) { row ->
                val label = when (screen.level) {
                    "show" -> row.optString("title").takeUnless { it.isBlank() || it == "null" } ?: if (row.optString("key") == "0") "Specials" else if (row.optString("key").length < 4 && row.optString("key").all { it.isDigit() }) "Season ${row.optString("key")}" else row.optString("key")
                    "episode" -> row.optString("label", "Version")
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
                                }) { Text(if (fromStart) "From start" else "Play on TV") }
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
            if (next != null) item { TextButton(onClick = { cursor = next }) { Text("Load more") } }
            if (loading) item { CircularProgressIndicator(Modifier.padding(16.dp)) }
        }
    }
}
