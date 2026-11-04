package app.eqdownload

import java.io.File
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private class FakeBackend(private val root: File) : DownloadBackend {
    val prepareEntered = CountDownLatch(1)
    val prepareGate = CountDownLatch(1)
    var holdPrepare = false
    val executeCalls = AtomicInteger()
    val destroyCalls = AtomicInteger()

    /** What execute does once started. */
    var onExecute: (FakeBackend, (Float, Long, String) -> Unit) -> Unit = { _, _ -> }
    var savedName = "clip.mp4"

    @Volatile
    var processRegistered = false
    val processKilled = CountDownLatch(1)

    @Volatile
    var lastProgress: ((Float, Long, String) -> Unit)? = null

    override fun stagingRoot(): File = root

    override fun prepare() {
        if (holdPrepare) {
            prepareEntered.countDown()
            prepareGate.await(10, TimeUnit.SECONDS)
        }
    }

    override fun execute(spec: CommandSpec, id: String, onProgress: (Float, Long, String) -> Unit) {
        executeCalls.incrementAndGet()
        lastProgress = onProgress
        val dir = File(spec.options.first { it.first == "-P" }.second!!)
        File(dir, "clip.mp4").writeText("data")
        onExecute(this, onProgress)
    }

    override fun destroy(id: String): Boolean {
        destroyCalls.incrementAndGet()
        if (!processRegistered) return false
        processKilled.countDown()
        return true
    }

    override fun save(file: File): String = savedName
}

class DownloadCoreTest {
    private lateinit var root: File
    private lateinit var backend: FakeBackend
    private lateinit var core: DownloadCore

    @Before
    fun setUp() {
        root = Files.createTempDirectory("eqcore").toFile()
        backend = FakeBackend(root)
        core = DownloadCore(backend)
    }

    @After
    fun tearDown() {
        root.deleteRecursively()
    }

    private fun state(id: String) = core.list().single { it.id == id }

    private fun runInThread(id: String): Thread = Thread { core.run(id) }.also { it.start() }

    private fun staging(id: String) = File(root, StagingSweeper.PREFIX + id)

    @Test
    fun cancelBeforeTheProcessExistsNeverStartsIt() {
        backend.holdPrepare = true
        val id = core.enqueue("https://example.test/v", "best").id
        val t = runInThread(id)
        assertTrue(backend.prepareEntered.await(5, TimeUnit.SECONDS))
        core.cancel(id) // the process is not registered: destroy is a no-op
        backend.prepareGate.countDown()
        t.join(5000)
        assertEquals("cancelled", state(id).state)
        assertEquals("the process must never start", 0, backend.executeCalls.get())
        assertFalse(staging(id).exists())
    }

    @Test
    fun cancelBeforeRegistrationIsRetriedFromTheProgressCallback() {
        val id = core.enqueue("https://example.test/v", "best").id
        backend.onExecute = { b, progress ->
            // The process is not registered yet when the cancel arrives...
            val canceller = Thread { core.cancel(id) }
            canceller.start()
            canceller.join()
            // ...then it registers and prints its first line: the callback must destroy it now.
            b.processRegistered = true
            progress(10f, 5L, "[download]  10.0% of 1MiB at 1MiB/s ETA 00:05")
            if (!b.processKilled.await(5, TimeUnit.SECONDS)) error("process was never destroyed")
            throw DownloadCancelled()
        }
        runInThread(id).join(10000)
        assertEquals("cancelled", state(id).state)
        assertTrue("destroy retried", backend.destroyCalls.get() >= 2)
        assertFalse(staging(id).exists())
    }

    @Test
    fun aCancelThatArrivesAsTheProcessEndsStillWins() {
        val id = core.enqueue("https://example.test/v", "best").id
        backend.onExecute = { _, _ -> core.cancel(id) } // exits 0, but the user had cancelled
        runInThread(id).join(5000)
        assertEquals("cancelled", state(id).state)
        assertFalse(staging(id).exists())
    }

    @Test
    fun aProgressEventAfterDoneDoesNotReviveTheItem() {
        val id = core.enqueue("https://example.test/v", "best").id
        runInThread(id).join(5000)
        val done = state(id)
        assertEquals("done", done.state)
        val seen = CopyOnWriteArrayList<Item>()
        core.addListener { seen += it }
        backend.lastProgress!!.invoke(50f, 3L, "[download] 50.0% of 1MiB at 1MiB/s ETA 00:03")
        assertEquals(done, state(id))
        assertTrue("no event for an ended item", seen.isEmpty())
    }

    @Test
    fun finishedFileUsesTheNameMediaStoreReallyGave() {
        backend.savedName = "clip (2).mp4"
        val id = core.enqueue("https://example.test/v", "best").id
        runInThread(id).join(5000)
        val item = state(id)
        assertEquals("done", item.state)
        assertEquals("Downloads/EqDownload/clip (2).mp4", item.filePath)
        assertEquals("clip (2)", item.title)
        assertFalse(staging(id).exists())
    }

    @Test
    fun aFailureIsMappedAndStagingRemoved() {
        val id = core.enqueue("https://example.test/v", "best").id
        backend.onExecute = { _, _ -> throw RuntimeException("ERROR: Unsupported URL: x") }
        runInThread(id).join(5000)
        assertEquals("failed", state(id).state)
        assertEquals("unsupported", state(id).error?.code)
        assertFalse(staging(id).exists())
    }

    @Test
    fun enqueueUpgradesHttpAndRejectsOtherInput() {
        assertEquals("https://example.test/v", core.enqueue("http://example.test/v", "best").url)
        for (bad in listOf("file:///x", "javascript:alert(1)", "-x")) {
            try {
                core.enqueue(bad, "best")
                error("expected rejection of $bad")
            } catch (e: EngineException) {
                assertEquals("unsupported", e.code)
            }
        }
        try {
            core.enqueue("https://example.test/v", "nope")
            error("expected rejection")
        } catch (_: IllegalArgumentException) {
            // expected
        }
    }

    @Test
    fun twoStartsOfTheSameUrlGetSeparateStagingFolders() {
        val a = core.enqueue("https://example.test/v", "best")
        val b = core.enqueue("https://example.test/v", "best")
        assertTrue(a.id != b.id)
        assertEquals(2, core.activeStagingNames().size)
    }

    @Test
    fun cancelOfAQueuedItemSettlesItWithoutARun() {
        val id = core.enqueue("https://example.test/v", "best").id
        core.cancel(id)
        assertEquals("cancelled", state(id).state)
        core.run(id) // a worker picking it up later does nothing
        assertEquals(0, backend.executeCalls.get())
    }
}
