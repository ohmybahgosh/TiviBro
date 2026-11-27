/* Plex on the phone (the tab, and the Plex shortcut on the home screen, show once the TV has a Plex server added),
   laid out as the TV's Plex tab so choosing what to watch on the phone looks like the TV: Home, Top 10 and each
   library picked on the TV, a library with the TV's views (Recommended, Library, Collections, Categories,
   Playlists), rows drawn as the TV draws them (wide pictures for Continue watching and episodes, "#3 on Netflix"
   under a Top 10's posters), and a title's page with what the TV's page has: the backdrop and title logo, the
   facts, badges and scores, the summary, Play or Resume on the TV, the trailer (on the TV from Plex, or on YouTube),
   Mark watched, then Cast and crew (a person's titles), Seasons or Episodes, Extras, the collection's other titles
   and More like this.  Everything plays on the TV; nothing plays on the phone.  The TV answers the lists
   (plexphone.js); pictures come straight from the Plex server, its token in a header, never in an address. */
package app.tivibro.phone.ui

import app.tivibro.phone.tr

import android.content.Intent
import android.net.Uri
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
import androidx.compose.foundation.lazy.itemsIndexed as rowItemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Replay
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.tivibro.phone.proto.TbException
import coil.compose.AsyncImage
import coil.request.ImageRequest
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

/** A Plex title as the TV sends it (plexphone.js slim()). */
data class PlexItem(val server: String, val key: String, val type: String, val title: String, val sub: String, val thumb: String,
                    val offset: Long, val duration: Long, val watched: Boolean, val left: Int, val summary: String,
                    val wide: String = "", val art: String = "") {
    val plays get() = type == "movie" || type == "episode"
    /** Opens a page of its own on the TV (a movie, an episode, a show or a season). */
    val hasPage get() = plays || type == "show" || type == "season"
    companion object {
        fun from(j: JSONObject) = PlexItem(j.optString("server"), j.optString("key"), j.optString("type"), j.optString("title"), j.optString("sub"),
            j.optString("thumb"), j.optLong("offset"), j.optLong("duration"), j.optInt("watched") == 1, j.optInt("left"), j.optString("summary"),
            j.optString("wide"), j.optString("art"))
        fun list(a: JSONArray?) = (0 until (a?.length() ?: 0)).map { from(a!!.getJSONObject(it)) }
    }
}
/** Someone in a title's Cast and crew: their picture, their part, and how their titles are asked for. */
data class PlexPerson(val tag: String, val role: String, val thumb: String, val id: String, val field: String, val sec: String) {
    companion object {
        fun list(a: JSONArray?) = (0 until (a?.length() ?: 0)).map { i -> a!!.getJSONObject(i).let { PlexPerson(it.optString("tag"), it.optString("role"), it.optString("thumb"), it.optString("id"), it.optString("field"), it.optString("sec")) } }
    }
}
/** A row as the TV draws it: wide pictures or posters (or people), a genre still to read (Categories). */
data class PlexRow(val title: String, val wide: Boolean, val kind: String, val genre: String, val items: List<PlexItem>, val people: List<PlexPerson>) {
    companion object {
        fun list(a: JSONArray?) = (0 until (a?.length() ?: 0)).map { i -> a!!.getJSONObject(i).let {
            PlexRow(it.optString("title"), it.optBoolean("wide"), it.optString("kind"), it.optString("genre"), PlexItem.list(it.optJSONArray("items")), PlexPerson.list(it.optJSONArray("people")))
        } }
    }
}
/** Where a server's pictures come from: its address and its own token (sent as a header). */
data class PlexPics(val base: String, val token: String)
/** The servers' picture details the phone has been told, kept for the whole app: Now on the TV draws a Plex
 *  title's poster with them too.  Filled by the Plex tab and by AppModel.plexPicsFor. */
object PlexPicsCache { var pics by mutableStateOf<Map<String, PlexPics>>(emptyMap()) }
private data class PlexLib(val server: String, val key: String, val title: String)
private data class PlexViewName(val id: String, val title: String)
/** What a screen of the tab shows: the top of a pick (Home, Top 10, a library's view), or one opened from it. */
private data class PlexScreen(val kind: String, val lib: PlexLib? = null, val view: String = "", val parent: PlexItem? = null, val person: PlexPerson? = null, val server: String = "")

