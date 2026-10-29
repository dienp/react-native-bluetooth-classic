package kjd.reactnative.bluetooth

import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class DeviceMapperTest : ModuleTest() {
  private val address = "00:11:22:AA:BB:CC"

  @Test
  fun `maps every field of an Android device`() {
    val device = remoteDevice(address, name = "Printer", bondState = BluetoothDevice.BOND_BONDED)
    // Audio/video wearable headset: major 0x0400, device class 0x0404.
    shadowOf(device).setBluetoothClass(
      ReflectionHelpers.callConstructor(
        BluetoothClass::class.java,
        ReflectionHelpers.ClassParameter.from(Int::class.javaPrimitiveType, 0x240404)
      )
    )

    val map = DeviceMapper.toMap(device)

    assertEquals(address, map["id"])
    assertEquals(address, map["address"])
    assertEquals("Printer", map["name"])
    assertEquals("bonded", map["bondState"])
    assertEquals("classic", map["type"])
    assertEquals(mapOf("major" to 0x0400, "value" to 0x0404), map["deviceClass"])
    assertFalse("rssi only comes from discovery", map.containsKey("rssi"))
  }

  @Test
  fun `unknown names and classes are null, and discovery adds rssi`() {
    val device = remoteDevice(address)

    val map = DeviceMapper.toMap(device, rssi = -61)

    assertNull(map["name"])
    assertNull(map["deviceClass"])
    assertEquals(-61, map["rssi"])
  }

  @Test
  fun `bond states and device types use the JS names`() {
    assertEquals("none", DeviceMapper.bondStateName(BluetoothDevice.BOND_NONE))
    assertEquals("bonding", DeviceMapper.bondStateName(BluetoothDevice.BOND_BONDING))
    assertEquals("bonded", DeviceMapper.bondStateName(BluetoothDevice.BOND_BONDED))
    assertEquals("classic", DeviceMapper.typeName(BluetoothDevice.DEVICE_TYPE_CLASSIC))
    assertEquals("le", DeviceMapper.typeName(BluetoothDevice.DEVICE_TYPE_LE))
    assertEquals("dual", DeviceMapper.typeName(BluetoothDevice.DEVICE_TYPE_DUAL))
    assertEquals("unknown", DeviceMapper.typeName(BluetoothDevice.DEVICE_TYPE_UNKNOWN))
  }

  @Test
  fun `addresses are accepted in either case and returned in upper case`() {
    assertEquals(address, DeviceMapper.requireAddress("00:11:22:aa:bb:cc"))
  }

  @Test
  fun `a malformed address is INVALID_ARGUMENT`() {
    for (bad in listOf("00:11:22", "00-11-22-AA-BB-CC", "", "GG:11:22:AA:BB:CC")) {
      val error = runCatching { DeviceMapper.requireAddress(bad) }.exceptionOrNull()
      assertEquals(bad, ErrorCode.INVALID_ARGUMENT, (error as BluetoothClassicException).code)
    }
    grant(PermissionGate.CONNECT)
    assertEquals(ErrorCode.INVALID_ARGUMENT, call { module.pair("00:11:22", 60_000.0, it) }.code)
    assertEquals(ErrorCode.INVALID_ARGUMENT, call { module.unpair("00:11:22", it) }.code)
  }
}
