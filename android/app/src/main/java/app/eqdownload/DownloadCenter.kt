package app.eqdownload

import android.content.Context
import com.yausername.aria2c.Aria2c
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArraySet

/** One download as the UI sees it (the TypeScript `DownloadItem`). */
data class Item(
    val id: String,
    val url: String,
    val title: String,
    val preset: String,
    val state: String, // queued | running | done | failed | cancelled
    val percent: Double = 0.0,
    val speedBps: Long? = null,
    val etaSec: Long? = null,
    val filePath: String? = null,
    val error: EngineException? = null,
) {
    val active: Boolean get() = state == "queued" || state == "running"
}

/** Thrown inside a run when the user cancelled it. */
class DownloadCancelled : Exception()

/** Everything [DownloadCore] needs from the outside world, so the logic can be tested on the JVM. */
interface DownloadBackend {
    fun stagingRoot(): File

    /** Makes the yt-dlp runtime ready. The first call unpacks python and ffmpeg and takes seconds. */
    fun prepare()

    /** Runs yt-dlp and blocks until it ends. Throws [DownloadCancelled] if the process was destroyed. */
    fun execute(spec: CommandSpec, id: String, onProgress: (Float, Long, String) -> Unit)

    /** Kills the process of download [id]. False when no such process is registered (yet). */
    fun destroy(id: String): Boolean

    /** Moves a finished file into Downloads/EqDownload and returns the name it really got. */
    fun save(file: File): String
}

/**
 * All download state and the work of one download. [DownloadService] gives it a foreground process to run in;
 * [EqEnginePlugin] reads it and forwards changes to the web view.
 */
class DownloadCore(private val backend: DownloadBackend) {
    private class Job(val staging: File) {
        @Volatile var cancelled = false
    }

    private val items = LinkedHashMap<String, Item>()
    private val jobs = ConcurrentHashMap<String, Job>()
    private val listeners = CopyOnWriteArraySet<(Item) -> Unit>()

    fun addListener(l: (Item) -> Unit) {
        listeners += l
    }

    fun removeListener(l: (Item) -> Unit) {
        listeners -= l
    }

    fun list(): List<Item> = synchronized(items) { items.values.toList() }

    fun activeCount(): Int = synchronized(items) { items.values.count { it.active } }

    fun stagingRoot(): File = backend.stagingRoot().also { it.mkdirs() }

    /** Validates untrusted input and registers a queued item. Throws [EngineException] or [IllegalArgumentException]. */
    fun enqueue(url: String?, preset: String?): Item {
        val safeUrl = UrlGuard.requireHttpUrl(url)
        Presets.spec(preset ?: "")
        val id = UUID.randomUUID().toString()
        val item = Item(id = id, url = safeUrl, title = safeUrl, preset = preset!!, state = "queued")
        // Every download works in its own staging folder, so two downloads of one URL never share a .part file.
        jobs[id] = Job(File(stagingRoot(), StagingSweeper.PREFIX + id))
        synchronized(items) {
            items[id] = item
            emit(item)
        }
        return item
    }

    fun activeStagingNames(): Set<String> = jobs.values.map { it.staging.name }.toSet()

    fun cancel(id: String) {
        val job = jobs[id] ?: return
        val item = synchronized(items) { items[id] } ?: return
        if (!item.active) return
        job.cancelled = true
        backend.destroy(id) // false when the process does not exist yet; run() re-checks the flag
        // A download still waiting for a worker never reaches run(), so settle it here.
        if (item.state == "queued") finish(id, job) { it.copy(state = "cancelled", speedBps = null, etaSec = null) }
    }

    fun cancelAll() {
        for (i in list()) if (i.active) cancel(i.id)
    }

    /** Marks a start that could not even reach the service. */
    fun fail(id: String, error: EngineException) {
        val job = jobs[id] ?: return
        finish(id, job) { it.copy(state = "failed", speedBps = null, etaSec = null, error = error) }
    }

