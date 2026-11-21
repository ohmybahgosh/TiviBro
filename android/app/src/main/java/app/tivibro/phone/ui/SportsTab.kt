/* Sports, on the phone: the TV's Sports screen (sports.js, ESPN's scores tied to the TV's own channels) as rows
   of game cards: My teams, Live now, then a row per league.  A tap opens the game: the score in the two teams'
   colours, Watch on TV (on the TV's best channel), a reminder for one that hasn't started, following either
   team, the box score with each team's leaders, every channel of the TV's that has it, and the standings.
   A team whose scores are hidden on the TV shows none here either, until "Show the score". */
package app.tivibro.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.tivibro.phone.proto.SportGame
import app.tivibro.phone.proto.SportStandRow
import app.tivibro.phone.proto.SportTeam
import app.tivibro.phone.proto.SportsList
import app.tivibro.phone.proto.TbException
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private fun clock(t: Long): String = java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date(t))
/** As the TV says it: "2:10 4th", "Final", or when it starts ("Tomorrow 7:00 PM"). */
private fun status(g: SportGame, now: Long): String = when {
    g.hidden -> if (g.live) "On now, score hidden" else "Played, score hidden"
    g.state == "in" -> g.detail.replace(Regex("\\s+-\\s+"), " ")
    g.state == "post" -> "Final" + (Regex("OT|SO|/\\d").find(g.detail)?.let { " " + g.detail.replace(Regex("^Final/?", RegexOption.IGNORE_CASE), "") } ?: "")
    else -> dateOf(g.start) + "  ·  " + clock(g.start)
}
/** "Sat, Nov 22", in the phone's own date format. */
private fun dateOf(t: Long): String = android.text.format.DateFormat.format(android.text.format.DateFormat.getBestDateTimePattern(java.util.Locale.getDefault(), "EEEMMMd"), t).toString()
private fun color(hex: String, a: Float): Color = try { Color(android.graphics.Color.parseColor("#$hex")).copy(alpha = a) } catch (e: Exception) { Panel2.copy(alpha = a) }

@Composable
fun SportsTab(model: AppModel, id: String, playing: String, now: Long) {
    var data by remember { mutableStateOf<SportsList?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var open by remember { mutableStateOf<SportGame?>(null) }
    // Every 30 seconds while a game is on, else every 2 minutes.
    LaunchedEffect(attempt) {
        while (true) {
            try { data = model.sports(id); error = null }
            catch (e: TbException) { error = e.message }
            catch (e: Exception) { if (data == null) error = "The TV didn't answer.  Is it on, and on the same network?" }
            delay(if (data?.rows?.any { r -> r.games.any { it.live } } == true) 30_000 else 120_000)
        }
    }
    val d = data
    when {
        d == null && error != null -> Column(Modifier.fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(error ?: ""); Spacer(Modifier.size(12.dp)); Button(onClick = { attempt++ }) { Text("Try again") }
        }
        d == null -> Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        d.off -> Text(d.msg, color = Muted, modifier = Modifier.padding(24.dp))
        d.rows.isEmpty() -> Text("No games today in the TV's leagues (" + d.leagues.joinToString(", ") + ").  Pick the leagues on the TV: Sports, then Blue.",
            color = Muted, modifier = Modifier.padding(24.dp))
        else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            items(d.rows, key = { it.id }) { r ->
                Column(Modifier.padding(16.dp, 14.dp, 16.dp, 8.dp)) {
                    Text(r.title, style = MaterialTheme.typography.titleMedium)
                    if (r.sub.isNotBlank()) Text(r.sub, color = Muted, style = MaterialTheme.typography.labelMedium)
                }
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(r.games, key = { r.id + it.id }) { g -> GameCard(g, r.id, now) { open = g } }
                }
            }
        }
    }
    open?.let { g -> GameSheet(model, id, g, now, playing, onDone = { open = null; attempt++ }) }
}

