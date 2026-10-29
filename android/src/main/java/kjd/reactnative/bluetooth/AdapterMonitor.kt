package kjd.reactnative.bluetooth

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.ContextCompat
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Reports the adapter state and follows its changes. The receiver lives on the
 * application context from [start] to [stop], so transitions that happen while
 * the activity is paused (behind a system dialog, or in the background) are
 * still delivered.
 */
internal class AdapterMonitor(
  private val context: Context,
  private val adapterProvider: () -> BluetoothAdapter? = { defaultAdapter(context) }
) {
  fun interface Listener {
    fun onAdapterStateChanged(state: String, previousState: String)
  }

  private val listeners = CopyOnWriteArrayList<Listener>()
  private var receiver: BroadcastReceiver? = null

  /** The adapter, or `null` when the device has no Bluetooth hardware. */
  val adapter: BluetoothAdapter?
    get() = adapterProvider()

  /** One of `unavailable`, `off`, `turningOn`, `on` or `turningOff`. */
  fun state(): String {
    val adapter = adapter ?: return UNAVAILABLE
    return stateName(adapter.state) ?: OFF
  }

  fun addListener(listener: Listener) {
    listeners += listener
  }

  @Synchronized
  fun start() {
    if (receiver != null) return
    val receiver =
      object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) = handle(intent)
      }
    ContextCompat.registerReceiver(
      context,
      receiver,
      IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED),
      // A system broadcast: it must be exported to be received.
      ContextCompat.RECEIVER_EXPORTED
    )
    this.receiver = receiver
  }

  /** Unregisters the receiver and drops every listener. */
  @Synchronized
  fun stop() {
    receiver?.let {
      try {
        context.unregisterReceiver(it)
      } catch (e: IllegalArgumentException) {
        Logger.warn("The adapter state receiver was already unregistered", e)
      }
    }
    receiver = null
    listeners.clear()
  }

  private fun handle(intent: Intent) {
    if (intent.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
    val state = stateName(intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR))
    val previous = stateName(intent.getIntExtra(BluetoothAdapter.EXTRA_PREVIOUS_STATE, BluetoothAdapter.ERROR))
    if (state == null) return
    Logger.debug { "Adapter state ${previous ?: "?"} -> $state" }
    for (listener in listeners) {
      try {
        listener.onAdapterStateChanged(state, previous ?: state)
      } catch (t: Throwable) {
        Logger.error("An adapter state listener threw", t)
      }
    }
  }

  companion object {
    const val UNAVAILABLE = "unavailable"
    const val OFF = "off"
    const val TURNING_ON = "turningOn"
    const val ON = "on"
    const val TURNING_OFF = "turningOff"

    fun defaultAdapter(context: Context): BluetoothAdapter? =
      context.getSystemService(BluetoothManager::class.java)?.adapter

    /** Maps a `BluetoothAdapter.STATE_*` value; returns `null` for anything else. */
    fun stateName(state: Int): String? =
      when (state) {
        BluetoothAdapter.STATE_OFF -> OFF
        BluetoothAdapter.STATE_TURNING_ON -> TURNING_ON
        BluetoothAdapter.STATE_ON -> ON
        BluetoothAdapter.STATE_TURNING_OFF -> TURNING_OFF
        else -> null
      }
  }
}
