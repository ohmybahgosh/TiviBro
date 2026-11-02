/* A backup's channels in the web editor, on the phone, without the TV (discussion #23).  The editor
   comes from the app's own copy (service/editor, put in the APK's assets when it is built), with
   assets/offline.js standing in for the TV: it reads the channel list kept the last time the editor was
   open with this TV (EditorCopies.kt) and the backup's own edits, and Save hands the edits back here.
   Leaving with saved changes asks whether to keep them as a new backup, which can then be restored on
   the TV like any other.  Nothing reaches the network: the page is served from inside the app. */
package app.tivibro.phone.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Column
import java.io.ByteArrayInputStream

private const val ORIGIN = "tivibro.offline"

/** What the page asks the app for: the editor's data with the backup's edits, and Save. */
private class OfflineBridge(val tvId: String, val read: () -> String, val onSave: (String) -> Unit) {
    @JavascriptInterface fun state(): String = read()
    @JavascriptInterface fun save(json: String): Boolean { onSave(json); return true }
    @JavascriptInterface fun id(): String = tvId
}

@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun OfflineEditorScreen(title: String, tvId: String, state: () -> String, onKeep: (String, String) -> Unit, onBack: () -> Unit) {
    var saved by remember { mutableStateOf<String?>(null) }
    var asking by remember { mutableStateOf(false) }
    var label by remember { mutableStateOf("Edited on the phone") }
    var web by remember { mutableStateOf<WebView?>(null) }

    fun leave() { if (saved != null) asking = true else onBack() }
    BackHandler {
        val w = web
        if (w == null) leave()
        else w.evaluateJavascript("(window.tbBack && window.tbBack()) ? 1 : 0") { r -> if (r?.trim() != "1") leave() }
    }

    Scaffold(
        containerColor = Ink,
        topBar = {
            TopAppBar(title = { Text(title) }, navigationIcon = { IconButton(onClick = { leave() }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") } },
                actions = { if (saved != null) TextButton(onClick = { asking = true }) { Text("Keep") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Ink))
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            AndroidView(modifier = Modifier.fillMaxSize(), onRelease = { w ->
                web = null
                w.stopLoading(); w.removeJavascriptInterface("TiviBroOffline")
                (w.parent as? ViewGroup)?.removeView(w)
                w.destroy()
            }, factory = { c ->
                WebView(c).apply {
                    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                    setBackgroundColor(Ink.toArgb())
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    addJavascriptInterface(OfflineBridge(tvId, state) { j -> post { saved = j } }, "TiviBroOffline")
                    webViewClient = object : WebViewClient() {
                        // The editor's own files, from the app; offline.js goes in first.  Nothing else loads.
                        override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? {
                            val u = req.url
                            if (u.host != ORIGIN) return WebResourceResponse("text/plain", "utf-8", 404, "Not here", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                            val path = (u.path ?: "/").trimStart('/').ifBlank { "index.html" }
                            if (path.contains("..")) return null
                            return runCatching {
                                val a = view.context.assets
                                var bytes = a.open("editor/$path").use { it.readBytes() }
                                if (path == "index.html") {
                                    val shim = a.open("offline.js").use { String(it.readBytes(), Charsets.UTF_8) }.replace("</script", "<\\/script")
                                    bytes = String(bytes, Charsets.UTF_8).replaceFirst("<script", "<script>$shim</script><script").toByteArray(Charsets.UTF_8)
                                }
                                val mime = when (path.substringAfterLast('.')) { "html" -> "text/html"; "js" -> "text/javascript"; "png" -> "image/png"; "svg" -> "image/svg+xml"; "css" -> "text/css"; else -> "application/octet-stream" }
                                WebResourceResponse(mime, "utf-8", ByteArrayInputStream(bytes))
                            }.getOrElse { WebResourceResponse("text/plain", "utf-8", 404, "Not found", emptyMap(), ByteArrayInputStream(ByteArray(0))) }
                        }
                        override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                            if (req.url.host == ORIGIN) return false
                            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, req.url)) }
                            return true
                        }
                    }
                    // Signed in the way the phone app opens the TV's editor (#t=…), here with no TV to ask.
                    loadUrl("https://$ORIGIN/#t=" + "0".repeat(48) + "/home")
                    web = this
                }
            })
        }
    }

    if (asking) {
        AlertDialog(
            onDismissRequest = { asking = false }, containerColor = Panel,
            title = { Text("Keep your changes as a new backup?") },
            text = {
                Column {
                    Text("The backup you opened stays as it was.  Restore the new one on the TV from Backups when you're ready.", color = Muted, style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(label, { label = it.take(80) }, singleLine = true, label = { Text("Name") }, modifier = Modifier.padding(top = 12.dp))
                }
            },
            confirmButton = { TextButton(onClick = { asking = false; saved?.let { onKeep(it, label) }; saved = null; onBack() }) { Text("Keep") } },
            dismissButton = {
                Column {
                    TextButton(onClick = { asking = false; saved = null; onBack() }) { Text("Throw away", color = Bad) }
                    TextButton(onClick = { asking = false }) { Text("Keep editing") }
                }
            },
        )
    }
}
