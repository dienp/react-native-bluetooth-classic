package kjd.reactnative.bluetooth

import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap

/**
 * Pre-release stub. Reports every capability as unavailable until the Android
 * implementation (task groups 4-6) lands.
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

  companion object {
    const val NAME = NativeBluetoothClassicSpec.NAME
  }
}
