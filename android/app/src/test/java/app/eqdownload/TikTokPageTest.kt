package app.eqdownload

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class TikTokPageTest {
    private fun page(video: String, status: Int = 0, id: String = "7706848607252565255", desc: String = "a clip") =
        """{"__DEFAULT_SCOPE__":{"webapp.video-detail":{"statusCode":$status,"itemInfo":{"itemStruct":{"id":"$id","desc":"$desc","video":$video}}}}}"""

    @Test
    fun ordersPlayAddressThenBestBitrateThenDownloadAddress() {
        val json = page(
            """{"playAddr":"https://cdn.test/play.mp4",
               "bitrateInfo":[{"Bitrate":500,"PlayAddr":{"UrlList":["https://cdn.test/low.mp4"]}},
                              {"Bitrate":2000,"PlayAddr":{"UrlList":["https://cdn.test/high.mp4","https://cdn2.test/high.mp4"]}}],
               "downloadAddr":"https://cdn.test/wm.mp4"}""",
        )
        val m = TikTokPage.parse(json)
        assertEquals(
            listOf("https://cdn.test/play.mp4", "https://cdn.test/high.mp4", "https://cdn2.test/high.mp4", "https://cdn.test/low.mp4", "https://cdn.test/wm.mp4"),
            m.urls,
        )
        assertEquals("7706848607252565255", m.id)
        assertEquals("a clip", m.title)
    }

    @Test
    fun dropsNonHttpsAddressesAndDuplicates() {
        val m = TikTokPage.parse(page("""{"playAddr":"http://cdn.test/a.mp4","downloadAddr":"https://cdn.test/b.mp4","bitrateInfo":[{"Bitrate":1,"PlayAddr":{"UrlList":["https://cdn.test/b.mp4"]}}]}"""))
        assertEquals(listOf("https://cdn.test/b.mp4"), m.urls)
    }

    @Test
    fun aStatusCodeMeansBlocked() {
        try {
            TikTokPage.parse(page("""{}""", status = 10222))
            fail("expected an exception")
        } catch (e: EngineException) {
            assertEquals("blocked", e.code)
            assertTrue(e.message!!.contains("10222"))
        }
    }

    @Test
    fun missingDataIsUnknownNotACrash() {
        for (json in listOf("not json", "{}", """{"__DEFAULT_SCOPE__":{}}""", page("""{"playAddr":""}"""))) {
            try {
                TikTokPage.parse(json)
                fail("expected an exception for $json")
            } catch (e: EngineException) {
                assertEquals(json, "unknown", e.code)
            }
        }
    }

    @Test
    fun aPostWithoutVideoIsReportedAsUnsupported() {
        val json = """{"__DEFAULT_SCOPE__":{"webapp.video-detail":{"statusCode":0,"itemInfo":{"itemStruct":{"id":"1","desc":"photos","imagePost":{}}}}}}"""
        try {
            TikTokPage.parse(json)
            fail("expected an exception")
        } catch (e: EngineException) {
            assertTrue(e.message!!.contains("Photo"))
        }
    }

    @Test
    fun fileNameFollowsTheYtDlpShapeAndIsSafe() {
        assertEquals("a clip [123].mp4", TikTokPage.fileName(TikTokPage.Media("123", "a clip", listOf("https://x"))))
        assertEquals("a_b_c [1].mp4", TikTokPage.fileName(TikTokPage.Media("1", "a/b:c", listOf("https://x"))))
        assertEquals("TikTok [9].mp4", TikTokPage.fileName(TikTokPage.Media("9", "  ", listOf("https://x"))))
        assertEquals("TikTok.mp4", TikTokPage.fileName(TikTokPage.Media("", "", listOf("https://x"))))
    }

    @Test
    fun progressLineIsReadableByTheSharedParser() {
        val line = TikTokFetcher.progressLine(42.5, 1.5 * (1 shl 20))
        assertEquals(1_572_864L, ProgressParser.speedBps(line))
        assertEquals(1024L, ProgressParser.speedBps(TikTokFetcher.progressLine(1.0, 1024.0)))
    }
}
