package app.tivibro.phone.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation

/** A password, passphrase or key: a password keyboard (no suggestions, no autocorrect, no space added after a
    word), one line (a line break typed or pasted is dropped), the whole width of its dialog, and an eye to show
    or hide what was typed.  [note] goes under the box, so a long hint never runs out of it. */
@Composable
fun SecretField(
    value: String, onValueChange: (String) -> Unit, label: String, modifier: Modifier = Modifier,
    note: String? = null, error: String? = null, enabled: Boolean = true, last: Boolean = true, onDone: (() -> Unit)? = null,
) {
    var shown by rememberSaveable { mutableStateOf(false) }
    OutlinedTextField(
        value = value, onValueChange = { onValueChange(it.replace("\r", "").replace("\n", "")) },
        label = { Text(label) }, singleLine = true, enabled = enabled,
        isError = error != null,
        supportingText = if (error != null || note != null) ({ Text(error ?: note ?: "") }) else null,
        visualTransformation = if (shown) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false, imeAction = if (last) ImeAction.Done else ImeAction.Next),
        keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }),
        trailingIcon = { IconButton(onClick = { shown = !shown }) { Icon(if (shown) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility, if (shown) "Hide" else "Show") } },
        modifier = modifier.fillMaxWidth(),
    )
}

/** A new passphrase for a backup file: typed twice, at least 8 characters (passphraseOk says when it's ready). */
@Composable
fun NewPassphrase(pass: String, onPass: (String) -> Unit, again: String, onAgain: (String) -> Unit) {
    SecretField(pass, onPass, "Passphrase", note = "8 or more characters", error = if (pass.isNotEmpty() && pass.length < 8) "At least 8 characters" else null, last = false)
    SecretField(again, onAgain, "Type it again", error = if (again.isNotEmpty() && again != pass) "Doesn't match" else null,
        note = if (again.isNotEmpty() && again == pass && pass.length >= 8) "They match" else null)
}

fun passphraseOk(pass: String, again: String) = pass.length >= 8 && pass == again
