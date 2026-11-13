package app.eqdownload

import java.io.File
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CookiesTest {
    @After
    fun reset() {
        CookieStore.dir = null
    }

    @Test
    fun mapsLinksToSitesByHostAndSubdomainOnly() {
        assertEquals(Site.TIKTOK, Site.forUrl("https://vm.tiktok.com/ZM1/"))
        assertEquals(Site.TIKTOK, Site.forUrl("https://www.tiktok.com/@u/video/7706848607252565255"))
        assertEquals(Site.INSTAGRAM, Site.forUrl("https://www.instagram.com/reel/abc/"))
        assertEquals(Site.YOUTUBE, Site.forUrl("https://youtu.be/abc"))
        assertNull(Site.forUrl("https://nottiktok.com/x"))
        assertNull(Site.forUrl("https://tiktok.com.evil.test/x"))
        assertNull(Site.forUrl("ftp://tiktok.com/x"))
        assertNull(Site.forUrl("not a url"))
    }

    @Test
    fun parsesOnlyKnownSiteIds() {
        assertEquals(Site.YOUTUBE, Site.parse("youtube"))
        assertNull(Site.parse("facebook"))
        assertNull(Site.parse(null))
    }

    @Test
    fun turnsACookieHeaderIntoNetscapeLines() {
        val lines = Netscape.fromHeader("sessionid=abc; tt_chain=x=y; ; bad", ".tiktok.com", 1_000)
        assertEquals(
            listOf(
                ".tiktok.com\tTRUE\t/\tTRUE\t${1_000 + 365L * 24 * 3600}\tsessionid\tabc",
                ".tiktok.com\tTRUE\t/\tTRUE\t${1_000 + 365L * 24 * 3600}\ttt_chain\tx=y",
            ),
            lines,
        )
        assertTrue(Netscape.fromHeader(null, ".tiktok.com").isEmpty())
    }

    @Test
    fun fileHasHeaderAndDetectsCookies() {
        assertFalse(Netscape.hasCookies(Netscape.file(emptyList())))
        assertTrue(Netscape.hasCookies(Netscape.file(Netscape.fromHeader("a=b", ".tiktok.com"))))
    }

    @Test
    fun storeReturnsAFileOnlyForASignedInMatchingSite() {
        val dir = File.createTempFile("eq-cookies", "").apply { delete(); mkdirs() }
        try {
            CookieStore.dir = dir
            assertNull(CookieStore.fileFor("https://vm.tiktok.com/ZM1/"))
            CookieStore.save(Site.TIKTOK, Netscape.file(Netscape.fromHeader("sessionid=abc", ".tiktok.com")))
            assertTrue(CookieStore.has(Site.TIKTOK))
            assertEquals(File(dir, "tiktok.txt").absolutePath, CookieStore.fileFor("https://vm.tiktok.com/ZM1/"))
            assertNull(CookieStore.fileFor("https://www.instagram.com/p/1"))
            CookieStore.remove(Site.TIKTOK)
            assertFalse(CookieStore.has(Site.TIKTOK))
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test
    fun visitorCookiesAreNotASignIn() {
        val visitor = Netscape.file(Netscape.fromHeader("ttwid=a; msToken=b", ".tiktok.com"))
        assertFalse(Netscape.hasSession(visitor, Site.TIKTOK.sessionCookies))
        val signedIn = Netscape.file(Netscape.fromHeader("ttwid=a; sessionid=c", ".tiktok.com"))
        assertTrue(Netscape.hasSession(signedIn, Site.TIKTOK.sessionCookies))
    }
}