internal fun picsOf(j: JSONObject): Map<String, PlexPics> {
    val p = j.optJSONObject("pics") ?: return emptyMap()
    return p.keys().asSequence().associateWith { k -> p.getJSONObject(k).let { PlexPics(it.optString("base"), it.optString("token")) } }
}
private fun err(e: Exception) = (e as? TbException)?.message ?: tr("The TV didn't answer.  Is it on, and on the same network?")
private fun clock(ms: Long): String { val s = ms / 1000; val h = s / 3600; val m = s % 3600 / 60; return if (h > 0) "$h:%02d:%02d".format(m, s % 60) else "$m:%02d".format(s % 60) }

@Composable
fun PlexTab(model: AppModel, id: String) {
    var libs by remember { mutableStateOf<List<PlexLib>?>(null) }
    var views by remember { mutableStateOf<List<PlexViewName>>(emptyList()) }
    var hasTop by remember { mutableStateOf(false) }
    var pics by remember { mutableStateOf<Map<String, PlexPics>>(emptyMap()) }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    val stack = remember { mutableStateListOf(PlexScreen("home")) }
    // The view picked last in each library (as the TV keeps it), Recommended the first time.
    val viewOf = remember { mutableStateMapOf<String, String>() }
    var q by remember { mutableStateOf("") }
    LaunchedEffect(attempt) {
        error = null
        try {
            val r = model.plex(id, JSONObject().put("op", "libs"))
            pics = picsOf(r)
            PlexPicsCache.pics = PlexPicsCache.pics + pics
            hasTop = r.optBoolean("top")
            views = (0 until (r.optJSONArray("views")?.length() ?: 0)).map { i -> r.getJSONArray("views").getJSONObject(i).let { PlexViewName(it.optString("id"), it.optString("title")) } }
                .ifEmpty { listOf(PlexViewName("library", tr("Library"))) }  // an older TV knows only the library
            libs = (0 until (r.optJSONArray("libs")?.length() ?: 0)).map { i -> r.getJSONArray("libs").getJSONObject(i).let { PlexLib(it.optString("server"), it.optString("key"), it.optString("title")) } }
        } catch (e: Exception) { error = err(e) }
    }
    if (libs == null) { PlexWait(error) { attempt++ }; return }
    BackHandler(stack.size > 1) { stack.removeAt(stack.lastIndex) }
    val screen = stack.last()
    // A title opens its page; a collection or a playlist its titles; a trailer or another extra plays on the TV.
    val pick: (PlexItem) -> Unit = {
        when {
            it.hasPage -> stack.add(PlexScreen("details", parent = it))
            it.type == "clip" -> model.plexDo(id, JSONObject().put("op", "extra").put("server", it.server).put("key", it.key), tr("Playing {x} on the TV", "x" to it.title))
            else -> stack.add(PlexScreen("children", parent = it))
        }
    }
    val pickPerson: (PlexPerson, String) -> Unit = { p, server -> stack.add(PlexScreen("person", person = p, server = server)) }
    if (screen.kind == "details") { PlexDetails(model, id, screen.parent!!, pics, pick, pickPerson) { stack.removeAt(stack.lastIndex) }; return }
    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = q, onValueChange = { q = it }, singleLine = true, leadingIcon = { Icon(Icons.Rounded.Search, null) },
            trailingIcon = { if (q.isNotEmpty()) IconButton(onClick = { q = "" }) { Icon(Icons.Rounded.Close, tr("Clear")) } },
            placeholder = { Text(tr("Search Plex")) }, shape = RoundedCornerShape(28.dp),
            colors = OutlinedTextFieldDefaults.colors(unfocusedContainerColor = Panel, focusedContainerColor = Panel, unfocusedBorderColor = Line),
            modifier = Modifier.fillMaxWidth().padding(16.dp, 12.dp, 16.dp, 4.dp),
        )
        val top = stack.first()
        if (q.isBlank() && stack.size == 1) {
            // The TV's tabs: Home, Top 10, each library.
            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item { GroupChip(tr("Home"), top.kind == "home") { stack.clear(); stack.add(PlexScreen("home")) } }
                if (hasTop) item { GroupChip(tr("Top 10"), top.kind == "top") { stack.clear(); stack.add(PlexScreen("top")) } }
                items(libs!!, key = { it.server + ":" + it.key }) { l ->
                    GroupChip(l.title, top.lib == l) { stack.clear(); stack.add(PlexScreen("lib", lib = l, view = viewOf[l.server + ":" + l.key] ?: views.firstOrNull()?.id ?: "library")) }
                }
            }
            // A library's views, as the TV's second row of words.
            if (top.kind == "lib") LazyRow(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                items(views, key = { it.id }) { v ->
                    val on = v.id == top.view
                    Text(v.title.uppercase(), style = MaterialTheme.typography.labelMedium, fontWeight = if (on) FontWeight.Bold else FontWeight.Medium,
                        color = if (on) TextHi else Muted, modifier = Modifier.clickable {
                            viewOf[top.lib!!.server + ":" + top.lib.key] = v.id
                            stack.clear(); stack.add(top.copy(view = v.id))
                        }.padding(vertical = 8.dp))
                }
            }
        }
        if (stack.size > 1 && q.isBlank()) Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(8.dp, 4.dp, 20.dp, 4.dp)) {
            IconButton(onClick = { stack.removeAt(stack.lastIndex) }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, tr("Back")) }
            Text(screen.parent?.title ?: screen.person?.tag.orEmpty(), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        when {
            q.isNotBlank() -> PlexSearch(model, id, q, pics, pick)
            screen.kind == "home" -> PlexRows(model, id, JSONObject().put("op", "home"), pics, pick)
            screen.kind == "top" -> PlexRows(model, id, JSONObject().put("op", "top"), pics, pick, empty = tr("None of today's streaming Top 10s are in your Plex libraries."))
            screen.kind == "lib" -> {
                val l = screen.lib!!
                val ask = JSONObject().put("server", l.server).put("key", l.key)
                when (screen.view) {
                    "library" -> PlexGrid(model, id, ask.put("op", "lib"), pics, pick)
                    "collections", "playlists" -> PlexGrid(model, id, ask.put("op", "view").put("view", screen.view), pics, pick)
                    else -> PlexRows(model, id, ask.put("op", "view").put("view", screen.view), pics, pick, lib = l)
                }
            }
            screen.kind == "person" -> PlexGrid(model, id, JSONObject().put("op", "children").put("type", "filter").put("server", screen.server)
                .put("sec", screen.person!!.sec).put("field", screen.person.field).put("id", screen.person.id).put("title", screen.person.tag), pics, pick)
            else -> PlexGrid(model, id, JSONObject().put("op", "children").put("server", screen.parent!!.server).put("key", screen.parent.key).put("type", screen.parent.type), pics, pick)
        }
    }
}

