/* The TV's web editor full screen in a WebView, signed in with a one-time token from the TV.  Saves the
   files the editor makes (backups, problem reports) through a JavaScript bridge, opens the file picker
   for restores, and keeps Back inside the editor until its first page. */
package app.tivibro.phone.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.util.Base64
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import app.tivibro.phone.proto.TbException

/* Saving files the editor makes (a backup, a problem report): the page builds them as blob: links, which
   a WebView can't download, so a small script hands them to the app, which asks where to save them. */
private const val HOOK = """(function(){if(window.__tb)return;window.__tb=1;
function send(a){fetch(a.href).then(function(r){return r.blob()}).then(function(b){var f=new FileReader();f.onload=function(){TiviBroApp.save(a.download||'tivibro-file',String(f.result))};f.readAsDataURL(b)})}
var oc=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download&&/^blob:/.test(this.href)){send(this);return}return oc.call(this)};
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[download]');if(a&&/^blob:/.test(a.href)){e.preventDefault();e.stopPropagation();send(a)}},true)})();"""

private class Bridge(val onSave: (String, ByteArray, String) -> Unit) {
    @JavascriptInterface
    fun save(name: String, dataUrl: String) {
        val comma = dataUrl.indexOf(',')
        if (!dataUrl.startsWith("data:") || comma < 0) return
        val mime = dataUrl.substring(5, comma).substringBefore(';').ifBlank { "application/octet-stream" }
        val bytes = runCatching { Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT) }.getOrNull() ?: return
        onSave(name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80), bytes, mime)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun EditorScreen(name: String, host: String, load: suspend ((String) -> Unit) -> String, onBack: () -> Unit, say: (String) -> Unit) {
    val ctx = LocalContext.current
    var url by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf("Asking the TV for the editor…") }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var progress by remember { mutableIntStateOf(0) }
    var web by remember { mutableStateOf<WebView?>(null) }
    var pendingFile by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    var pendingSave by remember { mutableStateOf<ByteArray?>(null) }

    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        pendingFile?.onReceiveValue(if (uri != null) arrayOf(uri) else null); pendingFile = null
    }
    val create = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val bytes = pendingSave; pendingSave = null
        if (uri != null && bytes != null) {
            val ok = runCatching { ctx.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } }.isSuccess
            say(if (ok) "Saved" else "Couldn't save the file")
        }
    }

    LaunchedEffect(attempt) {
        error = null; url = null; status = "Asking the TV for the editor…"
        try { url = load { status = it } } catch (e: TbException) { error = e.message } catch (e: Exception) { error = "$name didn't answer.  Is it on, and on the same network?" }
    }
    // Back leaves the editor (its pages are sections of one page, picked from its own menu).
    BackHandler { android.util.Log.i("TiviBroBack", "Back in the editor: to the TV list"); onBack() }

    Scaffold(
        containerColor = Ink,
        topBar = {
            TopAppBar(
                title = { Text(name) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") } },
                actions = { IconButton(onClick = { if (web != null && url != null) web?.reload() else attempt++ }) { Icon(Icons.Rounded.Refresh, "Reload") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Ink),
            )
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            val u = url
            when {
                error != null -> Column(Modifier.fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text(error ?: "", textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyLarge)
                    Spacer(Modifier.height(20.dp))
                    Button(onClick = { attempt++ }) { Text("Try again") }
                }
                u == null -> Column(Modifier.fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    CircularProgressIndicator()
                    Spacer(Modifier.height(20.dp))
                    Text(status, color = Muted, textAlign = TextAlign.Center)
                }
                else -> {
                    AndroidView(modifier = Modifier.fillMaxSize(), onRelease = { w ->
                        // Leaving the editor: let go of the page cleanly before the web view goes.
                        web = null
                        w.stopLoading(); w.webChromeClient = null; w.removeJavascriptInterface("TiviBroApp")
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
                            settings.setSupportMultipleWindows(false)
                            addJavascriptInterface(Bridge { n, b, _ -> post { pendingSave = b; create.launch(n) } }, "TiviBroApp")
                            webViewClient = object : WebViewClient() {
                                // The editor stays in the app; anything else (GitHub, the wiki) opens in the browser.
                                override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                                    val to = req.url
                                    if (to.scheme == "http" && to.host == host) return false
                                    runCatching { c.startActivity(Intent(Intent.ACTION_VIEW, to)) }
                                    return true
                                }
                                override fun onPageStarted(view: WebView, u2: String?, favicon: Bitmap?) { progress = 5 }
                                override fun onPageFinished(view: WebView, u2: String?) { progress = 100; view.evaluateJavascript(HOOK, null) }
                            }
                            webChromeClient = object : WebChromeClient() {
                                override fun onProgressChanged(view: WebView, p: Int) { progress = p }
                                override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
                                    pendingFile?.onReceiveValue(null)
                                    pendingFile = cb
                                    runCatching { pick.launch(arrayOf("*/*")) }.onFailure { pendingFile = null; cb.onReceiveValue(null) }
                                    return true
                                }
                            }
                            loadUrl(u)
                            web = this
                        }
                    })
                    if (progress in 1..99) LinearProgressIndicator(progress = { progress / 100f }, modifier = Modifier.align(Alignment.TopCenter).fillMaxWidth(), color = Accent2, trackColor = Ink)
                }
            }
        }
    }
}
