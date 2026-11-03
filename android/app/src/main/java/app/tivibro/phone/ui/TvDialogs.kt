/* A question TiviBro on the TV would have shown on its own screen (a box to type in, a menu, an "are you
   sure"), asked here on the phone instead, so nothing needs answering on the TV.  The answer goes back to
   the TV (op "answer" in SettingsTab.kt), which may ask the next one (a username, then a password). */
package app.tivibro.phone.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import app.tivibro.phone.proto.TvDialog
import org.json.JSONObject

/** Shows [d] and hands its answer (TvDialog.answer / choose / yes / cancel) to [onAnswer]. */
@Composable
fun TvQuestion(d: TvDialog, onAnswer: (JSONObject) -> Unit) {
    when (d.kind) {
        "prompt" -> PromptQuestion(d, onAnswer)
        "menu" -> MenuQuestion(d, onAnswer)
        else -> AlertDialog(
            onDismissRequest = { onAnswer(d.cancel()) }, containerColor = Panel,
            title = { Text(d.title.ifBlank { "Are you sure?" }) },
            confirmButton = { TextButton(onClick = { onAnswer(d.yes()) }) { Text(d.ok.ifBlank { "OK" }) } },
            dismissButton = { TextButton(onClick = { onAnswer(d.cancel()) }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun PromptQuestion(d: TvDialog, onAnswer: (JSONObject) -> Unit) {
    var t by remember(d.id) { mutableStateOf(d.value) }
    var see by remember(d.id) { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { onAnswer(d.cancel()) }, containerColor = Panel,
        title = { Text(d.title.ifBlank { "Type it here" }) },
        text = {
            OutlinedTextField(
                value = t, onValueChange = { t = it.take(4000) }, singleLine = true,
                placeholder = if (d.hint.isNotBlank()) ({ Text(d.hint) }) else null,
                visualTransformation = if (d.secret && !see) PasswordVisualTransformation() else VisualTransformation.None,
                keyboardOptions = KeyboardOptions(keyboardType = if (d.secret) KeyboardType.Password else KeyboardType.Text, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { onAnswer(d.answer(t)) }),
                trailingIcon = if (d.secret) ({ IconButton(onClick = { see = !see }) { Icon(if (see) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility, if (see) "Hide" else "Show") } }) else null,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = { TextButton(onClick = { onAnswer(d.answer(t)) }) { Text(d.ok.ifBlank { "OK" }) } },
        dismissButton = { TextButton(onClick = { onAnswer(d.cancel()) }) { Text("Cancel") } },
    )
}

@Composable
private fun MenuQuestion(d: TvDialog, onAnswer: (JSONObject) -> Unit) {
    AlertDialog(
        onDismissRequest = { onAnswer(d.cancel()) }, containerColor = Panel,
        title = { Text(d.title.ifBlank { "Choose one" }) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                if (d.items.isEmpty()) Text("Nothing to choose from.", color = Muted)
                d.items.forEachIndexed { n, item ->
                    Row(Modifier.fillMaxWidth().clickable { onAnswer(d.choose(n)) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (item.current) Icon(Icons.Rounded.Check, "Current", tint = Accent, modifier = Modifier.size(20.dp)) else Spacer(Modifier.size(20.dp))
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(item.label, color = if (item.current) Accent else TextHi, fontWeight = if (item.current) FontWeight.SemiBold else FontWeight.Normal)
                            if (item.sub.isNotBlank()) Text(item.sub, color = Muted, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    if (n < d.items.lastIndex) HorizontalDivider(color = Line.copy(alpha = 0.35f), thickness = 0.5.dp)
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = { onAnswer(d.cancel()) }) { Text("Cancel") } },
    )
}
