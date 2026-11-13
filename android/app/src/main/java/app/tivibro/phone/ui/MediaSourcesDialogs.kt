/* My media sources from the phone (Settings > My media): adding a DLNA server, a WebDAV folder or a
   Dropbox folder, each source's rescan, content, details and remove, and the TMDB token, typed here
   instead of on the TV.  Dropbox: the phone signs in (proto/Dropbox.kt, AppModel.dropboxStart), and
   DropboxDialog picks the folder with the TV (ops dbfolders and adddropbox).  The TV does the work (ask "mymedia", see phone.js; sealed, as logins cross); a scan that takes
   longer than about 25 seconds carries on on the TV, and the answer says so. */
package app.tivibro.phone.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.tivibro.phone.proto.TbException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject

/** One media source as the TV sends it. */
private fun plural(n: Int, word: String) = "$n $word" + if (n == 1) "" else "s"

private data class MediaSrc(val id: String, val name: String, val type: String, val mode: String, val movies: Int, val episodes: Int, val scanning: Boolean, val root: String = "")

/** A source's kind, as the TV's Settings say it. */
private fun typeLabel(type: String) = when (type) { "dlna" -> "DLNA / UPnP"; "dropbox" -> "Dropbox"; else -> "WebDAV" }

private val MODES = listOf("automatic" to "Movies and TV shows", "movies" to "Movies only", "shows" to "TV shows only")

/** Asks the TV; the answer's msg is said, errors come back as text. */
private suspend fun myMedia(model: AppModel, id: String, args: JSONObject): Pair<JSONObject?, String?> = try {
    val r = model.ask(id, "mymedia", args, seal = true, timeoutMs = 70_000, tries = 1)
    r.optString("msg").takeIf { it.isNotBlank() }?.let { model.say(it) }
    r to null
} catch (e: TbException) { null to e.message } catch (e: Exception) { null to "The TV didn't answer.  Is it on, and on the same network?" }

@Composable
private fun Busy(text: String) = Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Accent)
    Spacer(Modifier.size(12.dp)); Text(text, color = Muted)
}

@Composable
private fun Choice(label: String, sub: String = "", onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 12.dp)) {
        Text(label, fontWeight = FontWeight.SemiBold, color = Accent)
        if (sub.isNotBlank()) Text(sub, color = Muted, style = MaterialTheme.typography.bodySmall)
    }
    HorizontalDivider(color = Line.copy(alpha = 0.35f), thickness = 0.5.dp)
}

