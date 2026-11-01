/* Movies and Shows on the phone: the TV's own lists (its languages, hidden categories and PIN), as a
   poster grid that is quicker to browse with a thumb than with a remote.  Search, pick a category, open
   a title for its details, and play it on the TV: a movie from where it stopped or from the start, a show
   by season and episode.  Everything plays on the TV; nothing plays on the phone. */
package app.tivibro.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Replay
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.tivibro.phone.proto.Episode
import app.tivibro.phone.proto.TbException
import app.tivibro.phone.proto.VodCat
import app.tivibro.phone.proto.VodInfo
import app.tivibro.phone.proto.VodItem
import coil.compose.AsyncImage
import kotlinx.coroutines.delay

private fun err(e: Exception) = (e as? TbException)?.message ?: "The TV didn't answer.  Is it on, and on the same network?"

/** [kind] is "movie" or "series". */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VodTab(model: AppModel, id: String, kind: String) {
    val word = if (kind == "series") "shows" else "movies"
    var cats by remember(kind) { mutableStateOf<List<VodCat>?>(null) }
    var none by remember(kind) { mutableStateOf(false) }
    var error by remember(kind) { mutableStateOf<String?>(null) }
    var cat by rememberSaveable(kind) { mutableStateOf("") }
    var q by rememberSaveable(kind) { mutableStateOf("") }
    var picking by remember { mutableStateOf(false) }
    var open by remember { mutableStateOf<VodItem?>(null) }
    var attempt by remember { mutableIntStateOf(0) }

    LaunchedEffect(kind, attempt) {
        error = null
        try {
            val c = model.vodCats(id, kind)
            if (c == null) none = true
            else { cats = c; if (cat.isBlank() || c.none { it.id == cat }) cat = (c.firstOrNull { it.count > 0 && !it.locked } ?: c.firstOrNull())?.id ?: "_all" }
        } catch (e: Exception) { error = err(e) }
    }

    if (none) { Message("This playlist has no $word.  Movies and Shows come with Xtream Codes playlists that include them."); return }
    if (cats == null) {
        if (error != null) Column(Modifier.fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text(error!!, textAlign = TextAlign.Center); Spacer(Modifier.height(16.dp)); Button(onClick = { attempt++ }) { Text("Try again") }
        } else Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            CircularProgressIndicator(); Spacer(Modifier.height(16.dp)); Text("Getting the $word from the TV…", color = Muted)
        }
        return
    }

    // The titles: a page at a time, for the category or the search.
    val items = remember(kind, cat, q) { mutableStateListOf<VodItem>() }
    var total by remember(kind, cat, q) { mutableIntStateOf(-1) }
    var locked by remember(kind, cat, q) { mutableStateOf(false) }
    var loading by remember(kind, cat, q) { mutableStateOf(false) }
    val grid = rememberLazyGridState()
    suspend fun more() {
        if (loading || (total >= 0 && items.size >= total)) return
        loading = true
        try {
            val p = model.vodItems(id, kind, cat, q.trim(), items.size)
            items.addAll(p.items); total = p.total; locked = p.locked
        } catch (e: Exception) { error = err(e) } finally { loading = false }
    }
    LaunchedEffect(kind, cat, q) {
        if (q.isNotBlank()) delay(350)
        grid.scrollToItem(0)
        more()
    }
    LaunchedEffect(kind, cat, q, grid) {
        snapshotFlow { grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }.collect { last -> if (last > items.size - 24 && items.isNotEmpty()) more() }
    }

    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = q, onValueChange = { q = it }, singleLine = true,
            leadingIcon = { Icon(Icons.Rounded.Search, null) },
            trailingIcon = { if (q.isNotEmpty()) IconButton(onClick = { q = "" }) { Icon(Icons.Rounded.Close, "Clear") } },
            placeholder = { Text("Search $word") },
            shape = RoundedCornerShape(28.dp),
            colors = OutlinedTextFieldDefaults.colors(unfocusedContainerColor = Panel, focusedContainerColor = Panel, unfocusedBorderColor = Line),
            modifier = Modifier.fillMaxWidth().padding(16.dp, 12.dp, 16.dp, 4.dp),
        )
        if (q.isBlank()) {
            val c = cats!!.firstOrNull { it.id == cat }
            Row(Modifier.fillMaxWidth().clickable { picking = true }.padding(20.dp, 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(c?.name ?: "All", fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                Icon(Icons.Rounded.KeyboardArrowDown, "Pick a category", tint = Accent2)
                Spacer(Modifier.weight(1f))
                if (total >= 0) Text("$total", color = Muted, style = MaterialTheme.typography.labelMedium)
            }
        }
        when {
            locked -> Message("This category is locked.  Open it on the TV with the PIN.", Icons.Rounded.Lock)
            total == 0 -> Message(if (q.isNotBlank()) "No $word match \"${q.trim()}\"." else "Nothing here.")
            total < 0 && error != null -> Message(error!!)
            else -> LazyVerticalGrid(
                columns = GridCells.Adaptive(108.dp), state = grid,
                contentPadding = PaddingValues(12.dp, 4.dp, 12.dp, 32.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(14.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                itemsIndexed(items, key = { i, it -> "$i:${it.id}" }) { _, it -> Poster(it) { open = it } }
            }
        }
    }

    if (picking) CategorySheet(cats!!, cat, onPick = { cat = it; picking = false }, onDismiss = { picking = false })
    open?.let { item -> DetailsSheet(model, id, kind, item, onDismiss = { open = null }) }
}

@Composable
private fun Message(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector? = null) {
    Column(Modifier.fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        if (icon != null) { Icon(icon, null, tint = Muted, modifier = Modifier.size(36.dp)); Spacer(Modifier.height(12.dp)) }
        Text(text, color = Muted, textAlign = TextAlign.Center)
    }
}

@Composable
private fun Poster(it: VodItem, onClick: () -> Unit) {
    Column(Modifier.clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp)).background(Panel2), contentAlignment = Alignment.Center) {
            Text(it.name, color = Muted, style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.Center, maxLines = 4, modifier = Modifier.padding(8.dp))
            if (it.cover.isNotBlank()) AsyncImage(model = it.cover, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            if (it.progress > 0) LinearProgressIndicator(progress = { it.progress / 100f }, color = Accent2, trackColor = Panel2, modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(4.dp))
        }
        Spacer(Modifier.height(6.dp))
        Text(it.name, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
        val sub = listOf(it.year, it.rating.takeIf { r -> r.isNotBlank() }?.let { r -> "★ $r" }.orEmpty()).filter { s -> s.isNotBlank() }.joinToString("  ")
        if (sub.isNotBlank()) Text(sub, color = Muted, style = MaterialTheme.typography.labelSmall)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CategorySheet(cats: List<VodCat>, current: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    var f by remember { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Ink) {
        Column(Modifier.fillMaxHeight(0.85f)) {
            if (cats.size > 12) OutlinedTextField(
                value = f, onValueChange = { f = it }, singleLine = true, placeholder = { Text("Find a category") }, leadingIcon = { Icon(Icons.Rounded.Search, null) },
                shape = RoundedCornerShape(28.dp), modifier = Modifier.fillMaxWidth().padding(16.dp, 0.dp, 16.dp, 8.dp),
            )
            val shown = cats.filter { f.isBlank() || it.name.contains(f.trim(), ignoreCase = true) }
            LazyColumn(contentPadding = PaddingValues(bottom = 32.dp)) {
                items(shown, key = { it.id }) { c ->
                    Row(Modifier.fillMaxWidth().clickable { onPick(c.id) }.background(if (c.id == current) Panel else androidx.compose.ui.graphics.Color.Transparent).padding(20.dp, 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(c.name, color = if (c.id == current) Accent2 else TextHi, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        if (c.locked) Icon(Icons.Rounded.Lock, "Locked", tint = Muted, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(10.dp))
                        Text("${c.count}", color = Muted, style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
    }
}

private fun mins(sec: Int) = "${sec / 60} min"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DetailsSheet(model: AppModel, id: String, kind: String, item: VodItem, onDismiss: () -> Unit) {
    var info by remember { mutableStateOf<VodInfo?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var season by remember { mutableIntStateOf(-1) }
    LaunchedEffect(item.id) {
        try {
            val i = model.vodInfo(id, kind, item.id)
            info = i
            // Start on the season with the last episode watched.
            season = i.seasons.lastOrNull { s -> s.episodes.any { it.pos > 0 } }?.number ?: i.seasons.firstOrNull()?.number ?: -1
        } catch (e: Exception) { error = err(e) }
    }
    fun play(ep: Episode?, fromStart: Boolean) { model.vodPlay(id, kind, item.id, ep?.id, fromStart); onDismiss() }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Ink) {
        LazyColumn(Modifier.fillMaxHeight(0.92f), contentPadding = PaddingValues(bottom = 32.dp)) {
            item {
                Row(Modifier.padding(16.dp, 0.dp, 16.dp, 12.dp)) {
                    Box(Modifier.width(110.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp)).background(Panel2)) {
                        val cover = info?.cover?.ifBlank { null } ?: item.cover
                        if (cover.isNotBlank()) AsyncImage(model = cover, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    }
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(info?.name ?: item.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        val i = info
                        val meta = listOf(i?.year ?: item.year, i?.duration.orEmpty(), (i?.rating ?: item.rating).takeIf { it.isNotBlank() }?.let { "★ $it" }.orEmpty()).filter { it.isNotBlank() }.joinToString("  ·  ")
                        if (meta.isNotBlank()) Text(meta, color = Muted, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 4.dp))
                        if (!i?.genre.isNullOrBlank()) Text(i!!.genre, color = Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 2.dp))
                        if (!i?.media.isNullOrBlank()) Text(i!!.media, color = Accent2, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 2.dp))
                        if (kind == "movie" && i != null) {
                            Spacer(Modifier.height(12.dp))
                            if (i.pos > 0 && i.len > 0) {
                                Button(onClick = { play(null, false) }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Rounded.PlayArrow, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Resume on TV") }
                                Text("Stopped at ${mins(i.pos)} of ${mins(i.len)}", color = Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 4.dp))
                                OutlinedButton(onClick = { play(null, true) }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) { Icon(Icons.Rounded.Replay, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("From the start") }
                            } else Button(onClick = { play(null, true) }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Rounded.PlayArrow, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Play on TV") }
                        }
                    }
                }
            }
            val i = info
            when {
                error != null -> item { Text(error!!, color = Bad, modifier = Modifier.padding(16.dp)) }
                i == null -> item { Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
                else -> {
                    if (i.plot.isNotBlank()) item { Text(i.plot, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(16.dp, 0.dp, 16.dp, 8.dp)) }
                    if (i.cast.isNotBlank()) item { Text("Cast: " + i.cast, color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(16.dp, 0.dp, 16.dp, 12.dp)) }
                    if (kind == "series") {
                        if (i.seasons.isEmpty()) item { Text("No episodes yet.", color = Muted, modifier = Modifier.padding(16.dp)) }
                        if (i.seasons.size > 1) item {
                            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 6.dp)) {
                                items(i.seasons, key = { it.number }) { s -> GroupChip("Season ${s.number}", season == s.number) { season = s.number } }
                            }
                        }
                        val eps = i.seasons.firstOrNull { it.number == season }?.episodes ?: i.seasons.firstOrNull()?.episodes.orEmpty()
                        items(eps, key = { "e" + it.id }) { e -> EpisodeRow(e) { play(e, false) } }
                    }
                }
            }
        }
    }
}

@Composable
private fun EpisodeRow(e: Episode, onPlay: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClickLabel = "Play on the TV", onClick = onPlay).padding(16.dp, 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Surface(color = Panel2, shape = RoundedCornerShape(10.dp), modifier = Modifier.size(44.dp)) {
            Box(contentAlignment = Alignment.Center) { Text("${e.number}", fontWeight = FontWeight.SemiBold) }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(e.title.ifBlank { "Episode ${e.number}" }, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val sub = listOf(e.duration, if (e.pos > 0 && e.len > 0) "stopped at ${mins(e.pos)}" else "").filter { it.isNotBlank() }.joinToString("  ·  ")
            if (sub.isNotBlank()) Text(sub, color = Muted, style = MaterialTheme.typography.labelSmall)
            if (e.progress > 0) LinearProgressIndicator(progress = { e.progress / 100f }, color = Accent2, trackColor = Panel2, modifier = Modifier.padding(top = 4.dp).fillMaxWidth(0.6f).height(3.dp))
        }
        Icon(Icons.Rounded.PlayArrow, null, tint = Accent2)
    }
}
