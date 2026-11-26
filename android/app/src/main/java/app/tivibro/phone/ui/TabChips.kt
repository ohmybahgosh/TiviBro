/* The row of tabs under a TV's card (TvScreen.kt): Remote, Channels, Guide, On now, Sports, Movies, Shows,
   My media and Settings as big rounded chips, each with its icon, the open one filled.  Easier to hit with a thumb
   than a thin underlined tab, and the icons make them quick to spot.  The row scrolls sideways when they don't
   all fit, and brings the open one into view (a shortcut can open a tab far along). */
package app.tivibro.phone.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CalendarViewWeek
import androidx.compose.material.icons.rounded.EmojiEvents
import androidx.compose.material.icons.rounded.LiveTv
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.SettingsRemote
import androidx.compose.material.icons.rounded.Tv
import androidx.compose.material.icons.rounded.VideoLibrary
import androidx.compose.material.icons.rounded.ViewList
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.tivibro.phone.tr

/** Each tab's icon, by its id (the English name, which shortcuts and links use). */
private fun tabIcon(t: String): ImageVector = when (t) {
    "Remote" -> Icons.Rounded.SettingsRemote
    "Channels" -> Icons.Rounded.ViewList
    "Guide" -> Icons.Rounded.CalendarViewWeek
    "On now" -> Icons.Rounded.LiveTv
    "Sports" -> Icons.Rounded.EmojiEvents
    "Movies" -> Icons.Rounded.Movie
    "Shows" -> Icons.Rounded.Tv
    "My media" -> Icons.Rounded.VideoLibrary
    else -> Icons.Rounded.Settings
}

/** The tabs [tabs] (ids) as chips, [cur] filled; [onPick] with the id tapped.  Names shown in the app's language. */
@Composable
fun TabChips(tabs: List<String>, cur: String, onPick: (String) -> Unit, modifier: Modifier = Modifier) {
    val state = rememberLazyListState()
    val at = tabs.indexOf(cur)
    // The open tab in view, with a little of the one before it showing so it's clear the row scrolls.
    LaunchedEffect(at, tabs.size) { if (at >= 0) state.animateScrollToItem((at - 1).coerceAtLeast(0)) }
    LazyRow(modifier.fillMaxWidth(), state = state, contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(tabs, key = { it }) { t ->
            val on = t == cur
            Surface(
                onClick = { onPick(t) },
                shape = RoundedCornerShape(50),
                color = if (on) Accent else Panel,
                contentColor = if (on) OnAccent else TextHi,
                border = if (on) null else BorderStroke(1.dp, Line),
                modifier = Modifier.height(42.dp).semantics { role = Role.Tab; selected = on },
            ) {
                // A little less room on the icon's side, so icon and words look centred.
                Row(Modifier.fillMaxHeight().padding(start = 13.dp, end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(tabIcon(t), null, Modifier.size(19.dp))
                    Spacer(Modifier.width(7.dp))
                    Text(tr(t), fontWeight = FontWeight.Bold, fontSize = 14.sp, maxLines = 1)
                }
            }
        }
    }
}

