package kjd.reactnative.bluetooth

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothDevice.BOND_BONDED
import android.bluetooth.BluetoothDevice.BOND_NONE
import android.os.Looper
import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** `unpair()` through reflection on every API level. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33, 36])
class UnpairTest : ModuleTest() {
  private val address = "00:11:22:AA:BB:CC"
  private lateinit var device: BluetoothDevice

  @Before
  fun ready() {
    grant(PermissionGate.CONNECT)
    device = remoteDevice(address, bondState = BOND_BONDED)
  }

  private fun unpair() = call { module.unpair(address, it) }

  @Test
  fun `removes the bond through the hidden OS call where it is allowed`() {
    // Robolectric's removeBond() succeeds when this flag is set.
    shadowOf(device).setCreatedBond(true)

    val promise = unpair()
    assertFalse("waits for the bond to go", promise.isSettled)
    send(Broadcasts.bondState(device, BOND_NONE, BOND_BONDED))

    assertTrue(promise.resolved)
  }

  @Test
  fun `a device that is not bonded resolves immediately`() {
    shadowOf(device).setBondState(BOND_NONE)

    assertTrue(unpair().resolved)
  }

  @Test
  fun `the OS refusing is UNSUPPORTED_ON_PLATFORM pointing to system settings`() {
    // removeBond() returns false.
    val promise = unpair()

    assertEquals(ErrorCode.UNSUPPORTED_ON_PLATFORM, promise.code)
    assertTrue(promise.message!!.contains("system settings"))
    assertEquals(address, promise.userInfo?.getString("deviceId"))
  }

  @Test
  fun `a blocked hidden API is UNSUPPORTED_ON_PLATFORM`() {
    for (blocked in listOf(NoSuchMethodException("removeBond"), SecurityException("BLUETOOTH_PRIVILEGED"), IllegalAccessException())) {
      module.bonds.bondApi = RecordingBondApi(blockWith = blocked)

      val promise = unpair()

      assertEquals(blocked.javaClass.name, ErrorCode.UNSUPPORTED_ON_PLATFORM, promise.code)
      assertEquals(blocked.javaClass.name, promise.userInfo?.getString("nativeCode"))
    }
  }

  @Test
  fun `concurrent calls for the same device share the outcome`() {
    module.bonds.bondApi = RecordingBondApi()

    val first = unpair()
    val second = unpair()
    send(Broadcasts.bondState(device, BOND_NONE, BOND_BONDED))

    assertTrue(first.resolved)
    assertTrue(second.resolved)
  }

  @Test
  fun `the adapter turning off rejects with BLUETOOTH_DISABLED`() {
    module.bonds.bondApi = RecordingBondApi()
    val promise = unpair()

    transition(BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_ON)

    assertEquals(ErrorCode.BLUETOOTH_DISABLED, promise.code)
  }

  @Test
  fun `a bond that never goes away fails instead of hanging`() {
    module.bonds.bondApi = RecordingBondApi()
    val promise = unpair()

    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(BondManager.UNPAIR_GUARD_MS))

    assertEquals(ErrorCode.UNKNOWN, promise.code)
  }
}
