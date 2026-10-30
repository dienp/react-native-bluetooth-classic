package kjd.reactnative.bluetooth

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import java.util.Locale

/** Converts OS devices into the plain objects JS receives, and validates addresses. */
internal object DeviceMapper {
  /**
   * The device as JS sees it. [rssi] is only passed for discovery results, and
   * [name] overrides the OS name when a discovery broadcast carries a newer one.
   */
  @SuppressLint("MissingPermission") // Every caller checks the scope's permissions first.
  fun toMap(device: BluetoothDevice, rssi: Int? = null, name: String? = null): Map<String, Any?> {
    val address = device.address.uppercase(Locale.ROOT)
    val bluetoothClass = device.bluetoothClass
    val map =
      mutableMapOf<String, Any?>(
        "id" to address,
        "address" to address,
        "name" to (name ?: device.name),
        "bondState" to bondStateName(device.bondState),
        "type" to typeName(device.type),
        "deviceClass" to
          bluetoothClass?.let { mapOf("major" to it.majorDeviceClass, "value" to it.deviceClass) }
      )
    rssi?.let { map["rssi"] = it }
    return map
  }

  /** A device the OS could not describe, with only its address known. */
  fun bare(address: String): Map<String, Any?> =
    mapOf(
      "id" to address,
      "address" to address,
      "name" to null,
      "bondState" to "none",
      "type" to "unknown",
      "deviceClass" to null
    )

  fun bondStateName(state: Int): String =
    when (state) {
      BluetoothDevice.BOND_BONDED -> "bonded"
      BluetoothDevice.BOND_BONDING -> "bonding"
      else -> "none"
    }

  fun typeName(type: Int): String =
    when (type) {
      BluetoothDevice.DEVICE_TYPE_CLASSIC -> "classic"
      BluetoothDevice.DEVICE_TYPE_LE -> "le"
      BluetoothDevice.DEVICE_TYPE_DUAL -> "dual"
      else -> "unknown"
    }

  /** Returns [address] in upper case, or rejects with `INVALID_ARGUMENT`. */
  fun requireAddress(address: String): String {
    val upper = address.uppercase(Locale.ROOT)
    if (!BluetoothAdapter.checkBluetoothAddress(upper)) {
      throw BluetoothClassicException(
        ErrorCode.INVALID_ARGUMENT,
        "Invalid address: expected six colon-separated hex bytes such as \"00:11:22:AA:BB:CC\""
      )
    }
    return upper
  }
}