@Composable
private fun PlexWait(error: String?, retry: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        if (error != null) { Text(error, textAlign = TextAlign.Center); Spacer(Modifier.height(16.dp)); Button(onClick = retry) { Text(tr("Try again")) } }
        else { CircularProgressIndicator(); Spacer(Modifier.height(16.dp)); Text(tr("Getting Plex from the TV…"), color = Muted) }
    }
}

/** A picture from the Plex server, sized by the server, with the server's token in a header.  [path] can be the
 *  server's own (a poster) or a whole address (a person's photo): the server's transcoder takes both. */
@Composable
fun PlexPic(pics: Map<String, PlexPics>, server: String, path: String, w: Int, h: Int, modifier: Modifier = Modifier) {
    val p = pics[server] ?: return
    if (path.isBlank()) return
    val url = p.base.trimEnd('/') + "/photo/:/transcode?width=$w&height=$h&minSize=1&upscale=1&url=" + URLEncoder.encode(path, "UTF-8")
    val req = ImageRequest.Builder(LocalContext.current).data(url).addHeader("X-Plex-Token", p.token).crossfade(true).build()
    AsyncImage(model = req, contentDescription = null, contentScale = ContentScale.Crop, modifier = modifier)
}
/** A file the server keeps as it is (a title logo, a PNG with a clear background), drawn to fit. */
@Composable
private fun PlexFile(pics: Map<String, PlexPics>, server: String, path: String, modifier: Modifier = Modifier, onFail: () -> Unit) {
    val p = pics[server]
    if (p == null) { LaunchedEffect(server) { onFail() }; return }
    val req = ImageRequest.Builder(LocalContext.current).data(p.base.trimEnd('/') + path).addHeader("X-Plex-Token", p.token).crossfade(true).build()
    AsyncImage(model = req, contentDescription = null, contentScale = ContentScale.Fit, alignment = Alignment.CenterStart, modifier = modifier, onError = { onFail() })
}

