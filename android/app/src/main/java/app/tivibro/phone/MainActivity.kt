/* The app's single activity: opens pairing links (tivibro://pair and https://tivibro.app/pair from the TV's
   QR code), takes a provider's link shared to TiviBro (Share, then TiviBro), runs the code scanner, starts
   the weekly backups, and moves between the screens (home, add a TV, type the code, one TV, the editor,
   adding a shared playlist, backups). */
package app.tivibro.phone

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import android.net.Uri
import app.tivibro.phone.ui.AddScreen
import app.tivibro.phone.ui.BackupsScreen
import app.tivibro.phone.ui.ShareScreen
import app.tivibro.phone.work.BackupWorker
import app.tivibro.phone.ui.AppModel
import app.tivibro.phone.ui.CodeScreen
import app.tivibro.phone.ui.EditorScreen
import app.tivibro.phone.ui.HomeScreen
import app.tivibro.phone.ui.TbTheme
import app.tivibro.phone.ui.TvScreen
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : ComponentActivity() {
    private val model: AppModel by viewModels()
    private val link = MutableStateFlow<String?>(null)
    private val shared = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handle(intent)
        runCatching { BackupWorker.schedule(this) }
        setContent { TbTheme { App(model, link, shared) } }
    }

    override fun onStop() { super.onStop(); android.util.Log.i("TiviBroBack", "stopped, finishing=$isFinishing") }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    // Opened by the TV's QR code scanned with the camera (https://tivibro.app/pair#...), or the button on that page (tivibro://pair?...).
    private fun handle(i: Intent?) {
        // A provider's link shared from an email, a message or a browser.
        if (i?.action == Intent.ACTION_SEND) { i.getStringExtra(Intent.EXTRA_TEXT)?.let { shared.value = it }; return }
        val d = i?.data ?: return
        if ((d.scheme == "tivibro" && d.host == "pair") || (d.scheme == "https" && d.host == "tivibro.app" && d.path == "/pair")) link.value = d.toString()
    }
}

private fun enc(s: String) = Uri.encode(s)

