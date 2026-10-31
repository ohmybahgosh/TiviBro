package app.tivibro.phone.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/* TiviBro's "Midnight Electric", the same colours as the TV app. */
val Ink = Color(0xFF0B0E1A)
val Panel = Color(0xFF141A2E)
val Panel2 = Color(0xFF1B2340)
val Line = Color(0xFF263052)
val Accent = Color(0xFF5B8CFF)
val Accent2 = Color(0xFF33E1FF)
val TextHi = Color(0xFFE8ECF8)
val Muted = Color(0xFF8E97B5)
val Good = Color(0xFF3DDC97)
val Bad = Color(0xFFFF6B7A)

private val scheme = darkColorScheme(
    primary = Accent, onPrimary = Color.White, primaryContainer = Color(0xFF223A7A), onPrimaryContainer = TextHi,
    secondary = Accent2, onSecondary = Ink, secondaryContainer = Panel2, onSecondaryContainer = TextHi,
    tertiary = Accent2,
    background = Ink, onBackground = TextHi, surface = Ink, onSurface = TextHi,
    surfaceVariant = Panel, onSurfaceVariant = Muted, surfaceContainer = Panel, surfaceContainerHigh = Panel2,
    surfaceContainerLow = Panel, surfaceContainerHighest = Panel2, surfaceContainerLowest = Ink,
    outline = Line, outlineVariant = Line, error = Bad, onError = Ink,
)

@Composable
fun TbTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = scheme,
        shapes = Shapes(small = RoundedCornerShape(10.dp), medium = RoundedCornerShape(16.dp), large = RoundedCornerShape(24.dp)),
        content = content,
    )
}