/** Add media: a server on the network (the TV looks), a WebDAV folder with its login, or Dropbox (signed in here). */
@Composable
fun MediaAddDialog(model: AppModel, id: String, onDone: (changed: Boolean) -> Unit) {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    var step by remember { mutableStateOf("pick") }          // pick, servers, webdav
    var busy by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var servers by remember { mutableStateOf<List<Pair<Int, String>>?>(null) }
    var address by remember { mutableStateOf("") }
    var user by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    val premiumize = Regex("premiumize", RegexOption.IGNORE_CASE).containsMatchIn(address)

    fun run(what: String, args: JSONObject, then: (JSONObject) -> Unit) {
        busy = what; error = null
        scope.launch { val (r, e) = myMedia(model, id, args); busy = null; if (r != null) then(r) else error = e }
    }
    fun look() { step = "servers"; servers = null; run("Looking for media servers on your network…", JSONObject().put("op", "discover")) { r ->
        val a = r.optJSONArray("servers"); servers = if (a == null) emptyList() else (0 until a.length()).map { a.getJSONObject(it).let { s -> s.optInt("i") to s.optString("name") } } } }

    AlertDialog(
        onDismissRequest = { if (busy == null) onDone(false) }, containerColor = Panel,
        title = { Text(when (step) { "servers" -> "Media servers"; "webdav" -> "Add a WebDAV folder"; else -> "Add media" }) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                error?.let { Text(it, color = Bad, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 8.dp)) }
                when (step) {
                    "pick" -> {
                        Choice("Browse my network (DLNA / UPnP)", "The TV looks for a home media server with media sharing turned on") { look() }
                        Choice("Add a WebDAV folder", "Your media folder's address and login, typed here") { step = "webdav" }
                        // The sign-in carries on in the browser and comes back to DropboxDialog (MainActivity).
                        Choice("Dropbox", "Sign in to Dropbox, then pick the folder with your movies and shows") { openDropbox(ctx, model, model.dropboxStart(id)); onDone(false) }
                    }
                    "servers" -> {
                        val l = servers
                        when {
                            busy != null -> Busy(busy!!)
                            l == null -> {}
                            l.isEmpty() -> Text("No media servers answered.  Is media sharing on, and is the server on the TV's network?", color = Muted)
                            else -> l.forEach { (i, name) -> Choice(name, "Add it and look for movies and shows") {
                                run("Adding $name…  A big library takes a while.", JSONObject().put("op", "adddlna").put("i", i)) { onDone(true) } } }
                        }
                    }
                    "webdav" -> {
                        Text("Files can be in this folder or its subfolders.  Movies and TV shows are recognised from their names.  The login is checked before it is saved, and stays on the TV.",
                            color = Muted, style = MaterialTheme.typography.bodySmall)
                        Spacer(Modifier.size(8.dp))
                        OutlinedTextField(address, { address = it.trim() }, label = { Text("Folder address (https://…)") }, singleLine = true, enabled = busy == null,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(user, { user = it }, label = { Text(if (premiumize) "Customer ID" else "User name or customer ID") }, singleLine = true, enabled = busy == null, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(pass, { pass = it }, label = { Text(if (premiumize) "API key" else "Password or API key") }, singleLine = true, enabled = busy == null,
                            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
                        busy?.let { Busy(it) }
                    }
                }
            }
        },
        confirmButton = {
            when (step) {
                "webdav" -> TextButton(enabled = busy == null && address.startsWith("http", ignoreCase = true), onClick = {
                    run("Checking the login…  A big folder takes a while.", JSONObject().put("op", "addwebdav").put("address", address).put("user", user).put("pass", pass)) { onDone(true) }
                }) { Text("Add") }
                "servers" -> if (busy == null && servers != null) TextButton(onClick = { look() }) { Text("Look again") }
                else -> {}
            }
        },
        dismissButton = {
            TextButton(enabled = busy == null, onClick = { if (step == "pick") onDone(false) else { step = "pick"; error = null } }) { Text(if (step == "pick") "Close" else "Back") }
        },
    )
}

/** One source: rescan, content (movies, shows or both), movie details, remove. */
@Composable
fun MediaSourceDialog(model: AppModel, id: String, sid: String, onDone: (changed: Boolean) -> Unit) {
    val scope = rememberCoroutineScope()
    var src by remember { mutableStateOf<MediaSrc?>(null) }
    var busy by remember { mutableStateOf<String?>("Asking the TV…") }
    var error by remember { mutableStateOf<String?>(null) }
    var step by remember { mutableStateOf("menu") }          // menu, mode, remove, details
    var changed by remember { mutableStateOf(false) }

    fun run(what: String, args: JSONObject, close: Boolean = true) {
        busy = what; error = null
        scope.launch {
            val (r, e) = myMedia(model, id, args.put("id", sid)); busy = null
            if (r == null) error = e else { changed = true; if (close) onDone(true) }
        }
    }
    LaunchedEffect(sid) {
        val (r, e) = myMedia(model, id, JSONObject().put("op", "sources")); busy = null
        val a = r?.optJSONArray("sources")
        src = a?.let { (0 until it.length()).map { n -> it.getJSONObject(n) }.firstOrNull { s -> s.optString("id") == sid } }?.let { s ->
            MediaSrc(s.optString("id"), s.optString("name"), s.optString("type"), s.optString("mode"), s.optInt("movies"), s.optInt("episodes"), s.optInt("scanning") == 1,
                s.optString("root").ifBlank { s.optString("folder") }) }
        if (src == null) error = e ?: "That media source is gone from the TV."
    }

    val s = src
    AlertDialog(
        onDismissRequest = { if (busy == null) onDone(changed) }, containerColor = Panel,
        title = { Text(s?.name ?: "Media source") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                error?.let { Text(it, color = Bad, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 8.dp)) }
                if (s != null) Text(typeLabel(s.type) + (if (s.type == "dropbox" && s.root.isNotBlank()) "  ·  " + s.root else "") + (if (s.mode != "shows") "  ·  " + plural(s.movies, "movie") else "") + (if (s.mode != "movies" || s.episodes > 0) "  ·  " + plural(s.episodes, "episode") else "") + (if (s.scanning) "  ·  scanning now" else ""),
                    color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 6.dp))
                when {
                    busy != null -> Busy(busy!!)
                    s == null -> {}
                    step == "mode" -> MODES.forEach { (k, label) ->
                        Row(Modifier.fillMaxWidth().clickable { run("Changing it and scanning again…", JSONObject().put("op", "mode").put("mode", k)) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = s.mode == k, onClick = { run("Changing it and scanning again…", JSONObject().put("op", "mode").put("mode", k)) }); Text(label)
                        }
                    }
                    step == "remove" -> Text("Remove ${s.name} from My media?  Your files stay where they are.")
                    step == "details" -> Text("Fetch movie details from TMDB?  Titles and years, or saved movie IDs, are sent to TMDB with the TV's token.  Your source logins are never sent.")
                    else -> {
                        Choice("Rescan", "Look for added or removed movies and episodes") { run("Scanning ${s.name}…", JSONObject().put("op", "rescan")) }
                        Choice("Restart scan", "Start over from the top of the folder") { run("Scanning ${s.name} from the start…", JSONObject().put("op", "rescan").put("restart", true)) }
                        Choice("Content: " + (MODES.firstOrNull { it.first == s.mode }?.second ?: "Movies only"), "What to look for in this source") { step = "mode" }
                        Choice("Fetch movie details", "TMDB, with the token saved on the TV") { step = "details" }
                        Choice("Remove", "Your files stay where they are") { step = "remove" }
                    }
                }
            }
        },
        confirmButton = {
            when (step) {
                "remove" -> TextButton(enabled = busy == null, onClick = { run("Removing…", JSONObject().put("op", "remove")) }) { Text("Remove", color = Bad) }
                "details" -> TextButton(enabled = busy == null, onClick = { run("Fetching details…", JSONObject().put("op", "details")) }) { Text("Fetch details") }
                else -> {}
            }
        },
        dismissButton = {
            TextButton(enabled = busy == null, onClick = { if (step == "menu") onDone(changed) else { step = "menu"; error = null } }) { Text(if (step == "menu") "Close" else "Back") }
        },
    )
}

