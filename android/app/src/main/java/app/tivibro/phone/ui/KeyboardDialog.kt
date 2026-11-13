/* The dialogs with boxes to type in (Add a playlist, a TV's question, a backup's passphrase…): the same Material
   AlertDialog, but the keyboard pushes it up instead of covering the box being typed in (discussion #83: the
   Guide URL and Stalker serial at the bottom of Add a playlist were under the keyboard).  The app draws edge to
   edge, so the window doesn't shrink for the keyboard by itself: the dialog takes the whole window
   (decorFitsSystemWindows = false) and keeps clear of the keyboard with imePadding, and its scrolling text area
   then brings the focused box into view.  Files with text fields use this by not importing Material's AlertDialog
   (this one, in their package, is found instead). */
package app.tivibro.phone.ui

import androidx.compose.foundation.layout.imePadding
import androidx.compose.material3.AlertDialogDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.window.DialogProperties

@Composable
fun AlertDialog(
    onDismissRequest: () -> Unit,
    confirmButton: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    dismissButton: (@Composable () -> Unit)? = null,
    icon: (@Composable () -> Unit)? = null,
    title: (@Composable () -> Unit)? = null,
    text: (@Composable () -> Unit)? = null,
    shape: Shape = AlertDialogDefaults.shape,
    containerColor: Color = AlertDialogDefaults.containerColor,
    properties: DialogProperties = DialogProperties(),
) = androidx.compose.material3.AlertDialog(
    onDismissRequest = onDismissRequest,
    confirmButton = confirmButton,
    modifier = modifier.imePadding(),
    dismissButton = dismissButton,
    icon = icon,
    title = title,
    text = text,
    shape = shape,
    containerColor = containerColor,
    properties = DialogProperties(
        dismissOnBackPress = properties.dismissOnBackPress,
        dismissOnClickOutside = properties.dismissOnClickOutside,
        securePolicy = properties.securePolicy,
        usePlatformDefaultWidth = properties.usePlatformDefaultWidth,
        decorFitsSystemWindows = false,
    ),
)
