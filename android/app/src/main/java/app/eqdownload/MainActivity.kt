package app.eqdownload

import android.content.Intent
import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(EqEnginePlugin::class.java)
        super.onCreate(savedInstanceState)
        // A recreated activity (savedInstanceState != null) must not replay an old share.
        if (savedInstanceState == null) forwardShare(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        forwardShare(intent)
    }

    /** "Share to EqDownload": hands the shared text to the web layer, which finds the link in it. */
    private fun forwardShare(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND || intent.type != "text/plain") return
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.take(MAX_SHARED_CHARS) ?: return
        intent.removeExtra(Intent.EXTRA_TEXT)
        val plugin = bridge?.getPlugin("EqEngine")?.instance as? EqEnginePlugin
        plugin?.emitShare(text)
    }

    private companion object {
        const val MAX_SHARED_CHARS = 8000
    }
}
