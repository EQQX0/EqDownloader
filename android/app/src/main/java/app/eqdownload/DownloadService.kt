package app.eqdownload

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/**
 * Foreground service (type dataSync) that hosts the downloads, so they keep running with the screen off.
 * It shows one progress notification with a Cancel action. It is not exported: only this app can start it.
 */
class DownloadService : Service() {
    private val workers = Executors.newFixedThreadPool(2)
    private val main = Handler(Looper.getMainLooper())
    private var pending = 0 // main thread only
    private var lastNotifyAt = 0L

    private val listener: (Item) -> Unit = { item ->
        if (item.state == "done" || item.state == "failed") notifyFinished(item)
        refreshProgress(force = !item.active)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannels()
        DownloadCenter.addListener(listener)
        // Stale staging from a crashed run (older than ten minutes) goes now; running downloads are spared.
        workers.execute {
            runCatching { StagingSweeper.sweep(DownloadCenter.stagingRoot(this), active = DownloadCenter.activeStagingNames()) }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val id = intent.getStringExtra(EXTRA_ID)
                // Must happen within seconds of startForegroundService.
                ServiceCompat.startForeground(
                    this, NOTIFICATION_ID, progressNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
                )
                if (id == null) {
                    stopIfIdle()
                } else {
                    pending++
                    workers.execute {
                        try {
                            DownloadCenter.run(applicationContext, id)
                        } finally {
                            main.post { pending--; stopIfIdle() }
                        }
                    }
                }
            }
            ACTION_CANCEL -> {
                DownloadCenter.cancelAll()
                stopIfIdle()
            }
            else -> stopIfIdle()
        }
        return START_NOT_STICKY
    }

    /** Android 15 caps dataSync services; stop cleanly instead of being killed. */
    override fun onTimeout(startId: Int, fgsType: Int) {
        DownloadCenter.cancelAll()
        stopSelf()
    }

    override fun onDestroy() {
        DownloadCenter.removeListener(listener)
        workers.shutdownNow()
        super.onDestroy()
    }

    private fun stopIfIdle() {
        if (pending <= 0) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun createChannels() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_PROGRESS, getString(R.string.channel_progress), NotificationManager.IMPORTANCE_LOW),
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_DONE, getString(R.string.channel_done), NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    private fun openApp(): PendingIntent = PendingIntent.getActivity(
        this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun progressNotification(): Notification {
        val active = DownloadCenter.list().filter { it.active }
        val percent = if (active.size == 1) active[0].percent.roundToInt() else 0
        val text = when {
            active.isEmpty() -> getString(R.string.notification_starting)
            active.size == 1 -> getString(R.string.notification_one, percent)
            else -> getString(R.string.notification_many, active.size)
        }
        val cancel = PendingIntent.getService(
            this, 1, Intent(this, DownloadService::class.java).setAction(ACTION_CANCEL),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        // No title or address of what is downloading: the notification may show on a locked screen.
        return NotificationCompat.Builder(this, CHANNEL_PROGRESS)
            .setSmallIcon(R.drawable.ic_stat_download)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setProgress(100, percent, active.size != 1 || percent <= 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(openApp())
            .addAction(0, getString(R.string.action_cancel), cancel)
            .build()
    }

    private fun refreshProgress(force: Boolean) {
        val now = System.currentTimeMillis()
        if (!force && now - lastNotifyAt < 700) return
        lastNotifyAt = now
        if (DownloadCenter.activeCount() == 0) return
        // Without the notification permission this is a quiet no-op; the service keeps running.
        if (NotificationManagerCompat.from(this).areNotificationsEnabled()) {
            @Suppress("MissingPermission")
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, progressNotification())
        }
    }

    private fun notifyFinished(item: Item) {
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return
        val text = if (item.state == "done") getString(R.string.notification_done, item.title)
        else getString(R.string.notification_failed)
        val n = NotificationCompat.Builder(this, CHANNEL_DONE)
            .setSmallIcon(R.drawable.ic_stat_download)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setContentIntent(openApp())
            .build()
        @Suppress("MissingPermission")
        NotificationManagerCompat.from(this).notify(item.id.hashCode(), n)
    }

    companion object {
        const val ACTION_START = "app.eqdownload.action.START"
        const val ACTION_CANCEL = "app.eqdownload.action.CANCEL"
        const val EXTRA_ID = "id"
        private const val CHANNEL_PROGRESS = "downloads"
        private const val CHANNEL_DONE = "finished"
        private const val NOTIFICATION_ID = 1

        /** Starts the service for a queued download. Throws if the system refuses a foreground start. */
        fun start(context: Context, id: String) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, DownloadService::class.java).setAction(ACTION_START).putExtra(EXTRA_ID, id),
            )
        }
    }
}
