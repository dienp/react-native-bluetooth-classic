package kjd.reactnative.bluetooth

import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap

/**
 * Pre-release stub. Reports every capability as unavailable and rejects every
 * operation with UNSUPPORTED_ON_PLATFORM until the Android implementation
 * (task groups 4-6 of the rework-v2-new-architecture OpenSpec change) lands.
 */
class BluetoothClassicModule(reactContext: ReactApplicationContext) :
  NativeBluetoothClassicSpec(reactContext) {

  override fun getCapabilities(): WritableMap {
    return Arguments.createMap().apply {
      putString("platform", "android")
      putString("osVersion", Build.VERSION.SDK_INT.toString())
      putBoolean("discovery", false)
      putBoolean("pairing", false)
      putBoolean("server", false)
      putBoolean("adapterState", false)
      putBoolean("requestEnable", false)
      putBoolean("bondLossEvents", false)
      putBoolean("accessoryPicker", false)
      putArray("declaredProtocols", Arguments.createArray())
    }
  }

  override fun setLogLevel(level: String) = Unit

  override fun getAdapterState(promise: Promise) = notImplemented(promise)

  override fun requestEnable(promise: Promise) = notImplemented(promise)

  override fun openSettings(promise: Promise) = notImplemented(promise)

  override fun setAdapterName(name: String, promise: Promise) = notImplemented(promise)

  override fun checkPermissions(scope: String, promise: Promise) = notImplemented(promise)

  override fun requestPermissions(scope: String, promise: Promise) = notImplemented(promise)

  override fun getBondedDevices(promise: Promise) = notImplemented(promise)

  override fun startDiscovery(timeoutMs: Double, promise: Promise) = notImplemented(promise)

  override fun cancelDiscovery(promise: Promise) = notImplemented(promise)

  override fun pair(address: String, timeoutMs: Double, promise: Promise) = notImplemented(promise)

  override fun unpair(address: String, promise: Promise) = notImplemented(promise)

  override fun getConnectedAccessories(promise: Promise) = notImplemented(promise)

  override fun showAccessoryPicker(nameFilter: String?, promise: Promise) = notImplemented(promise)

  override fun connect(
    operationId: String,
    deviceId: String,
    options: ReadableMap,
    promise: Promise
  ) = notImplemented(promise)

  override fun accept(operationId: String, options: ReadableMap, promise: Promise) =
    notImplemented(promise)

  override fun cancelOperation(operationId: String, promise: Promise) = notImplemented(promise)

  override fun cancelAccept(promise: Promise) = notImplemented(promise)

  override fun getConnections(promise: Promise) {
    promise.resolve(Arguments.createArray())
  }

  override fun write(connectionId: String, data: String, timeoutMs: Double, promise: Promise) =
    notImplemented(promise)

  override fun disconnect(connectionId: String, timeoutMs: Double, promise: Promise) =
    notImplemented(promise)

  override fun closeWithError(
    connectionId: String,
    code: String,
    message: String,
    promise: Promise
  ) = notImplemented(promise)

  private fun notImplemented(promise: Promise) {
    promise.reject(ErrorCode.UNSUPPORTED_ON_PLATFORM, NOT_IMPLEMENTED_MESSAGE)
  }

  companion object {
    const val NAME = NativeBluetoothClassicSpec.NAME
    private const val NOT_IMPLEMENTED_MESSAGE =
      "Not implemented yet in this @dynlabs/react-native-bluetooth-classic v2 pre-release"
  }
}
