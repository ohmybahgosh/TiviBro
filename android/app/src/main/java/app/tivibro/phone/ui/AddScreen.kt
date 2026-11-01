/* Adding a TV: scan the QR code, pick a TV found on the network, or type its address; then CodeScreen,
   where the 12-character code from the TV is typed. */
package app.tivibro.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Tv
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.tivibro.phone.proto.Crypto
import app.tivibro.phone.proto.Found
import app.tivibro.phone.proto.TbException
import app.tivibro.phone.proto.splitHostPort
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Bar(title: String, onBack: () -> Unit, actions: @Composable () -> Unit = {}) {
    TopAppBar(
        title = { Text(title) },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") } },
        actions = { actions() },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = Ink),
    )
}

/** Add a TV: scan the code, pick a TV found on the network, or type its address. */
@Composable
fun AddScreen(
    found: List<Found>?,
    snack: SnackbarHostState,
    onBack: () -> Unit,
    onScan: () -> Unit,
    onSearch: () -> Unit,
    onPick: (host: String, port: Int, id: String?, name: String) -> Unit,
    hello: suspend (String, Int) -> Pair<String, String>,
) {
    var manual by remember { mutableStateOf(false) }
    var addr by remember { mutableStateOf("") }
    var addrErr by remember { mutableStateOf<String?>(null) }
    var checking by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { onSearch() }
    Scaffold(containerColor = Ink, topBar = { Bar("Add a TV", onBack) }, snackbarHost = { SnackbarHost(snack) }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp).imePadding()) {
            Text("On the TV, open TiviBro: Settings, Phone app, Pair a phone.", color = Muted, style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(20.dp))
            Button(onClick = onScan, modifier = Modifier.fillMaxWidth().height(56.dp)) {
                Icon(Icons.Rounded.QrCodeScanner, null); Spacer(Modifier.width(10.dp)); Text("Scan the code on the TV")
            }
            Spacer(Modifier.height(28.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("TVs on this network", style = MaterialTheme.typography.titleSmall, color = Muted, modifier = Modifier.weight(1f))
                if (found == null) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else IconButton(onClick = onSearch) { Icon(Icons.Rounded.Refresh, "Search again") }
            }
            Spacer(Modifier.height(6.dp))
            Surface(color = Panel, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
                Column {
                    when {
                        found == null -> Text("Looking…", color = Muted, modifier = Modifier.padding(18.dp))
                        found.isEmpty() -> Text("No TV answered.  Check that the TV is on, TiviBro's phone app connection is on, and the phone is on the same Wi-Fi.", color = Muted, modifier = Modifier.padding(18.dp))
                        else -> found.forEachIndexed { i, f ->
                            if (i > 0) HorizontalDivider(color = Line)
                            Row(Modifier.fillMaxWidth().clickable { onPick(f.host, f.port, f.id, f.name) }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(40.dp).clip(CircleShape).background(Panel2), contentAlignment = Alignment.Center) { Icon(Icons.Rounded.Tv, null, tint = Accent2) }
                                Spacer(Modifier.width(14.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(f.name, fontWeight = FontWeight.SemiBold)
                                    Text(f.host + (if (f.version.isNotBlank()) "  ·  TiviBro " + f.version else ""), color = Muted, style = MaterialTheme.typography.bodySmall)
                                }
                                Icon(Icons.Rounded.ChevronRight, null, tint = Muted)
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(20.dp))
            if (!manual) TextButton(onClick = { manual = true }) { Text("Enter the TV's address instead") }
            else {
                OutlinedTextField(
                    value = addr, onValueChange = { addr = it.trim(); addrErr = null }, singleLine = true,
                    label = { Text("TV address, like 192.168.1.20") }, isError = addrErr != null,
                    supportingText = { Text(addrErr ?: "Shown on the TV under Settings, Phone app, Address") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Button(enabled = !checking && addr.isNotBlank(), onClick = {
                    val hp = splitHostPort(addr)
                    if (hp == null) { addrErr = "That doesn't look like an address."; return@Button }
                    checking = true
                    scope.launch {
                        try { val (id, name) = hello(hp.first, hp.second); onPick(hp.first, hp.second, id, name) }
                        catch (e: TbException) { addrErr = e.message }
                        catch (e: Exception) { addrErr = "No TiviBro answered at ${hp.first}." }
                        checking = false
                    }
                }, modifier = Modifier.fillMaxWidth()) { Text(if (checking) "Checking…" else "Next") }
            }
        }
    }
}

/** Type the code shown on the TV. */
@Composable
fun CodeScreen(name: String, busy: Boolean, error: String?, onBack: () -> Unit, onPair: (String) -> Unit) {
    var v by remember { mutableStateOf(TextFieldValue("")) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    val code = Crypto.normCode(v.text)
    Scaffold(containerColor = Ink, topBar = { Bar("Pair with $name", onBack) }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().padding(24.dp).imePadding(), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Type the code shown on the TV.  It is under Settings, Phone app, Pair a phone.", color = Muted, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(28.dp))
            OutlinedTextField(
                value = v,
                onValueChange = { n ->
                    val c = Crypto.normCode(n.text).take(12)
                    val shown = Crypto.showCode(c)
                    v = TextFieldValue(shown, TextRange(shown.length))
                },
                singleLine = true,
                textStyle = MaterialTheme.typography.headlineSmall.copy(fontFamily = FontFamily.Monospace, letterSpacing = 2.sp, textAlign = TextAlign.Center),
                placeholder = { Text("XXXX-XXXX-XXXX", style = MaterialTheme.typography.headlineSmall.copy(fontFamily = FontFamily.Monospace, letterSpacing = 2.sp), color = Line, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, keyboardType = KeyboardType.Ascii, autoCorrectEnabled = false, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (code.length == 12 && !busy) onPair(code) }),
                isError = error != null,
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
            )
            if (error != null) { Spacer(Modifier.height(10.dp)); Text(error, color = Bad, textAlign = TextAlign.Center) }
            Spacer(Modifier.height(24.dp))
            Button(onClick = { onPair(code) }, enabled = code.length == 12 && !busy, modifier = Modifier.fillMaxWidth().height(54.dp)) {
                if (busy) { CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = TextHi); Spacer(Modifier.width(10.dp)); Text("Pairing…") } else Text("Pair")
            }
            Spacer(Modifier.height(16.dp))
            Text("The code never leaves this phone: it only proves to the TV that you can see its screen.", color = Muted, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
        }
    }
}
