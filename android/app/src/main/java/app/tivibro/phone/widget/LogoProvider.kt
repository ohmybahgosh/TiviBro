/* Team logos for the Sports widget, handed to the launcher by address (content://app.tivibro.phone.logos/<name>.png)
   instead of as pictures inside the widget's update.  On a Pixel the launcher kept a list row's old picture when the
   row was reused for another game (every game's card showed the first Spotlight's logos); an address is loaded each
   time it changes, and each team has its own.  Read-only, and only the logo files SportsWidgetWorker keeps (public
   team logos from ESPN), so it's open to the launcher without a grant. */
package app.tivibro.phone.widget

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileNotFoundException

class LogoProvider : ContentProvider() {
    override fun onCreate() = true

    // Only "<40 hex>.png" in the logo folder: nothing else on the phone can be asked for.
    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw FileNotFoundException("read only")
        val name = uri.lastPathSegment.orEmpty()
        if (!NAME.matches(name)) throw FileNotFoundException(name)
        val f = File(File(context!!.filesDir, SportsWidgetWorker.LOGO_DIR), name)
        if (!f.exists()) throw FileNotFoundException(name)
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)
    }
    override fun getType(uri: Uri) = "image/png"
    override fun query(uri: Uri, p: Array<out String>?, s: String?, a: Array<out String>?, o: String?): Cursor? = null
    override fun insert(uri: Uri, v: ContentValues?): Uri? = null
    override fun delete(uri: Uri, s: String?, a: Array<out String>?) = 0
    override fun update(uri: Uri, v: ContentValues?, s: String?, a: Array<out String>?) = 0

    companion object {
        const val AUTHORITY = "app.tivibro.phone.logos"
        private val NAME = Regex("^[0-9a-f]{40}\\.png$")
        /** The address of a logo file kept by SportsWidgetWorker. */
        fun uri(f: File): Uri = Uri.parse("content://$AUTHORITY/${f.name}")
    }
}