@Composable
private fun TeamLine(t: SportTeam, lose: Boolean, big: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.height(if (big) 40.dp else 34.dp)) {
        Box(Modifier.size(if (big) 32.dp else 26.dp), contentAlignment = Alignment.Center) {
            if (t.logo.isNotBlank()) AsyncImage(model = t.logo, contentDescription = t.name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            else Text(t.abbr, fontSize = 10.sp, color = Muted)
        }
        Spacer(Modifier.width(10.dp))
        if (t.rank > 0) Text(t.rank.toString() + " ", color = Muted, fontSize = 12.sp)
        Text(t.name, fontWeight = FontWeight.SemiBold, color = if (lose) Muted else TextHi, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        if (t.rec.isNotBlank()) Text("  " + t.rec, color = Muted, fontSize = 11.sp, maxLines = 1)
        Spacer(Modifier.weight(1f))
        t.score?.let { Text(it.toString(), fontWeight = FontWeight.ExtraBold, fontSize = 20.sp, color = if (lose) Muted else TextHi) }
    }
}
private fun loses(g: SportGame, t: SportTeam): Boolean {
    if (g.state != "post" || g.teams.size != 2) return false
    val o = g.teams.first { it !== t }
    return t.score != null && o.score != null && t.score < o.score
}

@Composable
private fun GameCard(g: SportGame, row: String, now: Long, onClick: () -> Unit) {
    Column(Modifier.width(270.dp).clip(RoundedCornerShape(14.dp)).background(Brush.linearGradient(listOf(Panel2, Panel))).clickable(onClick = onClick).padding(14.dp, 10.dp)) {
        if (g.teams.size == 2) g.teams.forEach { TeamLine(it, loses(g, it)) }
        else Text(g.name, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.height(68.dp))
        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (g.live) { StatusTag(true, "LIVE"); Spacer(Modifier.width(6.dp)) }
            if (row == "mine" || row == "live") { Text(g.league, color = Accent, fontSize = 11.sp, fontWeight = FontWeight.Bold); Spacer(Modifier.width(6.dp)) }
            Text(status(g, now) + if (g.state == "post") "  ·  " + dateOf(g.start) else "", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            Spacer(Modifier.weight(1f))
            val c = g.chans.firstOrNull()
            Text(c?.name ?: if (g.state == "post") "" else "not on the TV's channels", color = if (c != null) TextHi else Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = 6.dp))
        }
        if (g.mine && row != "mine") Text("MY TEAM", color = Accent, fontSize = 10.sp, fontWeight = FontWeight.ExtraBold)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GameSheet(model: AppModel, id: String, first: SportGame, now: Long, playing: String, onDone: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var g by remember { mutableStateOf(first) }
    // The page with its box score and every channel; again every 30 seconds while it's on.
    LaunchedEffect(first.id) {
        while (true) {
            try { g = model.sportsGame(id, first.id) } catch (e: Exception) { }
            if (!g.live) break
            delay(30_000)
        }
    }
    fun act(f: suspend () -> Unit) = scope.launch {
        try { f() } catch (e: TbException) { model.say(e.message ?: "The TV said no") } catch (e: Exception) { model.say("The TV didn't answer.  Is it on, and on the same network?") }
    }
    ModalBottomSheet(onDismissRequest = onDone, sheetState = sheet, containerColor = Panel) {
        Column(Modifier.padding(bottom = 24.dp).verticalScroll(rememberScrollState())) {
            val a = g.teams.getOrNull(0); val h = g.teams.getOrNull(1)
            // A final with a winner: 0 or 1, else -1.
            val win = if (g.state == "post" && !g.hidden && a?.score != null && h?.score != null && a.score != h.score) (if (a.score!! > h.score!!) 0 else 1) else -1
            // Which standings row is a team's: its full name starts with the row's ("Michigan" for the Wolverines, not the Spartans).
            fun rowOf(rows: List<SportStandRow>, t: SportTeam): SportStandRow? = rows.filter { r -> r.team == t.name || r.team == t.full || t.full.startsWith(r.team + " ") }.maxByOrNull { it.team.length }
            // The score in the two teams' colours.
            Box(Modifier.fillMaxWidth().padding(16.dp, 0.dp).clip(RoundedCornerShape(18.dp))
                .background(Brush.horizontalGradient(listOf(color(a?.color ?: "", 0.9f), Ink.copy(alpha = 0.92f), Ink.copy(alpha = 0.92f), color(h?.color ?: "", 0.9f)))).padding(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (a != null) TeamBlock(a, Modifier.weight(1f), win == 0, win == 1)
                    Column(Modifier.weight(1.2f), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(if (g.teams.size == 2 && g.state != "pre" && !g.hidden) "${a?.score ?: ""}  –  ${h?.score ?: ""}" else if (g.hidden) "Score hidden" else clock(g.start),
                            fontSize = if (g.state != "pre" && !g.hidden) 36.sp else 24.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (g.live) { StatusTag(true, "LIVE"); Spacer(Modifier.width(6.dp)) }
                            Text(if (g.state == "pre" && !g.hidden) dateOf(g.start) else status(g, now), fontSize = 12.sp, maxLines = 1)
                        }
                        Text(listOf(g.league, g.nets.firstOrNull().orEmpty()).filter { it.isNotBlank() }.joinToString("  ·  "), color = Color(0xFFD3D9EA), fontSize = 11.sp, maxLines = 1)
                    }
                    if (h != null) TeamBlock(h, Modifier.weight(1f), win == 1, win == 0)
                }
            }
            // Watch on TV, a reminder, follow, show the score.
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(16.dp, 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                g.chans.firstOrNull()?.let { c -> Button(onClick = { model.playOnTv(id, c.key, c.name); onDone() }, colors = ButtonDefaults.buttonColors(containerColor = Accent)) { Text("Watch on TV") } }
                if (g.state == "pre" && g.chans.isNotEmpty()) OutlinedButton(onClick = { act { val on = model.sportsRemind(id, g.id); g = g.copy(reminder = on); model.say(if (on) "Reminder set on the TV" else "Reminder cancelled") } }) {
                    Text(if (g.reminder) "Cancel the reminder" else "Remind me")
                }
                g.teams.filter { it.id.isNotBlank() }.forEach { t ->
                    OutlinedButton(onClick = { act { val on = model.sportsFollow(id, t.id, !t.mine); g = g.copy(teams = g.teams.map { if (it.id == t.id) it.copy(mine = on) else it }) } }) {
                        Text(if (t.mine) "Following ${t.name}" else "Follow ${t.name}")
                    }
                }
                if (g.hidden) OutlinedButton(onClick = { act { g = model.sportsShow(id, g.id) } }) { Text("Show the score") }
            }
            val sum = g.sum
            // The box score, by period, and each team's leaders.
            val lines = sum?.lines?.filter { it.periods.isNotEmpty() }.orEmpty()
            if (!g.hidden && lines.size == 2) {
                Section("Box score")
                val n = lines.maxOf { it.periods.size }
                Column(Modifier.padding(16.dp, 0.dp)) {
                    Row { Text("", Modifier.weight(2f)); (1..n).forEach { Text(it.toString(), Modifier.weight(1f), color = Muted, fontSize = 11.sp, textAlign = TextAlign.Center) }; Text("T", Modifier.weight(1f), color = Muted, fontSize = 11.sp, textAlign = TextAlign.Center) }
                    lines.forEachIndexed { i, l ->
                        val dim = win >= 0 && i != win
                        Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Row(Modifier.weight(2f), verticalAlignment = Alignment.CenterVertically) { MiniLogo(g.teams.getOrNull(i)); Text(g.teams.getOrNull(i)?.name ?: l.abbr, color = if (dim) Muted else TextHi, fontWeight = if (i == win) FontWeight.Bold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                            (0 until n).forEach { p -> Text(l.periods.getOrNull(p).orEmpty(), Modifier.weight(1f), textAlign = TextAlign.Center) }
                            Text(l.score + if (i == win) " ◀" else "", Modifier.weight(1f), fontWeight = FontWeight.ExtraBold, color = if (dim) Muted else TextHi, textAlign = TextAlign.Center)
                        }
                    }
                }
                sum?.leaders?.sortedBy { tl -> g.teams.indexOfFirst { it.abbr == tl.abbr }.let { if (it < 0) 9 else it } }?.forEach { tl ->
                    tl.list.take(2).forEachIndexed { k, x ->
                        Row(Modifier.padding(16.dp, 3.dp), verticalAlignment = Alignment.CenterVertically) {
                            Row(Modifier.width(76.dp), verticalAlignment = Alignment.CenterVertically) { if (k == 0) { MiniLogo(g.teams.firstOrNull { it.abbr == tl.abbr }); Text(tl.abbr, fontWeight = FontWeight.Bold, fontSize = 13.sp) } }
                            Text(x.who + "  ", fontSize = 13.sp); Text(x.value, fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            } else if (g.state == "pre") Text("The box score starts with the game.", color = Muted, modifier = Modifier.padding(16.dp, 8.dp))
            // Every channel of the TV's with the game.
            Section("On the TV's channels")
            if (g.chans.isEmpty()) Text(if (g.nets.isNotEmpty()) "Not on the TV's channels.  It's on " + g.nets.joinToString(", ") + "." else "Not on the TV's channels.", color = Muted, modifier = Modifier.padding(16.dp, 4.dp))
            g.chans.forEach { c ->
                Row(Modifier.fillMaxWidth().clickable { model.playOnTv(id, c.key, c.name); onDone() }.padding(16.dp, 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Logo(c.logo, "", 40.dp)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(c.name, color = if (c.key == playing) Accent else TextHi, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (c.what.isNotBlank()) Text(c.what, color = Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            // The standings of the teams' division or conference.
            (sum?.standings?.firstOrNull { st -> g.teams.any { t -> t.mine && rowOf(st.rows, t) != null } } ?: sum?.standings?.firstOrNull())?.let { st ->
                Section(st.name.ifBlank { "Standings" })
                st.rows.forEach { r ->
                    val who = g.teams.firstOrNull { rowOf(st.rows, it) == r }; val me = who != null
                    Row(Modifier.fillMaxWidth().background(if (me) Color.White.copy(alpha = 0.06f) else Color.Transparent).padding(16.dp, 3.dp), verticalAlignment = Alignment.CenterVertically) {
                        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) { if (who != null) MiniLogo(who) else if (r.logo.isNotBlank()) { AsyncImage(model = r.logo, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(8.dp)) }; Text(r.team, fontWeight = if (me) FontWeight.Bold else FontWeight.Normal, maxLines = 1) }
                        Text(if (g.hidden) "·" else r.rec, Modifier.width(70.dp), textAlign = TextAlign.End, fontWeight = if (me) FontWeight.Bold else FontWeight.Normal)
                        Text(if (g.hidden) "" else if (r.extraKey.isNotBlank()) r.extraKey + " " + r.extraValue else "", Modifier.width(80.dp), textAlign = TextAlign.End, color = Muted, fontSize = 12.sp)
                    }
                }
            }
            if (g.venue.isNotBlank()) Text(g.venue, color = Muted, fontSize = 12.sp, modifier = Modifier.padding(16.dp, 12.dp))
        }
    }
}

@Composable
private fun TeamBlock(t: SportTeam, modifier: Modifier, won: Boolean = false, lost: Boolean = false) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(52.dp), contentAlignment = Alignment.Center) {
            if (t.logo.isNotBlank()) AsyncImage(model = t.logo, contentDescription = t.name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize(), alpha = if (lost) 0.55f else 1f)
        }
        Text((if (t.rank > 0) "${t.rank} " else "") + t.name, fontWeight = FontWeight.Bold, color = if (lost) Color(0xFFAAB2C8) else TextHi, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        if (t.rec.isNotBlank()) Text(t.rec, color = Color(0xFFD3D9EA), fontSize = 11.sp)
        if (won) Text("WINNER", color = Color(0xFF0B0E14), fontSize = 10.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(top = 4.dp).clip(RoundedCornerShape(50)).background(Color.White).padding(10.dp, 1.dp))
    }
}

/** A team's logo, small, before its name in the box score, leaders and standings. */
@Composable
private fun MiniLogo(t: SportTeam?) {
    if (t == null || t.logo.isBlank()) return
    AsyncImage(model = t.logo, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.size(20.dp))
    Spacer(Modifier.width(8.dp))
}

@Composable
private fun Section(title: String) {
    Text(title.uppercase(), color = Muted, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(16.dp, 16.dp, 16.dp, 6.dp))
}
