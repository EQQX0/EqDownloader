package app.eqdownload

import android.content.Context
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

/** Starts the bundled python and ffmpeg once. The first run unpacks them, which takes a few seconds. */
object YtDlpRuntime {
    @Synchronized
    fun ensure(context: Context) {
        val app = context.applicationContext
        YoutubeDL.getInstance().init(app)
        FFmpeg.getInstance().init(app)
    }
}

/**
 * All download state and the work of one download. [DownloadService] gives it a foreground process to run in;
 * [EqEnginePlugin] reads it and forwards changes to the web view.
 */
object DownloadCenter {
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

    fun stagingRoot(context: Context): File = File(context.noBackupFilesDir, "staging").also { it.mkdirs() }

    /** Validates untrusted input and registers a queued item. Throws [EngineException] or [IllegalArgumentException]. */
    fun enqueue(context: Context, url: String?, preset: String?): Item {
        val safeUrl = UrlGuard.requireHttpUrl(url)
        Presets.spec(preset ?: "")
        val id = UUID.randomUUID().toString()
        val item = Item(id = id, url = safeUrl, title = safeUrl, preset = preset!!, state = "queued")
        // Every download works in its own staging folder, so two downloads of one URL never share a .part file.
        jobs[id] = Job(File(stagingRoot(context), StagingSweeper.PREFIX + id))
        synchronized(items) { items[id] = item }
        emit(item)
        return item
    }

    fun activeStagingNames(): Set<String> = jobs.values.map { it.staging.name }.toSet()

    fun cancel(id: String) {
        val job = jobs[id] ?: return
        val item = synchronized(items) { items[id] } ?: return
        if (!item.active) return
        job.cancelled = true
        YoutubeDL.getInstance().destroyProcessById(id)
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
    fun run(context: Context, id: String) {
        val job = jobs[id] ?: return
        val start = synchronized(items) { items[id] } ?: return
        if (job.cancelled || !start.active) return
        update(id) { it.copy(state = "running") }
        try {
            YtDlpRuntime.ensure(context)
            job.staging.mkdirs()
            val spec = YtDlpArgs.download(start.url, start.preset, job.staging.absolutePath)
            val request = YoutubeDLRequest(spec.url)
            for ((k, v) in spec.options) if (v == null) request.addOption(k) else request.addOption(k, v)
            request.addCommands(listOf("--")) // the library puts the url after this
            var lastEmit = 0L
            YoutubeDL.getInstance().execute(request, id, false) { progress, eta, line ->
                val now = System.currentTimeMillis()
                if (now - lastEmit >= 400 && !job.cancelled) {
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
            if (job.cancelled) throw YoutubeDL.CanceledException()
            val produced = job.staging.listFiles { f -> f.isFile && !TEMP.containsMatchIn(f.name) }
                ?.maxByOrNull { it.length() }
                ?: throw EngineException("unknown", "yt-dlp finished without producing a file")
            val saved = MediaStoreSaver.saveNamed(context, produced, FileNames.mimeFor(FileNames.split(produced.name).second))
            finish(id, job) {
                it.copy(
                    state = "done", percent = 100.0, speedBps = null, etaSec = null,
                    title = FileNames.split(saved.displayName).first,
                    filePath = "${MediaStoreSaver.DISPLAY_PATH}/${saved.displayName}",
                )
            }
        } catch (e: YoutubeDL.CanceledException) {
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

    /** Deletes the staging folder, then publishes the final state. */
    private fun finish(id: String, job: Job, change: (Item) -> Item) {
        job.staging.deleteRecursively()
        update(id) { if (it.active) change(it) else it }
        jobs.remove(id)
    }

    private fun update(id: String, change: (Item) -> Item) {
        val next = synchronized(items) {
            val cur = items[id] ?: return
            val n = change(cur)
            if (n == cur) return
            items[id] = n
            n
        }
        emit(next)
    }

    private fun emit(item: Item) {
        for (l in listeners) runCatching { l(item) }
    }

    private val TEMP = Regex("""\.(part|ytdl|temp|tmp)$""", RegexOption.IGNORE_CASE)
}
