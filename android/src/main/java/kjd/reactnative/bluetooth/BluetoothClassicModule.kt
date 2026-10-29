package kjd.reactnative.bluetooth

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap

/**
 * The TurboModule. Every entry point wraps its promise in a [SafePromise] and
 * runs inside [guarded], so each call settles exactly once and no exception
 * reaches React Native. Discovery, pairing and connections still reject with
 * `UNSUPPORTED_ON_PLATFORM` until task groups 5 and 6 land.
 */
class BluetoothClassicModule
internal constructor(reactContext: ReactApplicationContext, adapterProvider: (() -> BluetoothAdapter?)?) :
  NativeBluetoothClassicSpec(reactContext) {

  constructor(reactContext: ReactApplicationContext) : this(reactContext, null)

  private val main = Handler(Looper.getMainLooper())
  @Volatile private var invalidated = false
  private val appContext = reactContext.applicationContext
  internal val adapterMonitor =
    AdapterMonitor(appContext, adapterProvider ?: { AdapterMonitor.defaultAdapter(appContext) })
  internal val permissions = PermissionGate(appContext, { reactApplicationContext.currentActivity }, main)
  private val preconditions = Preconditions(adapterMonitor, permissions)
  private val enableRequester =
    EnableRequester(preconditions, permissions, { reactApplicationContext.currentActivity }, main)

  override fun initialize() {
    super.initialize()
    adapterMonitor.addListener { state, previousState ->
      emitOnAdapterStateChange(Writables.map(adapterStateEvent(state, previousState, System.currentTimeMillis())))
    }
    adapterMonitor.addListener(enableRequester)
    adapterMonitor.start()
    reactApplicationContext.addActivityEventListener(enableRequester)
    reactApplicationContext.addLifecycleEventListener(permissions)
  }

  /** Runs when the JS runtime is reloaded or destroyed: nothing may survive into the next one. */
  override fun invalidate() {
    invalidated = true
    adapterMonitor.stop()
    reactApplicationContext.removeActivityEventListener(enableRequester)
    reactApplicationContext.removeLifecycleEventListener(permissions)
    val cancel = Runnable {
      enableRequester.cancel()
      permissions.cancel()
    }
    // On the main thread, cancel now so no pending result can slip in first.
    if (Looper.myLooper() == Looper.getMainLooper()) cancel.run() else main.post(cancel)
    // The level is process-wide; the next runtime starts at the default, like JS.
    Logger.setLevel(Logger.DEFAULT_LEVEL)
    super.invalidate()
  }

  // ---- Platform ----

  override fun getCapabilities(): WritableMap = Writables.map(Capabilities.android())

  override fun setLogLevel(level: String) = Logger.setLevel(level)

  // ---- Adapter ----

  override fun getAdapterState(promise: Promise) =
    entry(promise, "getAdapterState") { it.resolve(adapterMonitor.state()) }

  override fun requestEnable(promise: Promise) = entryOnMain(promise, "requestEnable", enableRequester::request)

  override fun openSettings(promise: Promise) =
    entryOnMain(promise, "openSettings") { safe ->
      // Launching from the application context is blocked in the background
      // on API 29+ without an error, so a foreground activity is required.
      val activity =
        reactApplicationContext.currentActivity
          ?: throw BluetoothClassicException(
            ErrorCode.ACTIVITY_UNAVAILABLE,
            "openSettings() needs an activity in the foreground"
          )
      try {
        activity.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
      } catch (e: ActivityNotFoundException) {
        throw BluetoothClassicException(
          ErrorCode.ACTIVITY_UNAVAILABLE,
          "No app can open the Bluetooth settings",
          cause = e
        )
      }
      safe.resolve(null)
    }

  @SuppressLint("MissingPermission") // requireAdapter checks BLUETOOTH_CONNECT.
  override fun setAdapterName(name: String, promise: Promise) =
    entry(promise, "setAdapterName") { safe ->
      if (name.isEmpty()) {
        throw BluetoothClassicException(ErrorCode.INVALID_ARGUMENT, "name must be a non-empty string")
      }
      if (name.toByteArray(Charsets.UTF_8).size > MAX_ADAPTER_NAME_BYTES) {
        throw BluetoothClassicException(
          ErrorCode.INVALID_ARGUMENT,
          "name must be at most $MAX_ADAPTER_NAME_BYTES UTF-8 bytes"
        )
      }
      val adapter = preconditions.requireAdapter(PermissionScope.CONNECT)
      if (!adapter.setName(name)) {
        throw BluetoothClassicException(ErrorCode.UNKNOWN, "The OS did not accept the adapter name")
      }
      safe.resolve(null)
    }

  // ---- Permissions ----

  override fun checkPermissions(scope: String, promise: Promise) =
    entry(promise, "checkPermissions") {
      it.resolve(Writables.map(permissions.status(PermissionScope.parse(scope)).toMap()))
    }

  override fun requestPermissions(scope: String, promise: Promise) =
    entryOnMain(promise, "requestPermissions") { permissions.request(PermissionScope.parse(scope), it) }

  // ---- Discovery and pairing (task group 5) ----

  override fun getBondedDevices(promise: Promise) =
    notImplemented(promise, "getBondedDevices")

  override fun startDiscovery(timeoutMs: Double, promise: Promise) =
    notImplemented(promise, "startDiscovery")

  override fun cancelDiscovery(promise: Promise) =
    notImplemented(promise, "cancelDiscovery")

  override fun pair(address: String, timeoutMs: Double, promise: Promise) =
    notImplemented(promise, "pair")

  override fun unpair(address: String, promise: Promise) =
    notImplemented(promise, "unpair")

  // ---- ExternalAccessory (iOS only) ----

  override fun getConnectedAccessories(promise: Promise) = iosOnly(promise, "getConnectedAccessories")

  override fun showAccessoryPicker(nameFilter: String?, promise: Promise) = iosOnly(promise, "showAccessoryPicker")

  // ---- Connections (task group 6) ----

  override fun connect(operationId: String, deviceId: String, options: ReadableMap, promise: Promise) =
    notImplemented(promise, "connect")

  override fun accept(operationId: String, options: ReadableMap, promise: Promise) =
    notImplemented(promise, "accept")

  override fun cancelOperation(operationId: String, promise: Promise) =
    notImplemented(promise, "cancelOperation")

  override fun cancelAccept(promise: Promise) =
    notImplemented(promise, "cancelAccept")

  override fun getConnections(promise: Promise) =
    entry(promise, "getConnections") { it.resolve(Writables.array(emptyList<Any>())) }

  override fun write(connectionId: String, data: String, timeoutMs: Double, promise: Promise) =
    notImplemented(promise, "write")

  override fun disconnect(connectionId: String, timeoutMs: Double, promise: Promise) =
    notImplemented(promise, "disconnect")

  override fun closeWithError(connectionId: String, code: String, message: String, promise: Promise) =
    notImplemented(promise, "closeWithError")

  // ---- Helpers ----

  private inline fun entry(promise: Promise, operation: String, block: (SafePromise) -> Unit) {
    val safe = SafePromise(promise, operation)
    guarded(safe) { block(safe) }
  }

  /** For work that touches activities or main-thread state. */
  private fun entryOnMain(promise: Promise, operation: String, block: (SafePromise) -> Unit) {
    val safe = SafePromise(promise, operation)
    main.post {
      if (invalidated) safe.abandon() else guarded(safe) { block(safe) }
    }
  }

  private fun notImplemented(promise: Promise, operation: String) =
    entry(promise, operation) {
      throw BluetoothClassicException(ErrorCode.UNSUPPORTED_ON_PLATFORM, NOT_IMPLEMENTED_MESSAGE)
    }

  private fun iosOnly(promise: Promise, operation: String) =
    entry(promise, operation) {
      throw BluetoothClassicException(ErrorCode.UNSUPPORTED_ON_PLATFORM, "$operation() is only available on iOS")
    }

  companion object {
    const val NAME = NativeBluetoothClassicSpec.NAME
    const val MAX_ADAPTER_NAME_BYTES = 248
    private const val NOT_IMPLEMENTED_MESSAGE =
      "Not implemented yet in this @dynlabs/react-native-bluetooth-classic v2 pre-release"

    internal fun adapterStateEvent(state: String, previousState: String, timestamp: Long): Map<String, Any> =
      mapOf("state" to state, "previousState" to previousState, "timestamp" to timestamp.toDouble())
  }
}
