/* A provider's link shared to TiviBro from an email, a message or a browser (Share, then TiviBro): the
   app says what it found (an Xtream Codes login or an M3U playlist, without showing the password), you
   pick the TV, and the TV adds the playlist the way the web editor's Add a playlist does.  The link
   travels sealed: it holds the login. */
package app.tivibro.phone.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.tivibro.phone.proto.ProviderLink
import app.tivibro.phone.proto.TbException
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareScreen(model: AppModel, text: String, tvs: List<TvUi>, onBack: () -> Unit, onPair: () -> Unit) {
    val link = remember(text) { ProviderLink.find(text) }
    var pick by remember { mutableStateOf(tvs.firstOrNull { it.power == Power.ON }?.tv?.id ?: tvs.firstOrNull()?.tv?.id) }
    var name by remember { mutableStateOf("") }
    var use by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Scaffold(
        containerColor = Ink,
        topBar = {
            TopAppBar(title = { Text("Add a playlist") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Ink))
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Surface(color = Panel, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.Link, null, tint = if (link != null && !link.bare) Accent2 else Bad)
                    Spacer(Modifier.width(12.dp))
                    Column {
                        when {
                            link == null -> { Text("No link found", fontWeight = FontWeight.SemiBold); Text("Share the link your provider sent: the long one with your username and password in it.", color = Muted, style = MaterialTheme.typography.bodySmall) }
                            link.bare -> { Text("Only a server address", fontWeight = FontWeight.SemiBold); Text("${link.host} has no login in it.  Share the full link your provider sent, or add it on the TV.", color = Muted, style = MaterialTheme.typography.bodySmall) }
                            link.xtream -> { Text("Xtream Codes login", fontWeight = FontWeight.SemiBold); Text("${link.host}, username ${link.user}.  The password stays hidden.", color = Muted, style = MaterialTheme.typography.bodySmall) }
                            else -> { Text("M3U playlist", fontWeight = FontWeight.SemiBold); Text(link.host, color = Muted, style = MaterialTheme.typography.bodySmall) }
                        }
                    }
                }
            }
            if (link == null || link.bare) { Button(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Close") }; return@Column }
            if (tvs.isEmpty()) {
                Text("Pair your TV first: on the TV, open TiviBro, Settings, Phone app, Pair a phone.", color = Muted)
                Button(onClick = onPair, modifier = Modifier.fillMaxWidth()) { Text("Add a TV") }
                return@Column
            }
            done?.let { msg ->
                Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Rounded.CheckCircle, null, tint = Good); Spacer(Modifier.width(10.dp)); Text(msg) }
                Button(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Done") }
                return@Column
            }
            Text("Add it to", style = MaterialTheme.typography.labelLarge, color = Muted)
            tvs.forEach { u ->
                Row(Modifier.fillMaxWidth().clickable { pick = u.tv.id }, verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selected = pick == u.tv.id, onClick = { pick = u.tv.id })
                    Column {
                        Text(u.tv.name)
                        Text(if (u.power == Power.ON) "On" else if (u.power == Power.OFF) "Off or not reachable" else "…", color = Muted, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
            OutlinedTextField(name, { name = it }, singleLine = true, label = { Text("Name (optional)") }, modifier = Modifier.fillMaxWidth())
            Row(Modifier.fillMaxWidth().clickable { use = !use }, verticalAlignment = Alignment.CenterVertically) {
                Checkbox(use, { use = it }); Text("Switch the TV to it when it's added")
            }
            error?.let { Text(it, color = Bad) }
            Button(
                onClick = {
                    val id = pick ?: return@Button
                    busy = true; error = null
                    scope.launch {
                        try { done = model.addPlaylist(id, link.link, name.trim(), use) }
                        catch (e: TbException) { error = e.message }
                        catch (e: Exception) { error = "The TV didn't answer.  Is it on, and on the same network?" }
                        finally { busy = false }
                    }
                },
                enabled = !busy && pick != null, modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                if (busy) { CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp); Spacer(Modifier.width(10.dp)); Text("Checking the login on the TV…") }
                else Text("Add to the TV")
            }
            Text("The TV checks the login and loads the channels, then shows them.  The link is sent encrypted and isn't kept on this phone.", color = Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}
