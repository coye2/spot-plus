// SpotPlusTwaActivity.kt — Path 3: Thin Trusted Web Activity + MediaController Bridge (~95 LOC)
// Renders the real Spot+ PWA at https://coye2.github.io/spot-plus/ with zero duplicated UI,
// routing `spotplus.microbridge.v1` postMessage envelopes directly to SpotPlusMediaService.

package io.github.coye2.spotplus.microbridge

import android.content.ComponentName
import android.net.Uri
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsCallback
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsServiceConnection
import androidx.browser.customtabs.CustomTabsSession
import androidx.browser.trusted.TrustedWebActivityIntentBuilder
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import org.json.JSONObject

class SpotPlusTwaActivity : AppCompatActivity() {

    companion object {
        private val ALLOWED_ORIGIN = Uri.parse("https://coye2.github.io")
        private val PWA_URI = Uri.parse("https://coye2.github.io/spot-plus/")
    }

    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    private var customTabsSession: CustomTabsSession? = null

    private val tabsCallback = object : CustomTabsCallback() {
        override fun onMessageChannelReady(extras: Bundle?) {
            val helloAck = JSONObject()
                .put("protocol", "spotplus.microbridge.v1")
                .put("id", "android-ack-1")
                .put("type", "bridge.hello_ack")
                .put("payload", JSONObject().put("platform", "android-media3").put("version", "0.1.0"))
            customTabsSession?.postMessage(helloAck.toString(), null)
        }

        override fun onPostMessage(message: String, extras: Bundle?) {
            dispatchProtocolEnvelope(message)
        }
    }

    private val serviceConnection = object : CustomTabsServiceConnection() {
        override fun onCustomTabsServiceConnected(name: ComponentName, client: CustomTabsClient) {
            client.warmup(0L)
            val session = client.newSession(tabsCallback) ?: return
            customTabsSession = session
            // Request verified postMessage channel locked to https://coye2.github.io
            session.requestPostMessageChannel(ALLOWED_ORIGIN)
            val twaIntent = TrustedWebActivityIntentBuilder(PWA_URI).build(session)
            twaIntent.launchTrustedWebActivity(this@SpotPlusTwaActivity)
        }

        override fun onServiceDisconnected(name: ComponentName) {
            customTabsSession = null
        }
    }

    override fun onStart() {
        super.onStart()
        val token = SessionToken(this, ComponentName(this, SpotPlusMediaService::class.java))
        controllerFuture = MediaController.Builder(this, token).buildAsync().also { future ->
            future.addListener({ controller = future.get() }, MoreExecutors.directExecutor())
        }
        val provider = CustomTabsClient.getPackageName(this, null)
        if (provider != null) {
            CustomTabsClient.bindCustomTabsService(this, provider, serviceConnection)
        }
    }

    private fun dispatchProtocolEnvelope(rawJson: String) {
        val env = runCatching { JSONObject(rawJson) }.getOrNull() ?: return
        if (env.optString("protocol") != "spotplus.microbridge.v1") return
        val ctrl = controller ?: return
        when (env.optString("type")) {
            "cmd.play" -> ctrl.play()
            "cmd.pause" -> ctrl.pause()
            "cmd.toggle" -> if (ctrl.isPlaying) ctrl.pause() else ctrl.play()
            "cmd.next" -> ctrl.seekToNextMediaItem()
            "cmd.previous" -> ctrl.seekToPreviousMediaItem()
            "cmd.seek" -> {
                val sec = env.optJSONObject("payload")?.optDouble("positionSec", -1.0) ?: -1.0
                if (sec in 0.0..86400.0) ctrl.seekTo((sec * 1000.0).toLong())
            }
        }
    }

    override fun onStop() {
        controllerFuture?.let { MediaController.releaseFuture(it) }
        controller = null
        super.onStop()
    }
}
