package app.tivibro.phone.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.LinkOff
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.PowerSettingsNew
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Tv
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.tivibro.phone.R
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    tvs: List<TvUi>,
    snack: SnackbarHostState,
    tileTv: String?,
    onRefresh: suspend () -> Unit,
    onAdd: () -> Unit,
    onScan: () -> Unit,
    onFind: () -> Unit,
    onEditor: (String) -> Unit,
    onOpen: (String) -> Unit,
    onWake: (String) -> Unit,
    onForget: (String) -> Unit,
    onTile: (String) -> Unit,
    onRepair: (String) -> Unit,
) {
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Scaffold(
        containerColor = Ink,
        topBar = {
            CenterAlignedTopAppBar(
                title = { Image(painterResource(R.drawable.wordmark), contentDescription = "TiviBro", modifier = Modifier.height(26.dp)) },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = Ink),
            )
        },
        floatingActionButton = {
            if (tvs.isNotEmpty()) ExtendedFloatingActionButton(onClick = onAdd, icon = { Icon(Icons.Rounded.Add, null) }, text = { Text("Add a TV") })
        },
        snackbarHost = { SnackbarHost(snack) },
    ) { pad ->
        if (tvs.isEmpty()) {
            Empty(Modifier.padding(pad), onScan, onFind)
            return@Scaffold
        }
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { scope.launch { refreshing = true; onRefresh(); delay(400); refreshing = false } },
            modifier = Modifier.padding(pad).fillMaxSize(),
        ) {
            LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.fillMaxSize()) {
                items(tvs, key = { it.tv.id }) { u ->
                    TvCard(u, isTile = tileTv == u.tv.id && tvs.size > 1, onEditor, onOpen, onWake, onForget, onTile, onRepair)
                }
            }
        }
    }
}

@Composable
private fun Empty(modifier: Modifier, onScan: () -> Unit, onFind: () -> Unit) {
    Column(modifier.fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Box(Modifier.size(96.dp).clip(CircleShape).background(Panel2), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.Tv, null, tint = Accent2, modifier = Modifier.size(48.dp))
        }
        Spacer(Modifier.height(24.dp))
        Text("Pair your TV", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(10.dp))
        Text(
            "On the TV, open TiviBro and go to Settings, Phone app.  Switch on the connection, then choose Pair a phone.",
            style = MaterialTheme.typography.bodyLarge, color = Muted, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(28.dp))
        Button(onClick = onScan, modifier = Modifier.fillMaxWidth().height(54.dp)) {
            Icon(Icons.Rounded.QrCodeScanner, null); Spacer(Modifier.width(10.dp)); Text("Scan the code on the TV")
        }
        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = onFind, modifier = Modifier.fillMaxWidth().height(54.dp)) {
            Icon(Icons.Rounded.Search, null); Spacer(Modifier.width(10.dp)); Text("Find TVs on this network")
        }
    }
}

@Composable
private fun TvCard(
    u: TvUi, isTile: Boolean,
    onEditor: (String) -> Unit, onOpen: (String) -> Unit, onWake: (String) -> Unit,
    onForget: (String) -> Unit, onTile: (String) -> Unit, onRepair: (String) -> Unit,
) {
    val tv = u.tv
    var menu by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    val (dot, status) = when (u.power) {
        Power.CHECKING -> Muted to "Checking…"
        Power.WAKING -> Accent2 to "Turning on…"
        Power.ON -> Good to (if (u.tivibroOpen) "On · TiviBro open" else "On")
        Power.OFF -> Muted to "Off or not reachable"
        Power.UNPAIRED -> Bad to "This TV no longer knows this phone"
    }
    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Panel), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(48.dp).clip(CircleShape).background(Panel2), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Tv, null, tint = if (u.power == Power.ON) Accent2 else Muted)
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(tv.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(dot))
                        Spacer(Modifier.width(6.dp))
                        Text(listOfNotNull(status, tv.model.ifBlank { null }).joinToString("  ·  "), style = MaterialTheme.typography.bodySmall, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (isTile) Text("Quick Settings tile", style = MaterialTheme.typography.labelSmall, color = Accent2)
                }
                if (u.busy != null || u.power == Power.WAKING || u.power == Power.CHECKING) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, "More") }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        if (tv.mac.isNotBlank()) DropdownMenuItem(text = { Text("Turn on") }, leadingIcon = { Icon(Icons.Rounded.PowerSettingsNew, null) }, onClick = { menu = false; onWake(tv.id) })
                        DropdownMenuItem(text = { Text("Use for the Quick Settings tile") }, leadingIcon = { Icon(Icons.Rounded.Tv, null) }, onClick = { menu = false; onTile(tv.id) })
                        DropdownMenuItem(text = { Text("Forget this TV") }, leadingIcon = { Icon(Icons.Rounded.LinkOff, null) }, onClick = { menu = false; confirm = true })
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            when (u.power) {
                Power.UNPAIRED -> Button(onClick = { onRepair(tv.id) }, modifier = Modifier.fillMaxWidth()) { Text("Pair again") }
                Power.OFF -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (tv.mac.isNotBlank()) Button(onClick = { onWake(tv.id) }, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Rounded.PowerSettingsNew, null); Spacer(Modifier.width(8.dp)); Text("Turn on")
                    }
                    OutlinedButton(onClick = { onEditor(tv.id) }, modifier = Modifier.weight(1f)) { Text("Try anyway") }
                }
                else -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(onClick = { onEditor(tv.id) }, enabled = u.power == Power.ON, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Rounded.Edit, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("Edit channels", maxLines = 1)
                    }
                    FilledTonalButton(onClick = { onOpen(tv.id) }, enabled = u.power == Power.ON && u.busy == null, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Rounded.PlayArrow, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text(if (u.tivibroOpen) "Bring to front" else "Open TiviBro", maxLines = 1)
                    }
                }
            }
        }
    }
    if (confirm) AlertDialog(
        onDismissRequest = { confirm = false },
        title = { Text("Forget ${tv.name}?") },
        text = { Text("This phone is removed from the TV too.  You can pair again any time.") },
        confirmButton = { TextButton(onClick = { confirm = false; onForget(tv.id) }) { Text("Forget", color = Bad) } },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
        containerColor = Panel,
    )
}

