/* The Sports widget drawn as a launcher draws it (Robolectric): the widget's own views from SportsWidget.draw, and
   its list rows from SportsWidgetService applied to real views, including a row reused for another game the way a
   launcher's list recycles them.  A game's card lives in the list (the title bar stays put), and every game shows
   its own logos, loaded by address from LogoProvider. */
package app.tivibro.phone

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.BitmapDrawable
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import app.tivibro.phone.widget.Cache
import app.tivibro.phone.widget.DetailOpen
import app.tivibro.phone.widget.SportsWidget
import app.tivibro.phone.widget.SportsWidgetService
import app.tivibro.phone.widget.SportsWidgetWorker
import app.tivibro.phone.widget.WGame
import app.tivibro.phone.widget.WTeam
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
// Android 8.1: Robolectric can't decode an image by address (ImageDecoder) on newer ones; the phone does.
@Config(sdk = [27])
class WidgetRenderTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val wm = AppWidgetManager.getInstance(ctx)
    // Each team's logo a different solid colour, so a view shows whose logo it has.
    private val colours = mapOf("ARK" to Color.RED, "MSU" to Color.GREEN, "DET" to Color.BLUE, "CBJ" to Color.YELLOW)
    private fun team(abbr: String, name: String, mine: Boolean, id: String = "") =
        WTeam(abbr, name, "https://logo.test/$abbr.png", null, mine, id, "333333", "", abbr)
    private val msu = WGame("1", "ncaab", System.currentTimeMillis() - 3_600_000, "in", "15:32 - 2nd", team("ARK", "Arkansas", false), team("MSU", "Michigan St", true, "ncaab:msu"))
    private val wings = WGame("2", "nhl", System.currentTimeMillis() + 86_400_000, "pre", "", team("DET", "Red Wings", true, "nhl:det"), team("CBJ", "Blue Jackets", false))

    @Before fun seed() {
        Robolectric.setupContentProvider(app.tivibro.phone.widget.LogoProvider::class.java, app.tivibro.phone.widget.LogoProvider.AUTHORITY)
        androidx.work.testing.WorkManagerTestInitHelper.initializeTestWorkManager(ctx)
        Cache.save(ctx, listOf(msu, wings))
        colours.forEach { (abbr, c) ->
            val b = Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888).apply { eraseColor(c) }
            SportsWidgetWorker.file(ctx, "https://logo.test/$abbr.png").outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
    }

    private fun widget(): Int = shadowOf(wm).createWidget(SportsWidget::class.java, R.layout.widget_sports)
    private fun view(id: Int): View = shadowOf(wm).getViewFor(id)
    private fun text(v: View, id: Int) = (v.findViewById<TextView>(id)).text.toString()
    private fun colourOf(iv: ImageView): Int = ((iv.drawable as BitmapDrawable).bitmap).getPixel(1, 1)

    // The list's rows as the launcher gets them: applied fresh, or reapplied onto a row it reuses.
    private fun rows(id: Int): android.widget.RemoteViewsService.RemoteViewsFactory {
        val svc = Robolectric.buildService(SportsWidgetService::class.java).create().get()
        return svc.onGetViewFactory(Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)).also { it.onDataSetChanged() }
    }

    // The title bar is the same with a game's card open (the card is all in the list): nothing there to get stuck.
    @Test fun titleBarStaysPutAndTheCardIsAllInTheList() {
        val id = widget()
        SportsWidget.draw(ctx, wm, id)
        assertEquals("My teams", text(view(id), R.id.sw_title))
        DetailOpen.open(ctx, id, wings.id)
        SportsWidget.draw(ctx, wm, id)
        assertEquals("My teams", text(view(id), R.id.sw_title))
        val f = rows(id)
        val parent = FrameLayout(ctx)
        // All my teams, then the Red Wings' game with their own logos, then the rest of the card.
        assertTrue(text(f.getViewAt(0).apply(ctx, parent), R.id.sh_text).contains("All my teams"))
        val head = f.getViewAt(1).apply(ctx, parent)
        assertEquals("Red Wings", text(head, R.id.sp_away_name))
        assertEquals(Color.BLUE, colourOf(head.findViewById(R.id.sp_away_logo)))
        assertEquals(Color.YELLOW, colourOf(head.findViewById(R.id.sp_home_logo)))
        assertEquals(View.GONE, head.findViewById<View>(R.id.sp_watch).visibility)
        // Back: the list again.
        DetailOpen.close(ctx, id)
        f.onDataSetChanged()
        assertEquals("Arkansas", text(f.getViewAt(0).apply(ctx, parent), R.id.sp_away_name))
    }

    @Test fun eachGameItsOwnLogosEvenOnAReusedRow() {
        val id = widget()
        val f = rows(id)
        val parent = FrameLayout(ctx)
        // The list: the live Spotlight first (Arkansas at Michigan St).
        val first = f.getViewAt(0).apply(ctx, parent)
        assertEquals(Color.RED, colourOf(first.findViewById(R.id.sp_away_logo)))
        // The Red Wings' card open: its game row, applied onto the row that showed Arkansas at Michigan St.
        DetailOpen.open(ctx, id, wings.id)
        f.onDataSetChanged()
        f.getViewAt(1).reapply(ctx, first)
        assertEquals(Color.BLUE, colourOf(first.findViewById(R.id.sp_away_logo)))
        // Reapplying a Spotlight of one game onto a row that showed another: the logos follow.
        DetailOpen.close(ctx, id)
        Cache.save(ctx, listOf(wings.copy(state = "in"), msu))
        f.onDataSetChanged()
        f.getViewAt(0).reapply(ctx, first)
        assertEquals(Color.BLUE, colourOf(first.findViewById(R.id.sp_away_logo)))
    }

    // Android 12+: the whole list handed over at once (sportsRows), each card's head with its own game's logos, as
    // pictures: the Pixel launcher never re-read a reused row's picture.  Both games' cards, not just one.
    @Test @Config(sdk = [33]) fun wholeRowsCarryEachCardsOwnLogos() {
        val id = widget()
        val parent = FrameLayout(ctx)
        for ((game, away, home) in listOf(Triple(msu, Color.RED, Color.GREEN), Triple(wings, Color.BLUE, Color.YELLOW))) {
            DetailOpen.open(ctx, id, game.id)
            val rows = app.tivibro.phone.widget.sportsRows(ctx, id)
            assertTrue(text(rows.getItemView(0).apply(ctx, parent), R.id.sh_text).contains("All my teams"))
            val head = rows.getItemView(1).apply(ctx, parent)
            assertEquals(game.away.name, text(head, R.id.sp_away_name))
            assertEquals(away, colourOf(head.findViewById(R.id.sp_away_logo)))
            assertEquals(home, colourOf(head.findViewById(R.id.sp_home_logo)))
        }
        DetailOpen.close(ctx, id)
        val list = app.tivibro.phone.widget.sportsRows(ctx, id)
        assertEquals(Color.RED, colourOf(list.getItemView(0).apply(ctx, parent).findViewById(R.id.sp_away_logo)))
    }
}
