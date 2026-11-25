/* TheTVDB's terms: whoever sees details that came from TheTVDB sees "Metadata provided by TheTVDB" with a link to
   thetvdb.com (thetvdb.com/api-information).  The TV marks such details (tvdb: 1, or an id that starts "tvdb:"),
   and the phone shows this line under them; a tap opens TheTVDB. */
package app.tivibro.phone.ui

import app.tivibro.phone.tr

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp

/** Did these details come from TheTVDB?  The provider's name or the id TiviBro gives TheTVDB's titles. */
fun fromTvdb(id: String?, provider: String? = null): Boolean = provider == "TheTVDB" || (id ?: "").startsWith("tvdb:")

/** "Metadata provided by TheTVDB", linking to thetvdb.com. */
@Composable
fun TvdbCredit(modifier: Modifier = Modifier.padding(16.dp, 4.dp)) {
    val uri = LocalUriHandler.current
    Text(tr("Metadata provided by TheTVDB") + "  ·  thetvdb.com", color = Muted, style = MaterialTheme.typography.labelSmall,
        textDecoration = TextDecoration.Underline, modifier = modifier.clickable { runCatching { uri.openUri("https://thetvdb.com") } })
}
