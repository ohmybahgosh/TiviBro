/* Colours, shapes and type: TiviBro's "Midnight Electric" look, the same as the TV app. */
package app.tivibro.phone.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/* The TV app's own colours (app/css/app.css :root), one scheme everywhere:
   Accent for buttons, links, progress and anything selected; Accent2 (teal) only for section headings;
   Panel for cards and dialogs, Panel2 (raised) for things on a card, Line for dividers and borders;
   Warn for warnings, Bad for errors, deleting and Live, Good for "on" and done. */
val Ink = Color(0xFF0B0E1A)
val Panel = Color(0xFF141A2E)
val Panel2 = Color(0xFF1D2540)
val Line = Color(0xFF2A3352)
val Accent = Color(0xFF5B8CFF)
/** Text and icons on an Accent background (the TV's --on-accent). */
val OnAccent = Ink
val Accent2 = Color(0xFF33E1FF)
val TextHi = Color(0xFFE8ECF8)
val Muted = Color(0xFF8F9BBF)
val Warn = Color(0xFFF2B33D)
val Good = Color(0xFF3DDC97)
val Bad = Color(0xFFE5484D)

private val scheme = darkColorScheme(
    primary = Accent, onPrimary = OnAccent, primaryContainer = Panel2, onPrimaryContainer = TextHi,
    secondary = Accent, onSecondary = OnAccent, secondaryContainer = Panel2, onSecondaryContainer = TextHi,
    tertiary = Accent, onTertiary = OnAccent, tertiaryContainer = Panel2, onTertiaryContainer = TextHi,
    background = Ink, onBackground = TextHi, surface = Ink, onSurface = TextHi,
    surfaceVariant = Panel, onSurfaceVariant = Muted, surfaceContainer = Panel, surfaceContainerHigh = Panel,
    surfaceContainerLow = Panel, surfaceContainerHighest = Panel2, surfaceContainerLowest = Ink,
    outline = Line, outlineVariant = Line, error = Bad, onError = TextHi,
)

@Composable
fun TbTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = scheme,
        shapes = Shapes(small = RoundedCornerShape(10.dp), medium = RoundedCornerShape(16.dp), large = RoundedCornerShape(24.dp)),
        content = content,
    )
}