@Composable
private fun App(model: AppModel, link: MutableStateFlow<String?>, shared: MutableStateFlow<String?>) {
    val nav = rememberNavController()
    val snack = remember { SnackbarHostState() }
    val ctx = LocalContext.current
    val tvs by model.tvs.collectAsStateWithLifecycle()
    val pairing by model.pairing.collectAsStateWithLifecycle()
    val found by model.found.collectAsStateWithLifecycle()
    val pending by link.collectAsStateWithLifecycle()
    val share by shared.collectAsStateWithLifecycle()
    var shareText by remember { mutableStateOf("") }
    var tile by remember { mutableStateOf(model.tileTv) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    LaunchedEffect(Unit) { model.messages.collect { snack.showSnackbar(it) } }
    // While the app is on screen, keep every TV's state fresh; nothing runs in the background.
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) { model.refresh(); delay(15_000) }
        }
    }
    LaunchedEffect(pending) { pending?.let { model.pairWithLink(it); link.value = null } }
    LaunchedEffect(share) { share?.let { shareText = it; shared.value = null; nav.navigate("share") } }
    LaunchedEffect(pairing.done) {
        if (pairing.done != null) { nav.popBackStack("home", inclusive = false); model.resetPairing() }
    }

    fun scan() {
        val opts = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).enableAutoZoom().build()
        GmsBarcodeScanning.getClient(ctx, opts).startScan()
            .addOnSuccessListener { b -> model.pairWithLink(b.rawValue) }
            .addOnFailureListener { model.say("The code scanner isn't available on this phone.  Pick the TV from the list and type the code instead.") }
    }

    NavHost(nav, startDestination = "home") {
        composable("home") {
            HomeScreen(
                tvs = tvs, snack = snack, tileTv = tile,
                onRefresh = { model.refresh().join() },
                onAdd = { nav.navigate("add") },
                onScan = { scan() },
                onFind = { nav.navigate("add") },
                onEditor = { id -> nav.navigate("editor/$id") },
                onRemote = { id -> nav.navigate("tv/$id") },
                onOpen = { model.openTiviBro(it) },
                onWake = { model.wake(it) },
                onForget = { model.forget(it) },
                onTile = { model.tileTv = it; tile = it; model.say("The Quick Settings tile now opens TiviBro on this TV") },
                onRepair = { nav.navigate("add") },
                onBackups = { id -> nav.navigate("backups/$id") },
            )
        }
        composable("share") {
            ShareScreen(model, shareText, tvs, onBack = { nav.popBackStack() }, onPair = { nav.navigate("add") })
        }
        composable("backups/{id}") { e ->
            val id = e.arguments?.getString("id").orEmpty()
            BackupsScreen(model, id, tvs, snack, onBack = { nav.popBackStack() })
        }
        composable("add") {
            AddScreen(
                found = found, snack = snack,
                onBack = { nav.popBackStack() },
                onScan = { scan() },
                onSearch = { model.discover() },
                onPick = { host, port, id, name -> model.resetPairing(); nav.navigate("code?host=${enc(host)}&port=$port&id=${enc(id ?: "")}&name=${enc(name)}") },
                hello = { h, p -> model.helloAt(h, p).let { it.id to it.name } },
            )
        }
        composable(
            "code?host={host}&port={port}&id={id}&name={name}",
            arguments = listOf(
                navArgument("host") { type = NavType.StringType; defaultValue = "" },
                navArgument("port") { type = NavType.IntType; defaultValue = 47810 },
                navArgument("id") { type = NavType.StringType; defaultValue = "" },
                navArgument("name") { type = NavType.StringType; defaultValue = "TV" },
            ),
        ) { e ->
            val a = e.arguments
            val host = a?.getString("host").orEmpty()
            val port = a?.getInt("port") ?: 47810
            val id = a?.getString("id").orEmpty().ifBlank { null }
            CodeScreen(
                name = a?.getString("name") ?: "TV", busy = pairing.busy, error = pairing.error,
                onBack = { nav.popBackStack() },
                onPair = { code -> model.pair(host, port, code, id) },
            )
        }
        composable("tv/{id}") { e ->
            val id = e.arguments?.getString("id").orEmpty()
            val tv = model.tv(id)
            if (tv == null) { LaunchedEffect(Unit) { nav.popBackStack() }; return@composable }
            val now by model.nowState.collectAsStateWithLifecycle()
            val lineup by model.lineup.collectAsStateWithLifecycle()
            val note by model.lineupNote.collectAsStateWithLifecycle()
            val vol by model.volume.collectAsStateWithLifecycle()
            // What the TV shows, followed while this screen is on screen.
            LaunchedEffect(id, lifecycle) { lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { model.watchState(id) } }
            TvScreen(
                model = model, id = id,
                name = tv.name, state = now, lineup = lineup, lineupNote = note, volume = vol, snack = snack,
                onBack = { nav.popBackStack() },
                onKey = { model.key(id, it) }, onAction = { model.action(id, it) }, onText = { model.text(id, it) },
                onVolume = { model.volume(id, it) },
                onPlay = { c -> model.playOnTv(id, c.k, c.name) },
                onOpen = { model.openTiviBro(id) },
                onLoadLineup = { force -> model.loadLineup(id, force) },
                onFav = { c, on -> model.favorite(id, c.k, on) },
                onType = { inp, value, submit -> model.typeInto(id, inp.id, value, submit) },
            )
        }
        composable("editor/{id}") { e ->
            val id = e.arguments?.getString("id").orEmpty()
            val tv = model.tv(id)
            if (tv == null) { LaunchedEffect(Unit) { nav.popBackStack() }; return@composable }
            EditorScreen(name = tv.name, host = tv.host, load = { progress -> model.editorUrl(id, progress) }, onBack = { nav.popBackStack() }, say = { model.say(it) })
        }
    }
}
