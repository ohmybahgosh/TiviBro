/* One TV: what it is showing now (followed with a long poll), typing on the phone into any text box the
   TV is showing, a remote (arrows, OK, Back, channel and volume buttons, menu actions), the TV's own
   channel list to play a channel on the TV and star favorites, the guide (GuideTab.kt), and Movies and
   Shows (VodTab.kt). */
package app.tivibro.phone.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.VolumeOff
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DateRange
import androidx.compose.material.icons.rounded.FastForward
import androidx.compose.material.icons.rounded.FastRewind
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Keyboard
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.KeyboardArrowUp
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material.icons.rounded.StarOutline
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import app.tivibro.phone.proto.TvInput
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.tivibro.phone.proto.Chan
import app.tivibro.phone.proto.Lineup
import app.tivibro.phone.proto.NowState
import app.tivibro.phone.proto.Prog
import app.tivibro.phone.proto.Volume
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import java.text.DateFormat
import java.util.Date

/** One TV: what it is playing, a remote, and its channels to play on the TV. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TvScreen(
    model: AppModel,
    id: String,
    name: String,
    state: NowState?,
    lineup: Lineup?,
    lineupNote: String,
    volume: Volume?,
    snack: SnackbarHostState,
    onBack: () -> Unit,
    onKey: (String) -> Unit,
    onAction: (String) -> Unit,
    onText: (String) -> Unit,
    onVolume: (String) -> Unit,
    onPlay: (Chan) -> Unit,
    onOpen: () -> Unit,
    onLoadLineup: (Boolean) -> Unit,
    onFav: (Chan, Boolean) -> Unit,
    onType: (TvInput, String, Boolean) -> Unit,
) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var typing by remember { mutableStateOf(false) }
    // The clock, for programme progress: once every 20 seconds is plenty.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(20_000); now = System.currentTimeMillis() } }
    LaunchedEffect(tab) { if (tab == 1 || tab == 2) onLoadLineup(false) }

    Scaffold(
        containerColor = Ink,
        snackbarHost = { SnackbarHost(snack) },
        topBar = {
            TopAppBar(
                title = { Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Ink),
            )
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            NowPlaying(state, now, onKey, onOpen, Modifier.padding(16.dp, 4.dp, 16.dp, 8.dp))
            val inputs = state?.inputs.orEmpty()
            if (inputs.isNotEmpty()) TypeOnTv(inputs, onType, Modifier.padding(16.dp, 0.dp, 16.dp, 8.dp))
            ScrollableTabRow(
                selectedTabIndex = tab, containerColor = Ink, contentColor = TextHi, edgePadding = 8.dp,
                indicator = { pos -> TabRowDefaults.SecondaryIndicator(Modifier.tabIndicatorOffset(pos[tab]), color = Accent2) },
                divider = {},
            ) {
                listOf("Remote", "Channels", "Guide", "Movies", "Shows").forEachIndexed { i, t -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(t) }) }
            }
            when (tab) {
                0 -> Remote(volume, onKey, onAction, onVolume, onType = { typing = true })
                1 -> Channels(lineup, lineupNote, state?.channelKey.orEmpty(), now, onPlay, onOpen = { onOpen(); onLoadLineup(true) }, onRetry = { onLoadLineup(true) }, onFav = onFav)
                2 -> GuideTab(model, id, lineup, lineupNote, state?.channelKey.orEmpty(), now, onPlay, onOpen = { onOpen(); onLoadLineup(true) }, onRetry = { onLoadLineup(true) })
                3 -> VodTab(model, id, "movie")
                else -> VodTab(model, id, "series")
            }
        }
    }
    if (typing) TypeDialog(onDismiss = { typing = false }, onSend = { typing = false; onText(it) })
}

private fun clock(t: Long): String = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(t))

@Composable
private fun NowPlaying(st: NowState?, now: Long, onKey: (String) -> Unit, onOpen: () -> Unit, modifier: Modifier) {
    Surface(color = Panel, shape = MaterialTheme.shapes.medium, modifier = modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            when {
                st == null -> {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp); Spacer(Modifier.width(12.dp))
                    Text("Connecting to the TV…", color = Muted)
                }
                !st.open -> {
                    Column(Modifier.weight(1f)) {
                        Text("TiviBro is closed on the TV", fontWeight = FontWeight.SemiBold)
                        Text("Any button opens it.", color = Muted, style = MaterialTheme.typography.bodySmall)
                    }
                    Button(onClick = onOpen) { Text("Open TiviBro") }
                }
                st.vodTitle.isNotBlank() -> {
                    Column(Modifier.weight(1f)) {
                        Text(st.vodTitle, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (st.vodDur > 0) {
                            Spacer(Modifier.height(8.dp))
                            LinearProgressIndicator(progress = { (st.vodPos.toFloat() / st.vodDur).coerceIn(0f, 1f) }, color = Accent2, trackColor = Panel2, modifier = Modifier.fillMaxWidth())
                        }
                    }
                    PlayPause(st.paused, onKey)
                }
                st.channel.isNotBlank() -> {
                    Logo(st.logo, st.number, 48.dp)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text((if (st.number.isNotBlank()) st.number + "  " else "") + st.channel, color = Muted, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(st.now?.title ?: "No guide information", fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        val p = st.now
                        if (p != null && p.end > p.start) {
                            Spacer(Modifier.height(6.dp))
                            LinearProgressIndicator(progress = { ((now - p.start).toFloat() / (p.end - p.start)).coerceIn(0f, 1f) }, color = Accent2, trackColor = Panel2, modifier = Modifier.fillMaxWidth())
                            Text(clock(p.start) + " – " + clock(p.end) + (st.next?.let { "   Next: " + it.title } ?: ""), color = Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    PlayPause(st.paused, onKey)
                }
                else -> Text(when (st.tab) { "guide" -> "TiviBro: the guide"; "search" -> "TiviBro: search"; "settings" -> "TiviBro: settings"; "movies" -> "TiviBro: movies"; "shows" -> "TiviBro: shows"; else -> "TiviBro is open" }, color = Muted)
            }
        }
    }
}

@Composable
private fun PlayPause(paused: Boolean, onKey: (String) -> Unit) {
    IconButton(onClick = { onKey("playpause") }) { Icon(if (paused) Icons.Rounded.PlayArrow else Icons.Rounded.Pause, if (paused) "Play" else "Pause", tint = TextHi) }
}

@Composable
fun Logo(url: String, number: String, size: Dp) {
    Box(Modifier.size(size).clip(RoundedCornerShape(10.dp)).background(Panel2), contentAlignment = Alignment.Center) {
        if (number.isNotBlank()) Text(number, color = Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1)
        if (url.isNotBlank()) AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize().padding(4.dp))
    }
}

/* ---------- the remote ---------- */

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Key(icon: ImageVector?, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, size: Dp = 56.dp, color: Color = Panel2, tint: Color = TextHi, onLong: (() -> Unit)? = null, text: String? = null) {
    val haptic = LocalHapticFeedback.current
    Box(
        modifier.size(size).clip(CircleShape).background(color)
            .combinedClickable(onClickLabel = label, onClick = { haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove); onClick() },
                onLongClick = onLong?.let { l -> { haptic.performHapticFeedback(HapticFeedbackType.LongPress); l() } }),
        contentAlignment = Alignment.Center,
    ) {
        if (icon != null) Icon(icon, label, tint = tint, modifier = Modifier.size(size * 0.46f))
        else Text(text ?: label, color = tint, fontWeight = FontWeight.Bold, fontSize = 15.sp)
    }
}

