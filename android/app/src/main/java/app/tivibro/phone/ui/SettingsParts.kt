/* Pieces of the phone's Settings (SettingsTab.kt) in the larger, clearer look: the big cards for the four sections
   people open most, a search hit with the words found lit up and its current value, the chips that jump to a part of
   a long page, the note that changes reach the TV at once, and the sheet for picking one of a choice's values. */
package app.tivibro.phone.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import app.tivibro.phone.tr
import kotlinx.coroutines.launch

/** One of the TV's Settings sections: its id, its title, and for the everyday ones what it's set to now (TV's tileLine). */
data class Sec(val id: String, val title: String, val line: String = "")

/** The sections shown as big cards at the top of Settings, in this order. */
internal val BIG = listOf("playback", "guide", "audio", "sports")

/** The big cards, two to a row: each section's icon on its colour, its title, and what it's set to now. */
@Composable
internal fun BigCards(secs: List<Sec>, onOpen: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        secs.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                pair.forEach { x -> BigCard(x, Modifier.weight(1f)) { onOpen(x.id) } }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

/** One big card (BigCards).  A line is always kept under the title, so the cards in a row are the same height. */
@Composable
private fun BigCard(x: Sec, modifier: Modifier, onClick: () -> Unit) {
    val (icon, tint) = sectionIcon(x.id)
    Surface(onClick = onClick, shape = RoundedCornerShape(20.dp), color = Panel, border = BorderStroke(1.dp, Line.copy(alpha = 0.8f)), modifier = modifier.heightIn(min = 112.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(42.dp).clip(RoundedCornerShape(13.dp)).background(tint.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) { Icon(icon, null, tint = tint, modifier = Modifier.size(23.dp)) }
            Column {
                Text(x.title, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(x.line.ifBlank { " " }, color = Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/* A search hit: its name with what was typed lit up, where it lives (Section › Page), and what it's set to now when
   it's a switch or a choice (newer TVs send it).  Tap to open its page with it lit up. */
@Composable
internal fun HitRow(x: SetHit, q: String, onClick: () -> Unit) {
    val name = buildAnnotatedString {
        val at = if (q.isBlank()) -1 else x.label.indexOf(q, ignoreCase = true)
        if (at < 0) append(x.label)
        else {
            append(x.label.substring(0, at))
            withStyle(SpanStyle(background = Accent.copy(alpha = 0.28f), color = TextHi)) { append(x.label.substring(at, at + q.length)) }
            append(x.label.substring(at + q.length))
        }
    }
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(16.dp, 13.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(name, fontWeight = FontWeight.SemiBold)
            Text(x.trail, color = Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (x.sub.isNotBlank()) Text(x.sub, color = Muted, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (x.value.isNotBlank()) {
            Spacer(Modifier.width(10.dp))
            Text(x.value, color = Accent, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 120.dp))
        }
        Icon(Icons.Rounded.ChevronRight, null, tint = Muted)
    }
}

/** A part of a page the chips jump to: its heading, and its heading's place in the page's list. */
internal data class Jump(val head: String, val item: Int)

/* The parts of a page, from its cards (SettingsTab's cardsOf): one per card with a heading, at the list item its heading
   is.  [first]: items before the cards (the "last copy" note).  Each card is a heading item (when it has one) and a
   card item, which is how SettingsTab lays them out. */
internal fun jumpsOf(cards: List<Pair<String, List<SetRow>>>, first: Int): List<Jump> {
    val out = mutableListOf<Jump>()
    var at = first
    cards.forEach { (head, _) ->
        if (head.isNotBlank()) { out.add(Jump(head, at)); at++ }
        at++
    }
    return out
}

/** Chips across the top of a long page, one per part; the part on screen is filled, and a tap scrolls to it. */
@Composable
internal fun PartChips(jumps: List<Jump>, list: LazyListState) {
    val scope = rememberCoroutineScope()
    // The part on screen: the last one whose heading is at or above the list's top.
    val here by remember(jumps) { derivedStateOf { jumps.indexOfLast { it.item <= list.firstVisibleItemIndex }.coerceAtLeast(0) } }
    LazyRow(Modifier.fillMaxWidth(), contentPadding = PaddingValues(16.dp, 2.dp, 16.dp, 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        itemsIndexed(jumps, key = { _, j -> j.item }) { n, j ->
            val on = n == here
            Surface(onClick = { scope.launch { list.animateScrollToItem(j.item) } }, shape = RoundedCornerShape(50),
                color = if (on) Accent else Panel, contentColor = if (on) OnAccent else TextHi, border = if (on) null else BorderStroke(1.dp, Line),
                modifier = Modifier.height(36.dp).semantics { role = Role.Tab; selected = on }) {
                Box(Modifier.fillMaxHeight().padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                    Text(j.head, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge, maxLines = 1)
                }
            }
        }
    }
}

/** Under a page of switches and choices: there's no Save, each one is made on the TV as you change it. */
@Composable
internal fun LiveNote() {
    Row(Modifier.fillMaxWidth().padding(8.dp, 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Rounded.CheckCircle, null, tint = Good, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
        Text(tr("Changes are made on the TV at once"), color = Muted, style = MaterialTheme.typography.bodySmall)
    }
}

/* Picking one of a choice's values: a sheet from the bottom with the setting's name and note, and each value as a
   big row with a round mark on the current one.  Tapping a value saves it and closes the sheet. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ChoiceSheet(r: SetRow, onDismiss: () -> Unit, onChoose: (Int) -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Panel) {
        Column(Modifier.padding(16.dp, 0.dp, 16.dp, 20.dp).navigationBarsPadding().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(r.label, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(horizontal = 4.dp))
            if (r.sub.isNotBlank()) Text(r.sub, color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(4.dp, 0.dp, 4.dp, 6.dp))
            r.options.forEachIndexed { n, o ->
                val on = n == r.cur
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(if (on) Color(0xFF1D2A52) else Panel2)
                        .border(if (on) 2.dp else 1.dp, if (on) Accent else Line, RoundedCornerShape(16.dp))
                        .clickable { onChoose(n) }.semantics { role = Role.RadioButton; selected = on }.padding(14.dp, 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(20.dp).clip(CircleShape).border(2.dp, if (on) Accent else Muted, CircleShape), contentAlignment = Alignment.Center) {
                        if (on) Box(Modifier.size(10.dp).clip(CircleShape).background(Accent))
                    }
                    Spacer(Modifier.width(12.dp))
                    Text(o, fontWeight = if (on) FontWeight.Bold else FontWeight.Medium)
                }
            }
            Text(tr("Tap one to save it."), color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(6.dp, 4.dp))
        }
    }
}
