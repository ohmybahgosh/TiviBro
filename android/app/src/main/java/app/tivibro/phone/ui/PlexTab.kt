/* Plex on the phone (the tab shows once the TV has a Plex server added): Home with the Plex tab's rows, each
   library picked on the TV as a poster grid, a show's seasons and episodes, and search.  Everything plays on
   the TV, from where you stopped or from the start; nothing plays on the phone.  The TV answers the lists
   (plexphone.js); posters come straight from the Plex server, its token in a header, never in an address. */
package app.tivibro.phone.ui

import app.tivibro.phone.tr

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Replay
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.tivibro.phone.proto.TbException
import coil.compose.AsyncImage
import coil.request.ImageRequest
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URLEncoder

/** A Plex title as the TV sends it (plexphone.js slim()). */
data class PlexItem(val server: String, val key: String, val type: String, val title: String, val sub: String, val thumb: String,
                    val offset: Long, val duration: Long, val watched: Boolean, val left: Int, val summary: String) {
    val plays get() = type == "movie" || type == "episode"
    companion object {
        fun from(j: JSONObject) = PlexItem(j.optString("server"), j.optString("key"), j.optString("type"), j.optString("title"), j.optString("sub"),
            j.optString("thumb"), j.optLong("offset"), j.optLong("duration"), j.optInt("watched") == 1, j.optInt("left"), j.optString("summary"))
        fun list(a: org.json.JSONArray?) = (0 until (a?.length() ?: 0)).map { from(a!!.getJSONObject(it)) }
    }
}
/** Where a server's pictures come from: its address and its own token (sent as a header). */
data class PlexPics(val base: String, val token: String)
private data class PlexLib(val server: String, val key: String, val title: String)
private data class PlexScreen(val kind: String, val lib: PlexLib? = null, val parent: PlexItem? = null)

private fun picsOf(j: JSONObject): Map<String, PlexPics> {
    val p = j.optJSONObject("pics") ?: return emptyMap()
    return p.keys().asSequence().associateWith { k -> p.getJSONObject(k).let { PlexPics(it.optString("base"), it.optString("token")) } }
}
private fun err(e: Exception) = (e as? TbException)?.message ?: tr("The TV didn't answer.  Is it on, and on the same network?")
private fun clock(ms: Long): String { val s = ms / 1000; val h = s / 3600; val m = s % 3600 / 60; return if (h > 0) "$h:%02d:%02d".format(m, s % 60) else "$m:%02d".format(s % 60) }

@Composable
fun PlexTab(model: AppModel, id: String) {
    var libs by remember { mutableStateOf<List<PlexLib>?>(null) }
    var pics by remember { mutableStateOf<Map<String, PlexPics>>(emptyMap()) }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    val stack = remember { mutableStateListOf(PlexScreen("home")) }
    var q by remember { mutableStateOf("") }
    var open by remember { mutableStateOf<PlexItem?>(null) }
    LaunchedEffect(attempt) {
        error = null
        try {
            val r = model.plex(id, JSONObject().put("op", "libs"))
            pics = picsOf(r)
            libs = (0 until (r.optJSONArray("libs")?.length() ?: 0)).map { i -> r.getJSONArray("libs").getJSONObject(i).let { PlexLib(it.optString("server"), it.optString("key"), it.optString("title")) } }
        } catch (e: Exception) { error = err(e) }
    }
    if (libs == null) { PlexWait(error) { attempt++ }; return }
    BackHandler(stack.size > 1) { stack.removeAt(stack.lastIndex) }
    val screen = stack.last()
    // OK on a title: a show, season or collection opens in place; a movie or an episode shows its details.
    val pick: (PlexItem) -> Unit = { if (it.plays) open = it else stack.add(PlexScreen("children", parent = it)) }
    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = q, onValueChange = { q = it }, singleLine = true, leadingIcon = { Icon(Icons.Rounded.Search, null) },
            trailingIcon = { if (q.isNotEmpty()) IconButton(onClick = { q = "" }) { Icon(Icons.Rounded.Close, tr("Clear")) } },
            placeholder = { Text(tr("Search Plex")) }, shape = RoundedCornerShape(28.dp),
            colors = OutlinedTextFieldDefaults.colors(unfocusedContainerColor = Panel, focusedContainerColor = Panel, unfocusedBorderColor = Line),
            modifier = Modifier.fillMaxWidth().padding(16.dp, 12.dp, 16.dp, 4.dp),
        )
        if (q.isBlank() && stack.size == 1) LazyRow(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item { GroupChip(tr("Home"), screen.kind == "home") { stack.clear(); stack.add(PlexScreen("home")) } }
            items(libs!!, key = { it.server + ":" + it.key }) { l -> GroupChip(l.title, screen.lib == l) { stack.clear(); stack.add(PlexScreen("lib", lib = l)) } }
        }
        if (stack.size > 1 && q.isBlank()) Text(screen.parent?.title.orEmpty(), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(20.dp, 8.dp))
        when {
            q.isNotBlank() -> PlexSearch(model, id, q, pics, pick)
            screen.kind == "home" -> PlexHome(model, id, pics, pick)
            screen.kind == "lib" -> PlexGrid(model, id, JSONObject().put("op", "lib").put("server", screen.lib!!.server).put("key", screen.lib.key), pics, pick)
            else -> PlexGrid(model, id, JSONObject().put("op", "children").put("server", screen.parent!!.server).put("key", screen.parent.key).put("type", screen.parent.type), pics, pick)
        }
    }
    open?.let { PlexDetails(model, id, it, pics) { open = null } }
}

