package kjd.reactnative.bluetooth

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothDevice.BOND_BONDED
import android.bluetooth.BluetoothDevice.BOND_BONDING
import android.bluetooth.BluetoothDevice.BOND_NONE
import android.os.Looper
import com.facebook.react.bridge.ReadableMap
import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** Records the bond calls the library makes; can simulate an OS that blocks them. */
class RecordingBondApi(private val blockWith: Throwable? = null, private val result: Boolean = true) : BondApi {
  val calls = mutableListOf<Pair<String, String>>()

  override fun removeBond(device: BluetoothDevice): Boolean = record("removeBond", device)

  override fun cancelBondProcess(device: BluetoothDevice): Boolean = record("cancelBondProcess", device)

  private fun record(name: String, device: BluetoothDevice): Boolean {
    calls += name to device.address
    blockWith?.let { throw it }
    return result
  }
}

/** Every `device-pairing` "Pair" scenario. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33, 36])
class PairingTest : ModuleTest() {
  private val address = "00:11:22:AA:BB:CC"
  private val other = "00:11:22:AA:BB:DD"
  private lateinit var device: BluetoothDevice
  private val bondApi = RecordingBondApi()

  @Before
  fun ready() {
    grant(PermissionGate.CONNECT)
    device = remoteDevice(address, name = "Printer")
    // Robolectric's createBond() returns this flag.
    shadowOf(device).setCreatedBond(true)
    module.bonds.bondApi = bondApi
  }

  private fun pair(target: String = address, timeoutMs: Double = 60_000.0) =
    call { module.pair(target, timeoutMs, it) }

  private fun bond(target: BluetoothDevice, state: Int, previous: Int) =
    send(Broadcasts.bondState(target, state, previous))

  @Test
  fun `resolves with the bonded device once the user confirms`() {
    val promise = pair()
    assertFalse(promise.isSettled)

    bond(device, BOND_BONDING, BOND_NONE)
    assertFalse(promise.isSettled)
    bond(device, BOND_BONDED, BOND_BONDING)

    val result = promise.value as ReadableMap
    assertEquals(address, result.getString("id"))
    assertEquals("bonded", result.getString("bondState"))
  }

  @Test
  fun `an already bonded device resolves immediately`() {
    shadowOf(device).setBondState(BOND_BONDED)

    val promise = pair()

    assertEquals("bonded", (promise.value as ReadableMap).getString("bondState"))
  }

  @Test
  fun `bonding that ends without a bond is PAIRING_FAILED`() {
    val promise = pair()
    bond(device, BOND_BONDING, BOND_NONE)
    bond(device, BOND_NONE, BOND_BONDING)

    assertEquals(ErrorCode.PAIRING_FAILED, promise.code)
    assertEquals(address, promise.userInfo?.getString("deviceId"))
  }

  @Test
  fun `another device changing bond state does not affect the pending pairing`() {
    val promise = pair()
    val stranger = remoteDevice(other)
    bond(stranger, BOND_BONDED, BOND_BONDING)
    bond(stranger, BOND_NONE, BOND_BONDED)

    assertFalse(promise.isSettled)
    bond(device, BOND_BONDED, BOND_BONDING)
    assertTrue(promise.resolved)
  }

  @Test
  fun `a timeout is PAIRING_TIMEOUT and cancels the bonding attempt`() {
    val promise = pair(timeoutMs = 30_000.0)
    bond(device, BOND_BONDING, BOND_NONE)

    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(29_999))
    assertFalse(promise.isSettled)
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1))

    assertEquals(ErrorCode.PAIRING_TIMEOUT, promise.code)
    assertEquals(listOf("cancelBondProcess" to address), bondApi.calls)
  }

  @Test
  fun `a timeout still rejects when cancelling the attempt is blocked`() {
    module.bonds.bondApi = RecordingBondApi(blockWith = NoSuchMethodException("cancelBondProcess"))
    val promise = pair(timeoutMs = 1_000.0)

    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1_000))

    assertEquals(ErrorCode.PAIRING_TIMEOUT, promise.code)
  }

  @Test
  fun `the OS refusing to start bonding is PAIRING_FAILED immediately`() {
    shadowOf(device).setCreatedBond(false)

    val promise = pair()

    assertEquals(ErrorCode.PAIRING_FAILED, promise.code)
    // A later attempt is not blocked by the failed one.
    shadowOf(device).setCreatedBond(true)
    assertFalse(pair().isSettled)
  }

  @Test
  fun `a second call for the same device is PAIRING_IN_PROGRESS and the first continues`() {
    val first = pair()

    assertEquals(ErrorCode.PAIRING_IN_PROGRESS, pair().code)

    bond(device, BOND_BONDED, BOND_BONDING)
    assertTrue(first.resolved)
  }

  @Test
  fun `different devices can pair at the same time`() {
    shadowOf(remoteDevice(other)).setCreatedBond(true)

    val first = pair()
    val second = pair(other)
    bond(remoteDevice(other, bondState = BOND_BONDING), BOND_BONDED, BOND_BONDING)
    bond(device, BOND_BONDED, BOND_BONDING)

    assertTrue(first.resolved)
    assertTrue(second.resolved)
  }

  @Test
  fun `lower-case addresses are the same device`() {
    val promise = pair(address.lowercase())
    bond(device, BOND_BONDED, BOND_BONDING)

    assertEquals(address, (promise.value as ReadableMap).getString("id"))
  }

  @Test
  fun `the adapter turning off rejects with BLUETOOTH_DISABLED`() {
    val promise = pair()

    transition(BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_ON)

    assertEquals(ErrorCode.BLUETOOTH_DISABLED, promise.code)
  }

  @Test
  fun `on API 31+ a missing BLUETOOTH_CONNECT is PERMISSION_DENIED`() {
    assumeTrue(sdkInt >= 31)
    deny(PermissionGate.CONNECT)

    assertEquals(ErrorCode.PERMISSION_DENIED, pair().code)
  }
}