/** The TMDB token, pasted on the phone.  The TV checks it with TMDB before saving it. */
@Composable
fun TmdbTokenDialog(model: AppModel, id: String, saved: Boolean, onDone: (changed: Boolean) -> Unit) {
    val scope = rememberCoroutineScope()
    var t by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun send(token: String) { busy = true; error = null; scope.launch { val (r, e) = myMedia(model, id, JSONObject().put("op", "token").put("token", token)); busy = false; if (r != null) onDone(true) else error = e } }
    AlertDialog(
        onDismissRequest = { if (!busy) onDone(false) }, containerColor = Panel,
        title = { Text(if (saved) "Replace TMDB token" else "Add TMDB token") },
        text = {
            Column {
                Text("Your own free API key or Read Access Token, from themoviedb.org/settings/api.  It gives My media its posters and details, and finds the movies on your channels.  The TV checks it, and keeps it out of backups.",
                    color = Muted, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.size(8.dp))
                OutlinedTextField(t, { t = it.trim() }, label = { Text("API key or Read Access Token") }, singleLine = true, enabled = !busy,
                    visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                error?.let { Text(it, color = Bad, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp)) }
                if (busy) Busy("Checking it with TMDB…")
            }
        },
        confirmButton = { TextButton(enabled = !busy && t.length >= 24, onClick = { send(t) }) { Text("Save") } },
        dismissButton = {
            Row {
                if (saved) TextButton(enabled = !busy, onClick = { send("") }) { Text("Remove", color = Bad) }
                TextButton(enabled = !busy, onClick = { onDone(false) }) { Text("Cancel") }
            }
        },
    )
}

