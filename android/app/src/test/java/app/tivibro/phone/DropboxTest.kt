package app.tivibro.phone

import app.tivibro.phone.proto.Dropbox
import app.tivibro.phone.proto.TbException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** The Dropbox sign-in's PKCE pieces, its redirect links and its token answers (proto/Dropbox.kt). */
class DropboxTest {
    @Test fun challengeMatchesRfc7636() {
        // RFC 7636, appendix B.
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", Dropbox.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
    }

    @Test fun verifierAndState() {
        val v = Dropbox.verifier()
        assertEquals(64, v.length)
        assertTrue(v.all { it.isLetterOrDigit() || it == '-' || it == '_' })
        assertNotEquals(v, Dropbox.verifier())
        val c = Dropbox.challenge(v)
        assertEquals(43, c.length)
        assertTrue(c.none { it == '=' || it == '+' || it == '/' })
        val s = Dropbox.state()
        assertEquals(22, s.length)
        assertNotEquals(s, Dropbox.state())
    }

    @Test fun authorizeUrl() {
        val u = Dropbox.authorizeUrl("CH", "ST")
        assertEquals("https://www.dropbox.com/oauth2/authorize?client_id=ax8fum67966pyg6&response_type=code&token_access_type=offline&code_challenge=CH&code_challenge_method=S256" +
            "&redirect_uri=https%3A%2F%2Ftivibro.app%2Fdropbox&state=ST", u)
        assertEquals("grant_type=authorization_code&code=a%2Bb&client_id=ax8fum67966pyg6&code_verifier=V&redirect_uri=https%3A%2F%2Ftivibro.app%2Fdropbox", Dropbox.exchangeForm("a+b", "V"))
    }

    @Test fun redirects() {
        val a = Dropbox.redirect("https://tivibro.app/dropbox?code=abc%2D1&state=xyz")!!
        assertEquals("abc-1", a.code); assertEquals("xyz", a.state); assertEquals("", a.error)
        val b = Dropbox.redirect("tivibro://dropbox?state=xyz&code=c2")!!
        assertEquals("c2", b.code); assertEquals("xyz", b.state)
        assertEquals("access_denied", Dropbox.redirect("https://tivibro.app/dropbox/?error=access_denied&state=s")!!.error)
        assertEquals("", Dropbox.redirect("https://tivibro.app/dropbox")!!.code)
        assertNull(Dropbox.redirect("https://tivibro.app/pair?code=1"))
        assertNull(Dropbox.redirect("https://evil.example/dropbox?code=1"))
        assertNull(Dropbox.redirect("https://tivibro.app/dropboxx?code=1"))
    }

    @Test fun tokenAnswers() {
        assertEquals("R1", Dropbox.refreshFrom(200, """{"access_token":"A","expires_in":14400,"refresh_token":"R1","account_id":"dbid:x"}"""))
        fun msg(status: Int, body: String): String = try { Dropbox.refreshFrom(status, body); fail(); "" } catch (e: TbException) { e.message.orEmpty() }
        assertTrue(msg(400, """{"error":"invalid_grant","error_description":"code doesn't exist or has expired"}""").contains("Sign in again"))
        assertTrue(msg(200, """{"access_token":"A"}""").contains("Try again"))
        assertTrue(msg(500, "oops").contains("error 500"))
    }
}