@Composable
private fun PlexWait(error: String?, retry: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        if (error != null) { Text(error, textAlign = TextAlign.Center); Spacer(Modifier.height(16.dp)); Button(onClick = retry) { Text(tr("Try again")) } }
        else { CircularProgressIndicator(); Spacer(Modifier.height(16.dp)); Text(tr("Getting Plex from the TV…"), color = Muted) }
    }
}

/** A poster from the Plex server, sized by the server, with the server's token in a header. */
@Composable
fun PlexPic(pics: Map<String, PlexPics>, server: String, path: String, w: Int, h: Int, modifier: Modifier = Modifier) {
    val p = pics[server] ?: return
    if (path.isBlank()) return
    val url = p.base.trimEnd('/') + "/photo/:/transcode?width=$w&height=$h&minSize=1&upscale=1&url=" + URLEncoder.encode(path, "UTF-8")
    val req = ImageRequest.Builder(LocalContext.current).data(url).addHeader("X-Plex-Token", p.token).crossfade(true).build()
    AsyncImage(model = req, contentDescription = null, contentScale = ContentScale.Crop, modifier = modifier)
}

@Composable
private fun PlexPoster(it: PlexItem, pics: Map<String, PlexPics>, onClick: () -> Unit) {
    Column(Modifier.clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp)).background(Panel2), contentAlignment = Alignment.Center) {
            Text(it.title, color = Muted, style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.Center, maxLines = 4, modifier = Modifier.padding(8.dp))
            PlexPic(pics, it.server, it.thumb, 240, 360, Modifier.fillMaxSize())
            if (it.left > 0) Surface(color = Accent, shape = RoundedCornerShape(bottomStart = 10.dp), modifier = Modifier.align(Alignment.TopEnd)) { Text("${it.left}", style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(6.dp, 2.dp)) }
            if (it.offset > 0 && it.duration > 0) LinearProgressIndicator(progress = { (it.offset.toFloat() / it.duration).coerceIn(0f, 1f) }, color = Accent, trackColor = Panel2, modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(4.dp))
        }
        Spacer(Modifier.height(6.dp))
        Text(it.title, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (it.sub.isNotBlank()) Text(it.sub, color = Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Home: the Plex tab's rows, each a strip of posters. */
@Composable
private fun PlexHome(model: AppModel, id: String, pics0: Map<String, PlexPics>, pick: (PlexItem) -> Unit) {
    var rows by remember { mutableStateOf<List<Pair<String, List<PlexItem>>>?>(null) }
    var pics by remember { mutableStateOf(pics0) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        try {
            val r = model.plex(id, JSONObject().put("op", "home"))
            pics = picsOf(r).ifEmpty { pics0 }
            val a = r.optJSONArray("rows")
            rows = (0 until (a?.length() ?: 0)).map { i -> a!!.getJSONObject(i).let { it.optString("title") to PlexItem.list(it.optJSONArray("items")) } }
        } catch (e: Exception) { error = err(e) }
    }
    val list = rows ?: run { PlexWait(error) {}; return }
    if (list.isEmpty()) { Text(tr("Nothing here yet"), color = Muted, modifier = Modifier.padding(28.dp)); return }
    LazyColumn(contentPadding = PaddingValues(bottom = 32.dp)) {
        items(list, key = { it.first }) { (title, row) ->
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(20.dp, 14.dp, 20.dp, 8.dp))
            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                items(row, key = { it.server + ":" + it.key }) { m -> Box(Modifier.width(112.dp)) { PlexPoster(m, pics) { pick(m) } } }
            }
        }
    }
}

