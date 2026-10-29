package kjd.reactnative.bluetooth

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import com.facebook.react.bridge.ReadableArray
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30, 36])
class BondedDevicesTest : ModuleTest() {
  private fun bond(vararg addresses: String) =
    shadowOf(adapter).setBondedDevices(
      addresses.map { remoteDevice(it, name = "Device $it", bondState = BluetoothDevice.BOND_BONDED) }.toSet()
    )

  @Test
  fun `lists every bonded device`() {
    grant(PermissionGate.CONNECT)
    bond("00:11:22:AA:BB:01", "00:11:22:AA:BB:02")

    val devices = call { module.getBondedDevices(it) }.value as ReadableArray

    assertEquals(2, devices.size())
    val listed = (0 until devices.size()).map { devices.getMap(it)!! }
    assertEquals(setOf("00:11:22:AA:BB:01", "00:11:22:AA:BB:02"), listed.map { it.getString("id") }.toSet())
    listed.forEach { assertEquals("bonded", it.getString("bondState")) }
  }

  @Test
  fun `on API 31+ a missing BLUETOOTH_CONNECT is PERMISSION_DENIED`() {
    assumeTrue(sdkInt >= 31)
    bond("00:11:22:AA:BB:01")

    val promise = call { module.getBondedDevices(it) }

    assertEquals(ErrorCode.PERMISSION_DENIED, promise.code)
    assertEquals(listOf("BLUETOOTH_CONNECT"), promise.missingPermissions())
  }

  @Test
  fun `on API 30 and below no runtime permission is needed`() {
    assumeTrue(sdkInt <= 30)
    bond("00:11:22:AA:BB:01")

    assertEquals(1, (call { module.getBondedDevices(it) }.value as ReadableArray).size())
  }

  @Test
  fun `Bluetooth off is BLUETOOTH_DISABLED`() {
    grant(PermissionGate.CONNECT)
    shadowOf(adapter).setState(BluetoothAdapter.STATE_OFF)

    assertEquals(ErrorCode.BLUETOOTH_DISABLED, call { module.getBondedDevices(it) }.code)
  }
}
