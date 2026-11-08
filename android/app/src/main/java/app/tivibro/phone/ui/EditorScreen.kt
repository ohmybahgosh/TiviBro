/* The TV's web editor full screen in a WebView, signed in with a one-time token from the TV, opened on
   the page asked for (a Settings row can open, say, Channel and group names).  Saves the files the
   editor makes (backups, problem reports) through a JavaScript bridge, opens the file picker for
   restores, and keeps Back inside the editor until its first page.  The same bridge (window.TiviBroApp,
   which the editor uses to tell it is inside the app) lets the editor send you to the phone's own
   screens: TiviBroApp.open('media' | 'backups' | 'reminders' | 'settings'). */
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
import app.tivibro.phone.proto.editorPageUrl

/* Saving files the editor makes (a backup, a problem report): the page builds them as blob: links, which
   a WebView can't download, so a small script hands them to the app, which asks where to save them. */
private const val HOOK = """(function(){if(window.__tb)return;window.__tb=1;
function send(a){fetch(a.href).then(function(r){return r.blob()}).then(function(b){var f=new FileReader();f.onload=function(){TiviBroApp.save(a.download||'tivibro-file',String(f.result))};f.readAsDataURL(b)})}
var oc=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download&&/^blob:/.test(this.href)){send(this);return}return oc.call(this)};
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[download]');if(a&&/^blob:/.test(a.href)){e.preventDefault();e.stopPropagation();send(a)}},true)})();"""

/* The editor's channel list, kept on the phone each time it loads with the TV (EditorCopies.kt), so a
   backup can be edited later without the TV (OfflineEditorScreen.kt).  Only when the channels change.
   Gzipped in the page and handed over in pieces of 384 KB, so a list of 186,000 channels gets through
   (one string that size did not).  The app says when it's saved, or why not. */
private const val KEEP = """(function(){if(window.__tbk)return;window.__tbk=1;var last='',busy=false,A=window.TiviBroApp;
function b64(u){var s='',i;for(i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));return btoa(s)}
function zip(t){if(!window.CompressionStream)return Promise.resolve(null);return new Response(new Blob([t]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer().then(function(b){return new Uint8Array(b)},function(){return null})}
function send(d){var t=JSON.stringify(d);return zip(t).then(function(gz){
var meta={pid:d.playlist.id,name:d.playlist.name||'',channels:d.channels.length,gz:!!gz};if(gz)t=null;
if(!A.keepStart(JSON.stringify(meta)))throw new Error('the phone did not take it');
var N=gz?393216:1048576,len=gz?gz.length:t.length,i;
for(i=0;i<len;i+=N){if(!A.keepPart(gz?b64(gz.subarray(i,i+N)):t.slice(i,i+N)))throw new Error('the phone is out of room')}
if(!A.keepEnd())throw new Error('it did not arrive whole')})}
setInterval(function(){var d=window.D,sig;try{if(busy||!d||!d.channels||!d.channels.length||!d.playlist||!A.keepStart)return;
sig=d.playlist.id+'|'+(d.chanRev||'')+'|'+d.channels.length;if(sig===last)return;last=sig;busy=true;
send(d).catch(function(e){A.keepFailed(String(e&&e.message||e))}).then(function(){busy=false})}catch(e){busy=false;A.keepFailed(String(e&&e.message||e))}},4000)})();"""

/** What the page hands the app.  [keeper] takes the editor's channel list in pieces (KEEP above). */
private class Bridge(val onSave: (String, ByteArray, String) -> Unit, val keeper: Keeper? = null, val onOpen: ((String) -> Unit)? = null) {
    private val main = android.os.Handler(android.os.Looper.getMainLooper())

    /** Leaves the editor for one of the phone's own screens.  Called on the web view's own thread: the
        screen change happens on the main thread. */
    @JavascriptInterface
    fun open(where: String) {
        val w = where.trim().lowercase()
        val go = onOpen ?: return
        if (w in OPENS) main.post { go(w) }
    }