@Composable
private fun Remote(volume: Volume?, onKey: (String) -> Unit, onAction: (String) -> Unit, onVolume: (String) -> Unit, onType: () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp, 16.dp, 20.dp, 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Key(Icons.AutoMirrored.Rounded.ArrowBack, "Back", { onKey("back") })
            Key(Icons.Rounded.Home, "Channels", { onAction("live") })
            Key(Icons.Rounded.DateRange, "Guide", { onAction("guide") })
            Key(Icons.Rounded.Keyboard, "Type a search", onType)
        }
        Spacer(Modifier.height(26.dp))
        // The pad: arrows round OK.  Hold OK for options, as on the remote.
        Box(Modifier.size(248.dp).clip(CircleShape).background(Panel).border(1.dp, Line, CircleShape)) {
            Key(Icons.Rounded.KeyboardArrowUp, "Up", { onKey("up") }, Modifier.align(Alignment.TopCenter).padding(top = 8.dp), color = Color.Transparent)
            Key(Icons.Rounded.KeyboardArrowDown, "Down", { onKey("down") }, Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp), color = Color.Transparent)
            Key(Icons.Rounded.KeyboardArrowLeft, "Left", { onKey("left") }, Modifier.align(Alignment.CenterStart).padding(start = 8.dp), color = Color.Transparent)
            Key(Icons.Rounded.KeyboardArrowRight, "Right", { onKey("right") }, Modifier.align(Alignment.CenterEnd).padding(end = 8.dp), color = Color.Transparent)
            Key(null, "OK", { onKey("ok") }, Modifier.align(Alignment.Center), size = 96.dp, color = Accent, tint = Color.White, onLong = { onKey("hold") })
        }
        Text("Hold OK for options", color = Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 8.dp))
        Spacer(Modifier.height(22.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Pill("CH", { onKey("chup") }, { onKey("chdown") }, Icons.Rounded.KeyboardArrowUp, Icons.Rounded.KeyboardArrowDown)
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Key(Icons.Rounded.PlayArrow, "Play or pause", { onKey("playpause") }, size = 64.dp)
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Key(Icons.Rounded.FastRewind, "Rewind", { onKey("rew") }, size = 48.dp)
                    Key(Icons.Rounded.FastForward, "Fast forward", { onKey("ff") }, size = 48.dp)
                }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Pill(if (volume != null && volume.level >= 0) "${volume.level}" else "VOL", { onVolume("up") }, { onVolume("down") }, Icons.Rounded.Add, Icons.Rounded.Remove)
                Spacer(Modifier.height(8.dp))
                Key(if (volume?.muted == true) Icons.AutoMirrored.Rounded.VolumeOff else Icons.AutoMirrored.Rounded.VolumeUp, "Mute", { onVolume("mute") }, size = 44.dp,
                    tint = if (volume?.muted == true) Bad else TextHi)
            }
        }
        Spacer(Modifier.height(24.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
            listOf("red" to Color(0xFFE5484D), "green" to Color(0xFF30A46C), "yellow" to Color(0xFFF5D90A), "blue" to Color(0xFF3E63DD)).forEach { (k, c) ->
                Box(Modifier.size(width = 52.dp, height = 28.dp).clip(RoundedCornerShape(14.dp)).background(c).clickable(onClickLabel = k) { onKey(k) })
            }
            Key(Icons.Rounded.Info, "Info", { onKey("info") }, size = 44.dp)
        }
    }
}