    /** Runs one download to the end. Blocks; call it from a worker thread. */
    fun run(id: String) {
        val job = jobs[id] ?: return
        val start = synchronized(items) { items[id] } ?: return
        if (!start.active) return
        try {
            // A cancel can land at any point before the process exists (first-run unpacking takes seconds),
            // and destroying a process that is not registered yet does nothing. So the flag is re-checked
            // between every step, and once more from the progress callback after the process is up.
            checkCancelled(job)
            update(id) { it.copy(state = "running") }
            backend.prepare()
            checkCancelled(job)
            job.staging.mkdirs()
            checkCancelled(job)
            val spec = YtDlpArgs.download(start.url, start.preset, job.staging.absolutePath, CookieStore.fileFor(start.url))
            var lastEmit = 0L
            backend.execute(spec, id) { progress, eta, line ->
                if (job.cancelled) {
                    backend.destroy(id)
                } else {
                    val now = System.currentTimeMillis()
                    if (now - lastEmit >= 400) {
                        lastEmit = now
                        update(id) {
                            it.copy(
                                percent = ProgressParser.percent(progress),
                                speedBps = ProgressParser.speedBps(line) ?: it.speedBps,
                                etaSec = ProgressParser.eta(eta),
                            )
                        }
                    }
                }
            }
            checkCancelled(job)
            val produced = job.staging.listFiles { f -> f.isFile && !TEMP.containsMatchIn(f.name) }
                ?.maxByOrNull { it.length() }
                ?: throw EngineException("unknown", "yt-dlp finished without producing a file")
            val name = backend.save(produced)
            finish(id, job) {
                it.copy(
                    state = "done", percent = 100.0, speedBps = null, etaSec = null,
                    title = FileNames.split(name).first,
                    filePath = "${MediaStoreSaver.DISPLAY_PATH}/$name",
                )
            }
        } catch (e: DownloadCancelled) {
            finish(id, job) { it.copy(state = "cancelled", speedBps = null, etaSec = null) }
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            finish(id, job) { it.copy(state = "cancelled", speedBps = null, etaSec = null) }
        } catch (e: Throwable) {
            if (job.cancelled) {
                finish(id, job) { it.copy(state = "cancelled", speedBps = null, etaSec = null) }
            } else {
                val err = ErrorMapper.fromThrowable(e)
                finish(id, job) { it.copy(state = "failed", speedBps = null, etaSec = null, error = err) }
            }
        }
    }

    private fun checkCancelled(job: Job) {
        if (job.cancelled) throw DownloadCancelled()
    }

    /** Deletes the staging folder, then publishes the final state. */
    private fun finish(id: String, job: Job, change: (Item) -> Item) {
        job.staging.deleteRecursively()
        update(id, change)
        jobs.remove(id)
    }

    /**
     * Applies a change to an item that is still queued or running, and announces it, all under one lock so
     * announcements arrive in the order of the changes. An item that has ended never changes again.
     */
    private fun update(id: String, change: (Item) -> Item) {
        synchronized(items) {
            val cur = items[id] ?: return
            if (!cur.active) return
            val next = change(cur)
            if (next == cur) return
            items[id] = next
            emit(next)
        }
    }

    private fun emit(item: Item) {
        for (l in listeners) runCatching { l(item) }
    }

    private companion object {
        val TEMP = Regex("""\.(part|ytdl|temp|tmp)$""", RegexOption.IGNORE_CASE)
    }
}

/** Starts the bundled python and ffmpeg once. The first run unpacks them, which takes a few seconds. */
object YtDlpRuntime {
    /** True when the bundled aria2c started; downloads then use 8 parallel connections per file. */
    @Volatile
    var fastDownloads = false
        private set

    /** Called when aria2c failed once: the rest of this session downloads with yt-dlp's own downloader. */
    fun disableFast() {
        aria2Broken = true
        fastDownloads = false
    }

    @Volatile
    private var aria2Broken = false

    @Synchronized
    fun ensure(context: Context) {
        val app = context.applicationContext
        YoutubeDL.getInstance().init(app)
        FFmpeg.getInstance().init(app)
        fastDownloads = !aria2Broken && runCatching { Aria2c.getInstance().init(app) }.isSuccess
    }
}

private class AndroidBackend(private val context: Context) : DownloadBackend {
    override fun stagingRoot(): File = File(context.noBackupFilesDir, "staging")

    override fun prepare() = YtDlpRuntime.ensure(context)

    init {
        DebugLog.init(File(context.filesDir, "debug.log"))
    }