    @JavascriptInterface fun keepStart(meta: String): Boolean = keeper?.begin(meta) ?: false
    @JavascriptInterface fun keepPart(chunk: String): Boolean = keeper?.part(chunk) ?: false
    @JavascriptInterface fun keepEnd(): Boolean = keeper?.end() ?: false
    @JavascriptInterface fun keepFailed(why: String) { keeper?.failed(why) }

    @JavascriptInterface
    fun save(name: String, dataUrl: String) {
        val comma = dataUrl.indexOf(',')
        if (!dataUrl.startsWith("data:") || comma < 0) return
        val mime = dataUrl.substring(5, comma).substringBefore(';').ifBlank { "application/octet-stream" }
        val bytes = runCatching { Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT) }.getOrNull() ?: return
        onSave(name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80), bytes, mime)
    }
}

/** The phone screens the editor can send you to (Bridge.open). */
private val OPENS = setOf("media", "backups", "reminders", "settings")

/** Where the editor's channel list goes (AppModel: EditorCopies for this TV). */
interface Keeper {
    fun begin(meta: String): Boolean
    fun part(chunk: String): Boolean
    fun end(): Boolean
    fun failed(why: String)
}

@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun EditorScreen(
    name: String, host: String, load: suspend ((String) -> Unit, Boolean) -> String, onBack: () -> Unit, say: (String) -> Unit, keeper: Keeper? = null,
    /** An editor page to open on (its id, such as "names"), or "" for the first page. */
    page: String = "",
    /** The editor asked for one of the phone's own screens: media, backups, reminders or settings. */
    onOpen: ((String) -> Unit)? = null,
) {
    val ctx = LocalContext.current
    var url by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf("Asking the TV for the editor…") }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    // TiviBro closed on the TV: it isn't opened just for the editor, only when you press Open TiviBro here.
    var closed by remember { mutableStateOf(false) }
    var openIt by remember { mutableStateOf(false) }
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
        error = null; url = null; status = "Asking the TV for the editor…"; closed = false
        val open = openIt; openIt = false
        try { url = editorPageUrl(load({ status = it }, open), page) } catch (e: TbException) { error = e.message; closed = e.code == "closed" } catch (e: Exception) { error = "$name didn't answer.  Is it on, and on the same network?" }
    }
    // Back closes what is open in the editor, then goes back through its pages (tbBack in the editor),
    // and only then leaves it.  An older TiviBro's editor has no tbBack: back leaves.
    BackHandler {
        val w = web
        if (w == null || url == null) onBack()
        else w.evaluateJavascript("(window.tbBack && window.tbBack()) ? 1 : 0") { r -> if (r?.trim() != "1") onBack() }
    }

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
                    if (closed) { Button(onClick = { openIt = true; attempt++ }) { Text("Open TiviBro on the TV") }; Spacer(Modifier.height(8.dp)) }
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
                            addJavascriptInterface(Bridge({ n, b, _ -> post { pendingSave = b; create.launch(n) } }, keeper, onOpen), "TiviBroApp")
                            webViewClient = object : WebViewClient() {
                                // The editor stays in the app; anything else (GitHub, the wiki) opens in the browser.
                                override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                                    val to = req.url
                                    if (to.scheme == "http" && to.host == host) return false
                                    runCatching { c.startActivity(Intent(Intent.ACTION_VIEW, to)) }
                                    return true
                                }
                                override fun onPageStarted(view: WebView, u2: String?, favicon: Bitmap?) { progress = 5 }
                                override fun onPageFinished(view: WebView, u2: String?) { progress = 100; view.evaluateJavascript(HOOK, null); if (keeper != null) view.evaluateJavascript(KEEP, null) }
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
                    if (progress in 1..99) LinearProgressIndicator(progress = { progress / 100f }, modifier = Modifier.align(Alignment.TopCenter).fillMaxWidth(), color = Accent, trackColor = Ink)
                }
            }
        }
    }
}