/** Opens Dropbox's sign-in page in a Custom Tab (or the browser).  Dropbox sends the phone back to MainActivity. */
fun openDropbox(ctx: Context, model: AppModel, url: String) {
    val uri = Uri.parse(url)
    try { CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(ctx, uri) }
    catch (e: ActivityNotFoundException) {
        try { ctx.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        catch (e2: ActivityNotFoundException) { model.dropboxEnd(); model.say("There is no web browser on this phone to sign in to Dropbox with.") }
    }
}

/** What the TV said, in plain words (an older TiviBro on the TV doesn't know Dropbox yet). */
private fun dropboxError(m: String?): String {
    val t = m.orEmpty()
    return when {
        t.isBlank() -> "That didn't work.  Look at the TV for more."
        t.contains("Unknown My media request") -> "TiviBro on the TV is too old for Dropbox.  Update it, then try again."
        else -> t
    }
}

/** A Dropbox sign-in under way for [step]'s TV: waiting for the browser, finishing, or picking the folder
    (asked from the TV, op dbfolders: the TV reads Dropbox with the sign-in), then adding it (op adddropbox). */
@Composable
fun DropboxDialog(model: AppModel, step: DropboxStep, onDone: (added: Boolean) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var path by remember { mutableStateOf("") }               // "" = the whole Dropbox
    var folders by remember { mutableStateOf<List<Pair<String, String>>?>(null) }
    var account by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    val ready = step.stage == "ready"
    val here = if (path.isEmpty()) "Whole Dropbox" else path.substringAfterLast('/')

    LaunchedEffect(ready, path, attempt) {
        if (!ready) return@LaunchedEffect
        busy = "Asking the TV for your Dropbox folders…"; error = null; folders = null
        try {
            val r = model.dropboxFolders(step.tv, path)
            r.optString("account").takeIf { it.isNotBlank() }?.let { account = it }
            val a = r.optJSONArray("folders")
            folders = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { it.optString("name") to it.optString("path") }
        } catch (e: CancellationException) { throw e }
        catch (e: TbException) { error = dropboxError(e.message) }
        catch (e: Exception) { error = "The TV didn't answer.  Is it on, and on the same network?" }
        busy = null
    }
    fun add() {
        busy = "Adding " + (if (path.isEmpty()) "your whole Dropbox" else here) + ".  The TV looks through it, which takes a while for a big folder."; error = null
        scope.launch {
            try {
                val msg = model.dropboxAdd(step.tv, path, if (path.isEmpty()) "Dropbox" else here)
                if (msg.isNotBlank()) model.say(msg)
                model.dropboxEnd(); onDone(true)
            } catch (e: CancellationException) { throw e }
            catch (e: TbException) { error = dropboxError(e.message) }
            catch (e: Exception) { error = "The TV didn't answer.  Is it on, and on the same network?" }
            busy = null
        }
    }
    fun close() { model.dropboxEnd(); onDone(false) }

    AlertDialog(
        onDismissRequest = { if (busy == null && step.stage != "exchanging") close() }, containerColor = Panel,
        title = { Text(if (ready) here else "Dropbox") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                val err = error ?: step.error
                err?.let { Text(it, color = Bad, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 8.dp)) }
                when (step.stage) {
                    "waiting" -> Text("Sign in to Dropbox in the browser and allow TiviBro.  Dropbox then brings you back here to pick a folder.  TiviBro only reads your files: it never changes or deletes anything.",
                        color = Muted, style = MaterialTheme.typography.bodySmall)
                    "exchanging" -> Busy("Finishing the Dropbox sign-in…")
                    "failed" -> {}
                    else -> {
                        if (account.isNotBlank()) Text("Signed in as $account", color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 4.dp))
                        Text("Pick the folder with your movies and TV shows.  Subfolders are included.  The sign-in is kept on the TV, not on this phone.",
                            color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 6.dp))
                        if (busy != null) Busy(busy!!)
                        else {
                            if (path.isNotEmpty()) {
                                val up = path.substringBeforeLast('/', "")
                                Choice("Up", "Back to " + (if (up.isEmpty()) "the whole Dropbox" else up.substringAfterLast('/'))) { path = up }
                            }
                            val l = folders
                            when {
                                l == null -> if (error != null) TextButton(onClick = { attempt++ }) { Text("Try again") }
                                l.isEmpty() -> Text("No folders in here.", color = Muted, modifier = Modifier.padding(vertical = 8.dp))
                                else -> l.forEach { (name, p) -> Choice(name) { path = p } }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            when (step.stage) {
                "waiting" -> TextButton(onClick = { openDropbox(ctx, model, step.url) }) { Text("Open Dropbox again") }
                "failed" -> TextButton(onClick = { openDropbox(ctx, model, model.dropboxStart(step.tv)) }) { Text("Try again") }
                "ready" -> TextButton(enabled = busy == null && folders != null, onClick = { add() }) { Text("Use this folder") }
                else -> {}
            }
        },
        dismissButton = {
            TextButton(enabled = busy == null && step.stage != "exchanging", onClick = { close() }) { Text(if (step.stage == "failed") "Close" else "Cancel") }
        },
    )
}