    override fun execute(spec: CommandSpec, id: String, onProgress: (Float, Long, String) -> Unit) {
        try {
            executeYtDlp(spec, id, onProgress)
        } catch (e: DownloadCancelled) {
            throw e
        } catch (e: Throwable) {
            if (!tiktokFallbackApplies(spec, e)) throw e
            // yt-dlp cannot get past TikTok's page check, and the user is signed in: load the page in a web view instead.
            DebugLog.add("fallback", "$id TikTok refused yt-dlp, trying the web view")
            val outDir = File(spec.options.first { it.first == "-P" }.second!!)
            TikTokFetcher.download(context, id, spec.url, outDir, onProgress)
        }
    }

    /** Only video downloads of a signed-in TikTok link that yt-dlp could not open because the site refused it. */
    private fun tiktokFallbackApplies(spec: CommandSpec, e: Throwable): Boolean =
        TikTokFetcher.applies(spec.url) &&
            spec.options.none { it.first == "-x" } &&
            spec.options.any { it.first == "-P" } &&
            ErrorMapper.fromThrowable(e).code == "blocked"

    private fun executeYtDlp(spec: CommandSpec, id: String, onProgress: (Float, Long, String) -> Unit) {
        val fast = YtDlpRuntime.fastDownloads
        try {
            runOnce(spec, id, fast, onProgress)
        } catch (e: DownloadCancelled) {
            throw e
        } catch (e: Throwable) {
            DebugLog.add("error", "$id ${e.javaClass.simpleName}: ${e.message?.take(2000)}")
            if (!fast || !DebugLog.isAria2Failure(e)) throw e
            // The fast downloader failed: switch it off and run the same download again with yt-dlp's own.
            DebugLog.add("fallback", "$id aria2c failed, retrying with the built-in downloader")
            YtDlpRuntime.disableFast()
            try {
                runOnce(spec, id, false, onProgress)
            } catch (e2: DownloadCancelled) {
                throw e2
            } catch (e2: Throwable) {
                DebugLog.add("error", "$id (after fallback) ${e2.javaClass.simpleName}: ${e2.message?.take(2000)}")
                throw e2
            }
        }
    }

    private fun runOnce(spec: CommandSpec, id: String, fast: Boolean, onProgress: (Float, Long, String) -> Unit) {
        val request = YoutubeDLRequest(spec.url)
        for ((k, v) in spec.options) if (v == null) request.addOption(k) else request.addOption(k, v)
        if (fast) {
            request.addOption("--downloader", "libaria2c.so")
            // No --downloader-args here: the library adds its own `--external-downloader-args aria2c:--summary-interval=1`
            // after ours, and yt-dlp keeps only the last one per downloader. aria2's defaults (16 connections) apply.
        } else {
            request.addOption("--no-continue") // never resume a half file that aria2 wrote in pieces
        }
        request.addCommands(listOf("--")) // the library puts the url after this
        DebugLog.add("start", "$id ${if (fast) "aria2c" else "built-in"} ${spec.url} ${spec.commandLine().joinToString(" ")}")
        try {
            YoutubeDL.getInstance().execute(request, id, false) { p, eta, line ->
                if (line.isNotBlank() && !DebugLog.isProgressLine(line)) DebugLog.add("yt-dlp", line.take(500))
                onProgress(p, eta, line)
            }
        } catch (e: YoutubeDL.CanceledException) {
            throw DownloadCancelled()
        }
    }

    override fun destroy(id: String): Boolean = TikTokFetcher.cancel(id) || YoutubeDL.getInstance().destroyProcessById(id)

    override fun save(file: File): String =
        MediaStoreSaver.saveNamed(context, file, FileNames.mimeFor(FileNames.split(file.name).second)).displayName
}

/** Process-wide holder of the one [DownloadCore]. */
object DownloadCenter {
    @Volatile
    private var core: DownloadCore? = null

    fun install(context: Context): DownloadCore {
        CookieStore.dir = File(context.applicationContext.filesDir, "cookies")
        return get(context)
    }

    private fun get(context: Context): DownloadCore =
        core ?: synchronized(this) { core ?: DownloadCore(AndroidBackend(context.applicationContext)).also { core = it } }
}