@Composable
private fun Pill(label: String, onUp: () -> Unit, onDown: () -> Unit, up: ImageVector, down: ImageVector) {
    Column(Modifier.width(64.dp).clip(RoundedCornerShape(32.dp)).background(Panel2), horizontalAlignment = Alignment.CenterHorizontally) {
        Key(up, "$label up", onUp, color = Color.Transparent)
        Text(label, color = Muted, fontWeight = FontWeight.Bold, fontSize = 12.sp)
        Key(down, "$label down", onDown, color = Color.Transparent)
    }
}

@Composable
private fun TypeDialog(onDismiss: () -> Unit, onSend: (String) -> Unit) {
    var t by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = Panel,
        title = { Text("Search on the TV") },
        text = {
            OutlinedTextField(t, { t = it }, singleLine = true, placeholder = { Text("Channel, show, team or movie") },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { if (t.isNotBlank()) onSend(t.trim()) }))
        },
        confirmButton = { TextButton(onClick = { onSend(t.trim()) }, enabled = t.isNotBlank()) { Text("Search") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/* ---------- Play on TV ---------- */

@Composable
private fun Channels(lineup: Lineup?, note: String, playing: String, now: Long, onPlay: (Chan) -> Unit, onOpen: () -> Unit, onRetry: () -> Unit, onFav: (Chan, Boolean) -> Unit) {
    if (lineup == null) { LineupWaiting(note, onOpen, onRetry); return }
    var q by rememberSaveable { mutableStateOf("") }
    var group by rememberSaveable { mutableStateOf("") }
    val list = remember(lineup, q, group) {
        val base = if (group.isBlank()) lineup.channels else lineup.groups.firstOrNull { it.id == group }?.keys?.mapNotNull { lineup.byKey[it] } ?: lineup.channels
        val t = q.trim().lowercase()
        if (t.isEmpty()) base else base.filter { it.name.lowercase().contains(t) || (it.now?.title?.lowercase()?.contains(t) == true) || it.number == t }
    }
    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = q, onValueChange = { q = it }, singleLine = true,
            leadingIcon = { Icon(Icons.Rounded.Search, null) },
            trailingIcon = { if (q.isNotEmpty()) IconButton(onClick = { q = "" }) { Icon(Icons.Rounded.Close, "Clear") } },
            placeholder = { Text("Channel or programme") },
            shape = RoundedCornerShape(28.dp),
            colors = OutlinedTextFieldDefaults.colors(unfocusedContainerColor = Panel, focusedContainerColor = Panel, unfocusedBorderColor = Line),
            modifier = Modifier.fillMaxWidth().padding(16.dp, 12.dp, 16.dp, 4.dp),
        )
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 6.dp)) {
            item { GroupChip("All", group.isBlank()) { group = "" } }
            items(lineup.groups, key = { it.id }) { g -> GroupChip(g.name, group == g.id) { group = g.id } }
        }
        if (list.isEmpty()) Text("Nothing here matches.", color = Muted, modifier = Modifier.padding(24.dp))
        LazyColumn(contentPadding = PaddingValues(bottom = 24.dp), modifier = Modifier.fillMaxSize()) {
            items(list, key = { it.k }) { c -> ChannelRow(c, c.k == playing, now, onFav = { onFav(c, !c.fav) }) { onPlay(c) } }
        }
    }
}