@Composable
private fun PlexPoster(it: PlexItem, pics: Map<String, PlexPics>, onClick: () -> Unit) {
    Column(Modifier.clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp)).background(Panel2), contentAlignment = Alignment.Center) {
            Text(it.title, color = Muted, style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.Center, maxLines = 4, modifier = Modifier.padding(8.dp))
            PlexPic(pics, it.server, it.thumb, 240, 360, Modifier.fillMaxSize())
            if (it.left > 0) Surface(color = Accent, shape = RoundedCornerShape(bottomStart = 10.dp), modifier = Modifier.align(Alignment.TopEnd)) { Text("${it.left}", style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(6.dp, 2.dp)) }
            if (it.watched) Surface(color = Good, shape = RoundedCornerShape(bottomStart = 10.dp), modifier = Modifier.align(Alignment.TopEnd)) { Icon(Icons.Rounded.Check, tr("Watched"), tint = Ink, modifier = Modifier.padding(3.dp).size(14.dp)) }
            if (it.offset > 0 && it.duration > 0) LinearProgressIndicator(progress = { (it.offset.toFloat() / it.duration).coerceIn(0f, 1f) }, color = Accent, trackColor = Panel2, modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(4.dp))
        }
        Spacer(Modifier.height(6.dp))
        Text(it.title, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (it.sub.isNotBlank()) Text(it.sub, color = Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A wide picture (16:9), as the TV draws Continue watching, episodes and extras: the episode's own picture, else
 *  the backdrop, else the poster. */
@Composable
private fun PlexWide(it: PlexItem, pics: Map<String, PlexPics>, onClick: () -> Unit) {
    Column(Modifier.clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(12.dp)).background(Panel2), contentAlignment = Alignment.Center) {
            Text(it.title, color = Muted, style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.Center, maxLines = 3, modifier = Modifier.padding(8.dp))
            PlexPic(pics, it.server, it.wide.ifBlank { it.art.ifBlank { it.thumb } }, 400, 225, Modifier.fillMaxSize())
            if (it.type == "clip") Icon(Icons.Rounded.PlayArrow, null, tint = TextHi, modifier = Modifier.size(36.dp).background(Color(0x99000000), CircleShape).padding(6.dp))
            if (it.watched) Surface(color = Good, shape = RoundedCornerShape(bottomStart = 10.dp), modifier = Modifier.align(Alignment.TopEnd)) { Icon(Icons.Rounded.Check, tr("Watched"), tint = Ink, modifier = Modifier.padding(3.dp).size(14.dp)) }
            if (it.offset > 0 && it.duration > 0) LinearProgressIndicator(progress = { (it.offset.toFloat() / it.duration).coerceIn(0f, 1f) }, color = Accent, trackColor = Panel2, modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(4.dp))
        }
        Spacer(Modifier.height(6.dp))
        Text(it.title, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (it.sub.isNotBlank()) Text(it.sub, color = Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** One row: its title, then a strip of wide pictures, posters or people. */
@Composable
private fun PlexStrip(r: PlexRow, pics: Map<String, PlexPics>, server: String, pick: (PlexItem) -> Unit, pickPerson: ((PlexPerson, String) -> Unit)? = null) {
    Text(r.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(20.dp, 14.dp, 20.dp, 8.dp))
    if (r.kind == "person") {
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(r.people, key = { it.field + it.id + it.tag }) { p ->
                Column(Modifier.width(84.dp).clickable(enabled = pickPerson != null && p.id.isNotBlank() && p.sec.isNotBlank()) { pickPerson?.invoke(p, server) }, horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(72.dp).clip(CircleShape).background(Panel2), contentAlignment = Alignment.Center) {
                        Text(p.tag.take(1), color = Muted, style = MaterialTheme.typography.titleMedium)
                        PlexPic(pics, server, p.thumb, 160, 160, Modifier.fillMaxSize())
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(p.tag, style = MaterialTheme.typography.labelMedium, maxLines = 2, textAlign = TextAlign.Center, overflow = TextOverflow.Ellipsis)
                    if (p.role.isNotBlank()) Text(p.role, color = Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1, textAlign = TextAlign.Center, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        return
    }
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        rowItemsIndexed(r.items, key = { i, it -> "$i:${it.server}:${it.key}" }) { _, m ->
            if (r.wide) Box(Modifier.width(208.dp)) { PlexWide(m, pics) { pick(m) } }
            else Box(Modifier.width(112.dp)) { PlexPoster(m, pics) { pick(m) } }
        }
    }
}

/** Rows: Home, Top 10, a library's Recommended or Categories (a category's titles read once its row is shown). */
@Composable
private fun PlexRows(model: AppModel, id: String, ask: JSONObject, pics0: Map<String, PlexPics>, pick: (PlexItem) -> Unit, empty: String = "", lib: PlexLib? = null) {
    val k = ask.toString()
    var rows by remember(k) { mutableStateOf<List<PlexRow>?>(null) }
    var pics by remember(k) { mutableStateOf(pics0) }
    var error by remember(k) { mutableStateOf<String?>(null) }
    var attempt by remember(k) { mutableIntStateOf(0) }
    LaunchedEffect(k, attempt) {
        error = null
        try { val r = model.plex(id, JSONObject(k)); pics = picsOf(r).ifEmpty { pics0 }; rows = PlexRow.list(r.optJSONArray("rows")) } catch (e: Exception) { error = err(e) }
    }
    val list = rows ?: run { PlexWait(error) { attempt++ }; return }
    if (list.isEmpty()) { Text(empty.ifBlank { tr("Nothing here yet") }, color = Muted, modifier = Modifier.padding(28.dp)); return }
    LazyColumn(contentPadding = PaddingValues(bottom = 32.dp)) {
        items(list, key = { it.title + it.genre }) { r ->
            if (r.genre.isNotBlank() && r.items.isEmpty() && lib != null) PlexGenreRow(model, id, lib, r, pics, pick)
            else PlexStrip(r, pics, lib?.server.orEmpty(), pick)
        }
    }
}

/** A category's row: its titles read from the TV when the row comes into view, as the TV does. */
@Composable
private fun PlexGenreRow(model: AppModel, id: String, lib: PlexLib, r: PlexRow, pics0: Map<String, PlexPics>, pick: (PlexItem) -> Unit) {
    var items by remember(lib, r.genre) { mutableStateOf<List<PlexItem>?>(null) }
    var pics by remember(lib, r.genre) { mutableStateOf(pics0) }
    LaunchedEffect(lib, r.genre) {
        try {
            val j = model.plex(id, JSONObject().put("op", "genre").put("server", lib.server).put("key", lib.key).put("genre", r.genre))
            pics = picsOf(j).ifEmpty { pics0 }; items = PlexItem.list(j.optJSONArray("items"))
        } catch (e: Exception) { items = emptyList() }
    }
    val got = items
    if (got == null) {
        Text(r.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(20.dp, 14.dp, 20.dp, 8.dp))
        Box(Modifier.fillMaxWidth().height(60.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp) }
    } else if (got.isNotEmpty()) PlexStrip(r.copy(items = got), pics, lib.server, pick)
}

/** A grid of titles: a library a page at a time, a library's collections or playlists, a show's seasons, a
 *  season's episodes, a collection, a person's titles. */
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
    // Episodes as the TV shows them: wide pictures, two to a row.
    val wide = items.firstOrNull()?.type == "episode" || items.firstOrNull()?.type == "clip"
    when {
        total < 0 && error != null -> PlexWait(error) { scope.launch { error = null; more() } }
        total < 0 -> PlexWait(null) {}
        total == 0 -> Text(tr("Nothing here yet"), color = Muted, modifier = Modifier.padding(28.dp))
        else -> LazyVerticalGrid(columns = GridCells.Adaptive(if (wide) 168.dp else 108.dp), state = grid, contentPadding = PaddingValues(12.dp, 4.dp, 12.dp, 32.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.fillMaxSize()) {
            itemsIndexed(items, key = { i, it -> "$i:${it.key}" }) { _, it -> if (wide) PlexWide(it, pics) { pick(it) } else PlexPoster(it, pics) { pick(it) } }
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

/** What the TV's page says about a title (plexphone.js details): the words it shows and what its buttons do. */
private data class PlexInfo(val kicker: String, val facts: String, val badges: List<String>, val scores: List<String>, val tagline: String, val people: String,
                            val trailer: String, val youtube: String, val next: String, val allSeen: Boolean, val logo: String) {
    companion object {
        private fun strings(a: JSONArray?) = (0 until (a?.length() ?: 0)).map { a!!.optString(it) }.filter { it.isNotBlank() }
        fun from(j: JSONObject?) = PlexInfo(j?.optString("kicker").orEmpty(), j?.optString("facts").orEmpty(), strings(j?.optJSONArray("badges")), strings(j?.optJSONArray("scores")),
            j?.optString("tagline").orEmpty(), j?.optString("people").orEmpty(), j?.optString("trailer").orEmpty(), j?.optString("youtube").orEmpty(),
            j?.optString("next").orEmpty(), j?.optBoolean("allSeen") == true, j?.optString("logo").orEmpty())
    }
}

/** A title's page, as on the TV: the backdrop with the title logo, the facts, badges and scores, Play or Resume on
 *  the TV, the trailer, Mark watched, the summary, then its rows. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PlexDetails(model: AppModel, id: String, m0: PlexItem, pics0: Map<String, PlexPics>, pick: (PlexItem) -> Unit, pickPerson: (PlexPerson, String) -> Unit, onBack: () -> Unit) {
    var m by remember(m0) { mutableStateOf(m0) }
    var info by remember(m0) { mutableStateOf<PlexInfo?>(null) }
    var rows by remember(m0) { mutableStateOf<List<PlexRow>>(emptyList()) }
    var pics by remember(m0) { mutableStateOf(pics0) }
    var error by remember(m0) { mutableStateOf<String?>(null) }
    var attempt by remember(m0) { mutableIntStateOf(0) }
    var logoFailed by remember(m0) { mutableStateOf(false) }
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    LaunchedEffect(m0, attempt) {
        error = null
        try {
            val r = model.plex(id, JSONObject().put("op", "details").put("server", m0.server).put("key", m0.key))
            pics = picsOf(r).ifEmpty { pics0 }
            r.optJSONObject("item")?.let { m = PlexItem.from(it) }
            info = PlexInfo.from(r.optJSONObject("info")); rows = PlexRow.list(r.optJSONArray("rows"))
        } catch (e: Exception) { error = err(e) }
    }
    fun play(fromStart: Boolean) = model.plexPlay(id, m.server, m.key, fromStart)
    fun mark(on: Boolean) = scope.launch {
        try {
            model.plex(id, JSONObject().put("op", "watched").put("server", m.server).put("key", m.key).put("on", on))
            model.say(if (on) tr("Marked as watched") else tr("Marked as not watched")); attempt++
        } catch (e: Exception) { model.say(err(e)) }
    }
    Column(Modifier.fillMaxSize()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(8.dp, 4.dp)) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, tr("Back")) }
            Text(info?.kicker.orEmpty(), color = Muted, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        LazyColumn(contentPadding = PaddingValues(bottom = 40.dp)) {
            item {
                // The backdrop, faded into the page below it.
                Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Panel2)) {
                    PlexPic(pics, m.server, m.art.ifBlank { m.wide.ifBlank { m.thumb } }, 960, 540, Modifier.fillMaxSize())
                    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Ink), startY = 260f)))
                }
            }
            item {
                Column(Modifier.padding(20.dp, 0.dp, 20.dp, 0.dp)) {
                    val logo = info?.logo.orEmpty()
                    if (logo.isNotBlank() && !logoFailed && m.type != "episode" && m.type != "season")
                        PlexFile(pics, m.server, logo, Modifier.fillMaxWidth(0.7f).height(72.dp)) { logoFailed = true }
                    else Text(m.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    val facts = info?.facts.orEmpty().ifBlank { m.sub }
                    if (m.type == "episode") Text(m.sub, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 4.dp))
                    if (facts.isNotBlank() && m.type != "episode") Text(facts, color = Muted, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 6.dp))
                    val chips = info?.badges.orEmpty() + info?.scores.orEmpty()
                    if (chips.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 10.dp)) {
                        chips.forEach { b -> Surface(color = Panel, shape = RoundedCornerShape(6.dp), border = androidx.compose.foundation.BorderStroke(1.dp, Line)) { Text(b, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(8.dp, 3.dp)) } }
                    }
                    Spacer(Modifier.height(14.dp))
                    when {
                        info == null && error != null -> { Text(error!!, color = Muted); TextButton(onClick = { attempt++ }) { Text(tr("Try again")) } }
                        info == null -> LinearProgressIndicator(Modifier.fillMaxWidth(), color = Accent, trackColor = Panel2)
                        m.type == "show" || m.type == "season" -> {
                            Button(onClick = { model.plexDo(id, JSONObject().put("op", "next").put("server", m.server).put("key", m.key), tr("Playing on the TV")) }, modifier = Modifier.fillMaxWidth()) {
                                Icon(Icons.Rounded.PlayArrow, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(info!!.next.ifBlank { tr("Play") } + "  " + tr("on TV"))
                            }
                            OutlinedButton(onClick = { mark(!info!!.allSeen) }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) { Text(if (info!!.allSeen) tr("Mark not watched") else tr("Mark watched")) }
                        }
                        else -> {
                            if (m.offset > 60_000) {
                                Button(onClick = { play(false) }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Rounded.PlayArrow, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(tr("Resume from {x}", "x" to clock(m.offset)) + "  " + tr("on TV")) }
                                OutlinedButton(onClick = { play(true) }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) { Icon(Icons.Rounded.Replay, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(tr("Play from the start")) }
                            } else Button(onClick = { play(true) }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Rounded.PlayArrow, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(tr("Play on TV")) }
                            OutlinedButton(onClick = { mark(!m.watched) }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) { Text(if (m.watched) tr("Mark not watched") else tr("Mark watched")) }
                        }
                    }
                    // The trailer: Plex's own on the TV, and YouTube's on the phone (or both).
                    val i = info
                    if (i != null && (i.trailer.isNotBlank() || i.youtube.isNotBlank())) Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) {
                        if (i.trailer.isNotBlank()) OutlinedButton(onClick = { model.plexDo(id, JSONObject().put("op", "extra").put("server", m.server).put("key", i.trailer), tr("Playing the trailer on the TV")) }, modifier = Modifier.weight(1f)) {
                            Icon(Icons.Rounded.Movie, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(tr("Trailer on TV"), maxLines = 1)
                        }
                        if (i.youtube.isNotBlank()) OutlinedButton(onClick = {
                            try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/watch?v=" + i.youtube))) } catch (e: Exception) { model.say(tr("No app on this phone opens YouTube links")) }
                        }, modifier = Modifier.weight(1f)) { Icon(Icons.AutoMirrored.Rounded.OpenInNew, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(tr("Trailer on YouTube"), maxLines = 1) }
                    }
                    if (i?.tagline.orEmpty().isNotBlank()) Text(i!!.tagline, fontStyle = FontStyle.Italic, color = Muted, modifier = Modifier.padding(top = 14.dp))
                    val summary = m.summary
                    if (summary.isNotBlank()) Text(summary, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 10.dp))
                    if (i?.people.orEmpty().isNotBlank()) Text(i!!.people, color = Muted, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 10.dp))
                }
            }
            items(rows, key = { it.title + it.kind }) { r -> PlexStrip(r, pics, m.server, pick, pickPerson) }
        }
    }
}
