package kjd.reactnative.bluetooth

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import java.util.UUID

/**
 * The TurboModule. Every entry point wraps its promise in a [SafePromise] and
 * runs inside [guarded], so each call settles exactly once and no exception
 * reaches React Native.
 */
class BluetoothClassicModule
internal constructor(
  reactContext: ReactApplicationContext,
  adapterProvider: (() -> BluetoothAdapter?)?,
  transport: RfcommTransport? = null
) : NativeBluetoothClassicSpec(reactContext) {

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
  internal val discovery = DiscoveryManager(appContext, preconditions, permissions, main)
  internal val bonds = BondManager(appContext, preconditions, main)
  internal val connections =
    ConnectionManager(
      transport ?: AndroidRfcommTransport { adapterMonitor.adapter },
      ExecutorScheduler("RNBluetoothClassic-timer"),
      ConnectionEmitter(),
      adapterOn = { adapterMonitor.adapter?.state == BluetoothAdapter.STATE_ON },
      deviceInfo = ::connectedDevice
    )

  override fun initialize() {
    super.initialize()
    adapterMonitor.addListener { state, previousState ->
      emitOnAdapterStateChange(Writables.map(adapterStateEvent(state, previousState, System.currentTimeMillis())))
    }
    adapterMonitor.addListener(enableRequester)
    adapterMonitor.addListener(discovery)
    adapterMonitor.addListener(bonds)
    adapterMonitor.addListener { state, _ -> if (state != AdapterMonitor.ON) connections.adapterOff() }
    discovery.addListener { device ->
      emitOnDeviceFound(Writables.map(mapOf("device" to device, "timestamp" to now())))
    }
    bonds.addListener(
      object : BondManager.Listener {
        override fun onBondStateChange(device: Map<String, Any?>, state: String, previousState: String) =
          emitOnBondStateChange(
            Writables.map(
              mapOf("device" to device, "state" to state, "previousState" to previousState, "timestamp" to now())
            )
          )

        override fun onBondLost(device: Map<String, Any?>) =
          emitOnBondLost(Writables.map(mapOf("device" to device, "timestamp" to now())))
      }
    )
    adapterMonitor.start()
    bonds.start()
    reactApplicationContext.addActivityEventListener(enableRequester)
    reactApplicationContext.addLifecycleEventListener(permissions)
  }

  /** Runs when the JS runtime is reloaded or destroyed: nothing may survive into the next one. */
  override fun invalidate() {
    invalidated = true
    adapterMonitor.stop()
    bonds.stop()
    reactApplicationContext.removeActivityEventListener(enableRequester)
    reactApplicationContext.removeLifecycleEventListener(permissions)
    connections.shutdown()
    val cancel = Runnable {
      enableRequester.cancel()
      permissions.cancel()
      discovery.tearDown()
      bonds.tearDown()
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

  // ---- Discovery and pairing ----

  @SuppressLint("MissingPermission") // requireAdapter checks the connect scope.
  override fun getBondedDevices(promise: Promise) =
    entry(promise, "getBondedDevices") { safe ->
      val adapter = preconditions.requireAdapter(PermissionScope.CONNECT)
      safe.resolve(Writables.array(adapter.bondedDevices.orEmpty().map { DeviceMapper.toMap(it) }))
    }

  override fun startDiscovery(timeoutMs: Double, promise: Promise) =
    entryOnMain(promise, "startDiscovery") { discovery.start(timeoutMs.toLong(), it) }

  override fun cancelDiscovery(promise: Promise) = entryOnMain(promise, "cancelDiscovery", discovery::cancel)

  override fun pair(address: String, timeoutMs: Double, promise: Promise) =
    entryOnMain(promise, "pair") { bonds.pair(address, timeoutMs.toLong(), it) }

  override fun unpair(address: String, promise: Promise) =
    entryOnMain(promise, "unpair") { bonds.unpair(address, it) }

  // ---- ExternalAccessory (iOS only) ----

  override fun getConnectedAccessories(promise: Promise) = iosOnly(promise, "getConnectedAccessories")

  override fun showAccessoryPicker(nameFilter: String?, promise: Promise) = iosOnly(promise, "showAccessoryPicker")

  // ---- Connections ----

  override fun connect(operationId: String, deviceId: String, options: ReadableMap, promise: Promise) =
    entryOnMain(promise, "connect") { safe ->
      val address = DeviceMapper.requireAddress(deviceId)
      val connectOptions = parseConnectOptions(options)
      preconditions.requireAdapter(PermissionScope.CONNECT)
      // Discovery slows down or breaks RFCOMM connects, so it stops first.
      connections.connect(operationId, address, connectOptions, safe, beforeAttempt = discovery::stop)
    }

  override fun accept(operationId: String, options: ReadableMap, promise: Promise) =
    entry(promise, "accept") { safe ->
      val acceptOptions = parseAcceptOptions(options)
      preconditions.requireAdapter(PermissionScope.SERVER)
      connections.accept(operationId, acceptOptions, safe)
    }

  override fun cancelOperation(operationId: String, promise: Promise) =
    entry(promise, "cancelOperation") {
      connections.cancelOperation(operationId)
      it.resolve(null)
    }

  override fun cancelAccept(promise: Promise) =
    entry(promise, "cancelAccept") {
      connections.cancelAccept()
      it.resolve(null)
    }

  override fun getConnections(promise: Promise) =
    entry(promise, "getConnections") { it.resolve(Writables.array(connections.list())) }

  override fun write(connectionId: String, data: String, timeoutMs: Double, promise: Promise) =
    entry(promise, "write") { safe ->
      val bytes =
        try {
          Base64.decode(data, Base64.DEFAULT)
        } catch (e: IllegalArgumentException) {
          throw BluetoothClassicException(ErrorCode.INVALID_ARGUMENT, "data must be base64", cause = e)
        }
      Logger.debug { "write ${bytes.size} bytes to $connectionId" }
      connections.write(connectionId, bytes, timeoutMs.toLong(), safe)
    }

  override fun disconnect(connectionId: String, timeoutMs: Double, promise: Promise) =
    entry(promise, "disconnect") { connections.disconnect(connectionId, timeoutMs.toLong(), it) }

  override fun closeWithError(connectionId: String, code: String, message: String, promise: Promise) =
    entry(promise, "closeWithError") {
      connections.closeWithError(connectionId, code, message)
      it.resolve(null)
    }

  private inner class ConnectionEmitter : RfcommConnection.Events {
    override fun onStateChange(connectionId: String, state: String, previousState: String, terminal: Terminal?) =
      emitOnConnectionStateChange(
        Writables.map(connectionStateEvent(connectionId, state, previousState, terminal, System.currentTimeMillis()))
      )

    override fun onData(connectionId: String, data: ByteArray, seq: Int) {
      Logger.debug { "read ${data.size} bytes from $connectionId (seq $seq)" }
      emitOnData(Writables.map(dataEvent(connectionId, data, seq)))
    }
  }

  @SuppressLint("MissingPermission") // Connect and accept check BLUETOOTH_CONNECT first.
  private fun connectedDevice(address: String): Map<String, Any?> =
    adapterMonitor.adapter?.getRemoteDevice(address)?.let { DeviceMapper.toMap(it) } ?: DeviceMapper.bare(address)

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

  private fun iosOnly(promise: Promise, operation: String) =
    entry(promise, operation) {
      throw BluetoothClassicException(ErrorCode.UNSUPPORTED_ON_PLATFORM, "$operation() is only available on iOS")
    }

  companion object {
    const val NAME = NativeBluetoothClassicSpec.NAME
    const val MAX_ADAPTER_NAME_BYTES = 248
    /** RFCOMM channels are 1 to 30. */
    private val CHANNELS = 1..30

    private fun now() = System.currentTimeMillis().toDouble()

    internal fun parseConnectOptions(options: ReadableMap): ConnectOptions {
      val fallbackChannel =
        if (options.hasKey("fallbackChannel") && !options.isNull("fallbackChannel")) {
          val value = options.getDouble("fallbackChannel")
          if (value % 1.0 != 0.0 || value.toInt() !in CHANNELS) {
            throw BluetoothClassicException(ErrorCode.INVALID_ARGUMENT, "fallbackChannel must be an integer from 1 to 30")
          }
          value.toInt()
        } else {
          null
        }
      return ConnectOptions(
        timeoutMs = optionalLong(options, "timeoutMs") ?: 0,
        secure = parseTransport(options),
        uuid = parseUuid(options),
        fallbackChannel = fallbackChannel
      )
    }

    internal fun parseAcceptOptions(options: ReadableMap): AcceptOptions =
      AcceptOptions(
        timeoutMs = optionalLong(options, "timeoutMs") ?: 0,
        secure = parseTransport(options),
        uuid = parseUuid(options),
        serviceName = optionalString(options, "serviceName") ?: AcceptOptions.DEFAULT_SERVICE_NAME
      )

    private fun parseTransport(options: ReadableMap): Boolean =
      when (val transport = optionalString(options, "transport")) {
        null, "secure" -> true
        "insecure" -> false
        else -> throw BluetoothClassicException(ErrorCode.INVALID_ARGUMENT, "Unknown transport: $transport")
      }

    private fun parseUuid(options: ReadableMap): UUID {
      val uuid = optionalString(options, "uuid") ?: return RfcommTransport.SPP_UUID
      return try {
        UUID.fromString(uuid)
      } catch (e: IllegalArgumentException) {
        throw BluetoothClassicException(ErrorCode.INVALID_ARGUMENT, "Invalid uuid: $uuid", cause = e)
      }
    }

    private fun optionalString(options: ReadableMap, key: String): String? =
      if (options.hasKey(key) && !options.isNull(key)) options.getString(key) else null

    private fun optionalLong(options: ReadableMap, key: String): Long? =
      if (options.hasKey(key) && !options.isNull(key)) options.getDouble(key).toLong() else null

    internal fun connectionStateEvent(
      connectionId: String,
      state: String,
      previousState: String,
      terminal: Terminal?,
      timestamp: Long
    ): Map<String, Any?> {
      val event =
        mutableMapOf<String, Any?>(
          "connectionId" to connectionId,
          "state" to state,
          "previousState" to previousState,
          "timestamp" to timestamp.toDouble()
        )
      if (terminal != null) {
        event["reason"] = terminal.reason
        terminal.code?.let { event["errorCode"] = it }
        terminal.message?.let { event["errorMessage"] = it }
        terminal.cause?.let { cause ->
          event["nativeCode"] = cause.javaClass.name
          cause.message?.let { event["nativeMessage"] = it }
        }
      }
      return event
    }

    /** Base64 happens here, with `android.util.Base64`, because `java.util.Base64` needs API 26. */
    internal fun dataEvent(connectionId: String, data: ByteArray, seq: Int): Map<String, Any?> =
      mapOf(
        "connectionId" to connectionId,
        "data" to Base64.encodeToString(data, Base64.NO_WRAP),
        "seq" to seq.toDouble()
      )

    internal fun adapterStateEvent(state: String, previousState: String, timestamp: Long): Map<String, Any> =
      mapOf("state" to state, "previousState" to previousState, "timestamp" to timestamp.toDouble())
  }
}
