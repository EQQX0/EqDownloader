package app.eqdownload

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickInfoTest {
    @Test
    fun youtubeAndTiktokHaveAQuickLookupOthersDoNot() {
        assertTrue(QuickInfo.endpoint("https://youtu.be/abc")!!.startsWith("https://www.youtube.com/oembed"))
        assertTrue(QuickInfo.endpoint("https://music.youtube.com/watch?v=x")!!.startsWith("https://www.youtube.com/oembed"))
        assertTrue(QuickInfo.endpoint("https://vt.tiktok.com/ZS1/")!!.startsWith("https://www.tiktok.com/oembed"))
        assertNull(QuickInfo.endpoint("https://www.instagram.com/p/x/"))
        assertNull(QuickInfo.endpoint("https://evil.test/?u=https://youtu.be/abc"))
    }

    @Test
    fun parsesTitleAndOnlyHttpsThumbnail() {
        val i = QuickInfo.parse("""{"title":" Me at the zoo ","thumbnail_url":"https://i.ytimg.com/vi/x/hq.jpg"}""")!!
        assertEquals("Me at the zoo", i.title)
        assertEquals("https://i.ytimg.com/vi/x/hq.jpg", i.thumbnail)
        assertNull(QuickInfo.parse("""{"title":"T","thumbnail_url":"http://insecure/x.jpg"}""")!!.thumbnail)
        assertNull(QuickInfo.parse("""{"title":" "}"""))
    }
}
