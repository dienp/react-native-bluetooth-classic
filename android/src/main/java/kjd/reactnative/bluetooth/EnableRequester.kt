package kjd.reactnative.bluetooth

import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Handler
import com.facebook.react.bridge.ActivityEventListener

/**
 * Shows the system enable-Bluetooth prompt. Concurrent callers share one
 * prompt and one result. A request resolves once the adapter reports `on`,
 * whether the user accepted the prompt or turned Bluetooth on another way.
 * All state is confined to the main thread.
 */
internal class EnableRequester(
  private val preconditions: Preconditions,
  private val permissions: PermissionGate,
  private val currentActivity: () -> Activity?,
  private val main: Handler
) : ActivityEventListener, AdapterMonitor.Listener {
  private val waiters = mutableListOf<SafePromise>()
  private var timeout: Runnable? = null

  /** Call on the main thread. */
  fun request(promise: SafePromise) {
    val adapter = preconditions.requireHardware()
    permissions.require(PermissionScope.CONNECT)
    if (adapter.state == BluetoothAdapter.STATE_ON) {
      promise.resolve(null)
      return
    }
    if (waiters.isNotEmpty()) {
      waiters += promise
      return
    }
    val activity =
      currentActivity()
        ?: throw BluetoothClassicException(
          ErrorCode.ACTIVITY_UNAVAILABLE,
          "requestEnable() needs an activity in the foreground"
        )
    try {
      activity.startActivityForResult(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), REQUEST_CODE)
    } catch (e: ActivityNotFoundException) {
      throw BluetoothClassicException(
        ErrorCode.ACTIVITY_UNAVAILABLE,
        "No app can show the enable-Bluetooth prompt",
        cause = e
      )
    }
    waiters += promise
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST_CODE || waiters.isEmpty()) return
    try {
      when {
        preconditions.requireHardware().state == BluetoothAdapter.STATE_ON -> settle(null)
        resultCode == Activity.RESULT_OK -> {
          // Accepted: the adapter is turning on. Give it a bounded time.
          val timeout = Runnable {
            settle(BluetoothClassicException(ErrorCode.BLUETOOTH_DISABLED, "Bluetooth did not turn on within 15 s"))
          }
          this.timeout = timeout
          main.postDelayed(timeout, TIMEOUT_MS)
        }
        else -> settle(BluetoothClassicException(ErrorCode.USER_REJECTED, "The user declined to turn Bluetooth on"))
      }
    } catch (t: Throwable) {
      settle(t)
    }
  }

  override fun onNewIntent(intent: Intent) = Unit

  override fun onAdapterStateChanged(state: String, previousState: String) {
    if (state == AdapterMonitor.ON && waiters.isNotEmpty()) settle(null)
  }

  /** Drops pending callers; their JS runtime is going away. */
  fun cancel() {
    clearTimeout()
    waiters.forEach { it.abandon() }
    waiters.clear()
  }

  /** Resolves every waiter when [error] is null, and rejects them all otherwise. */
  private fun settle(error: Throwable?) {
    clearTimeout()
    val settled = waiters.toList()
    waiters.clear()
    for (waiter in settled) {
      if (error == null) waiter.resolve(null) else waiter.reject(error)
    }
  }

  private fun clearTimeout() {
    timeout?.let(main::removeCallbacks)
    timeout = null
  }

  companion object {
    /** Library-unique; must fit in 16 bits for FragmentActivity. */
    const val REQUEST_CODE = 0x4232
    const val TIMEOUT_MS = 15_000L
  }
}