@Composable
fun GroupChip(label: String, on: Boolean, onClick: () -> Unit) {
    FilterChip(selected = on, onClick = onClick, label = { Text(label, maxLines = 1) },
        colors = FilterChipDefaults.filterChipColors(containerColor = Panel, labelColor = TextHi, selectedContainerColor = Accent, selectedLabelColor = Color.White),
        border = FilterChipDefaults.filterChipBorder(enabled = true, selected = on, borderColor = Line))
}

@Composable
private fun ChannelRow(c: Chan, playing: Boolean, now: Long, onFav: () -> Unit, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClickLabel = "Play on the TV", onClick = onClick).background(if (playing) Panel else Color.Transparent).padding(16.dp, 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Logo(c.logo, c.number, 44.dp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(c.name, fontWeight = FontWeight.SemiBold, color = if (playing) Accent2 else TextHi, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            }
            val p: Prog? = c.now
            if (p != null) {
                Text(p.title, color = Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (p.end > p.start && now in p.start..p.end) {
                    Spacer(Modifier.height(4.dp))
                    LinearProgressIndicator(progress = { ((now - p.start).toFloat() / (p.end - p.start)).coerceIn(0f, 1f) }, color = Accent, trackColor = Panel2, modifier = Modifier.fillMaxWidth(0.6f).height(3.dp))
                }
            }
        }
        if (playing) Text("On the TV", color = Accent2, style = MaterialTheme.typography.labelSmall)
        IconButton(onClick = onFav) {
            Icon(if (c.fav) Icons.Rounded.Star else Icons.Rounded.StarOutline, if (c.fav) "Remove from Favorites" else "Add to Favorites", tint = if (c.fav) Accent2 else Muted)
        }
    }
}

/* ---------- typing on the phone into the TV ---------- */

/** The text boxes on the TV's screen right now (set-up, search, a rename): type them here.  Each change is
    sent a moment after you stop typing, sealed (it may be a password); Save sends a rename or name box. */
@Composable
private fun TypeOnTv(inputs: List<TvInput>, onType: (TvInput, String, Boolean) -> Unit, modifier: Modifier) {
    var shown by rememberSaveable { mutableStateOf(true) }
    Surface(color = Panel, shape = MaterialTheme.shapes.medium, modifier = modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp, 10.dp)) {
            Row(Modifier.fillMaxWidth().clickable { shown = !shown }, verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Keyboard, null, tint = Accent2, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Text(if (inputs.size == 1) "Type on your phone: " + inputs[0].label else "Type on your phone", fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Icon(if (shown) Icons.Rounded.KeyboardArrowUp else Icons.Rounded.KeyboardArrowDown, if (shown) "Hide" else "Show", tint = Muted)
            }
            if (shown) inputs.forEach { inp -> TvBox(inp, onType) }
        }
    }
}

@Composable
private fun TvBox(inp: TvInput, onType: (TvInput, String, Boolean) -> Unit) {
    // Starts from what the TV shows (a password never comes to the phone), then follows what is typed here.
    var t by remember(inp.id) { mutableStateOf(if (inp.secret) "" else inp.value) }
    var edited by remember(inp.id) { mutableStateOf(false) }
    var see by remember(inp.id) { mutableStateOf(false) }
    LaunchedEffect(inp.id, t) { if (edited) { delay(450); onType(inp, t, false) } }
    Column(Modifier.padding(top = 8.dp)) {
        OutlinedTextField(
            value = t, onValueChange = { t = it; edited = true }, singleLine = true,
            label = { Text(inp.label) },
            placeholder = { if (inp.secret && inp.filled) Text("Filled in on the TV") },
            visualTransformation = if (inp.secret && !see) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(
                keyboardType = when { inp.secret -> KeyboardType.Password; inp.type == "url" -> KeyboardType.Uri; else -> KeyboardType.Text },
                imeAction = if (inp.canSubmit) ImeAction.Done else ImeAction.Next,
            ),
            keyboardActions = KeyboardActions(onDone = { onType(inp, t, inp.canSubmit) }),
            trailingIcon = if (inp.secret) ({ IconButton(onClick = { see = !see }) { Icon(if (see) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility, if (see) "Hide" else "Show") } }) else null,
            modifier = Modifier.fillMaxWidth(),
        )
        if (inp.canSubmit) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = { onType(inp, t, true) }) { Text("Save on the TV") }
        }
    }
}