/** A grid of titles: a library a page at a time, or a show's seasons, a season's episodes, a collection. */
@Composable
private fun PlexGrid(model: AppModel, id: String, ask: JSONObject, pics0: Map<String, PlexPics>, pick: (PlexItem) -> Unit) {
    val k = ask.toString()
    val items = remember(k) { mutableStateListOf<PlexItem>() }
    var total by remember(k) { mutableIntStateOf(-1) }
    var pics by remember(k) { mutableStateOf(pics0) }
    var loading by remember(k) { mutableStateOf(false) }
    var error by remember(k) { mutableStateOf<String?>(null) }
    val grid = rememberLazyGridState()
    val scope = rememberCoroutineScope()
    suspend fun more() {
        if (loading || (total >= 0 && items.size >= total)) return
        loading = true
        try {
            val r = model.plex(id, JSONObject(k).put("offset", items.size))
            pics = picsOf(r).ifEmpty { pics0 }
            val got = PlexItem.list(r.optJSONArray("items")); items.addAll(got)
            total = if (r.has("total")) r.optInt("total") else items.size
        } catch (e: Exception) { error = err(e) } finally { loading = false }
    }
    LaunchedEffect(k) { more() }
    LaunchedEffect(k, grid) { snapshotFlow { grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }.collect { last -> if (last > items.size - 18 && items.isNotEmpty()) scope.launch { more() } } }
    when {
        total < 0 && error != null -> PlexWait(error) { scope.launch { error = null; more() } }
        total == 0 -> Text(tr("Nothing here yet"), color = Muted, modifier = Modifier.padding(28.dp))
        else -> LazyVerticalGrid(columns = GridCells.Adaptive(108.dp), state = grid, contentPadding = PaddingValues(12.dp, 4.dp, 12.dp, 32.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.fillMaxSize()) {
            itemsIndexed(items, key = { i, it -> "$i:${it.key}" }) { _, it -> PlexPoster(it, pics) { pick(it) } }
        }
    }
}

/** Search as you type (after a short pause): movies, shows and episodes on every server picked. */
@Composable
private fun PlexSearch(model: AppModel, id: String, q: String, pics0: Map<String, PlexPics>, pick: (PlexItem) -> Unit) {
    var found by remember(q) { mutableStateOf<List<PlexItem>?>(null) }
    var pics by remember(q) { mutableStateOf(pics0) }
    var error by remember(q) { mutableStateOf<String?>(null) }
    LaunchedEffect(q) {
        delay(400)
        try { val r = model.plex(id, JSONObject().put("op", "search").put("q", q.trim())); pics = picsOf(r).ifEmpty { pics0 }; found = PlexItem.list(r.optJSONArray("items")) } catch (e: Exception) { error = err(e) }
    }
    val list = found ?: run { PlexWait(error) {}; return }
    if (list.isEmpty()) { Text(tr("No match for \"{x}\" on Plex.", "x" to q.trim()), color = Muted, modifier = Modifier.padding(28.dp)); return }
    LazyVerticalGrid(columns = GridCells.Adaptive(108.dp), contentPadding = PaddingValues(12.dp, 4.dp, 12.dp, 32.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        itemsIndexed(list, key = { i, it -> "$i:${it.key}" }) { _, it -> PlexPoster(it, pics) { pick(it) } }
    }
}

/** A movie or an episode: its summary and Play on the TV (Resume from where you stopped, or From the start). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PlexDetails(model: AppModel, id: String, m: PlexItem, pics: Map<String, PlexPics>, onDismiss: () -> Unit) {
    fun play(fromStart: Boolean) { model.plexPlay(id, m.server, m.key, fromStart); onDismiss() }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Panel) {
        Column(Modifier.padding(16.dp, 0.dp, 16.dp, 32.dp)) {
            Row {
                Box(Modifier.width(110.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp)).background(Panel2)) { PlexPic(pics, m.server, m.thumb, 240, 360, Modifier.fillMaxSize()) }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(m.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    if (m.sub.isNotBlank()) Text(m.sub, color = Muted, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 4.dp))
                    Spacer(Modifier.height(12.dp))
                    if (m.offset > 60_000) {
                        Button(onClick = { play(false) }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Rounded.PlayArrow, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(tr("Resume on TV")) }
                        Text(tr("From {x}", "x" to clock(m.offset)), color = Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 4.dp))
                        OutlinedButton(onClick = { play(true) }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) { Icon(Icons.Rounded.Replay, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(tr("From the start")) }
                    } else Button(onClick = { play(true) }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Rounded.PlayArrow, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(tr("Play on TV")) }
                }
            }
            if (m.summary.isNotBlank()) Text(m.summary, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 14.dp))
        }
    }
}
