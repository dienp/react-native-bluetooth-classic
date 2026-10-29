package kjd.reactnative.bluetooth

import android.bluetooth.BluetoothAdapter

/**
 * The checks every operation runs before touching the adapter, in a fixed
 * order: hardware (`BLUETOOTH_UNAVAILABLE`), the scope's permissions
 * (`PERMISSION_DENIED`), then the adapter being on (`BLUETOOTH_DISABLED`).
 */
internal class Preconditions(private val monitor: AdapterMonitor, private val permissions: PermissionGate) {
  fun requireHardware(): BluetoothAdapter =
    monitor.adapter
      ?: throw BluetoothClassicException(ErrorCode.BLUETOOTH_UNAVAILABLE, "This device has no Bluetooth adapter")

  fun requireAdapter(scope: PermissionScope): BluetoothAdapter {
    val adapter = requireHardware()
    permissions.require(scope)
    if (adapter.state != BluetoothAdapter.STATE_ON) {
      throw BluetoothClassicException(ErrorCode.BLUETOOTH_DISABLED, "Bluetooth is off")
    }
    return adapter
  }
}
