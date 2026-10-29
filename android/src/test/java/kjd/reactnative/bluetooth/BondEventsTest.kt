package kjd.reactnative.bluetooth

import android.bluetooth.BluetoothDevice.BOND_BONDED
import android.bluetooth.BluetoothDevice.BOND_BONDING
import android.bluetooth.BluetoothDevice.BOND_NONE
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35, 36])
class BondEventsTest : ModuleTest() {
  private val address = "00:11:22:AA:BB:CC"
  private val changes = mutableListOf<Triple<String, String, String>>()
  private val lost = mutableListOf<String>()

  @Before
  fun listen() {
    module.bonds.addListener(
      object : BondManager.Listener {
        override fun onBondStateChange(device: Map<String, Any?>, state: String, previousState: String) {
          assertEquals(state, device["bondState"])
          changes += Triple(device["id"] as String, previousState, state)
        }

        override fun onBondLost(device: Map<String, Any?>) {
          lost += device["id"] as String
        }
      }
    )
  }

  @Test
  fun `every bond transition of any device is delivered`() {
    val device = remoteDevice(address)

    send(Broadcasts.bondState(device, BOND_BONDING, BOND_NONE))
    send(Broadcasts.bondState(device, BOND_BONDED, BOND_BONDING))
    send(Broadcasts.bondState(device, BOND_NONE, BOND_BONDED))

    assertEquals(
      listOf(Triple(address, "none", "bonding"), Triple(address, "bonding", "bonded"), Triple(address, "bonded", "none")),
      changes
    )
  }

  @Test
  fun `bonds completing behind the system pairing dialog are delivered`() {
    val controller = foregroundActivity()
    controller.pause()
    reactContext.onHostPause()

    send(Broadcasts.bondState(remoteDevice(address), BOND_BONDED, BOND_BONDING))

    assertEquals(listOf(Triple(address, "bonding", "bonded")), changes)
  }

  @Test
  fun `bond loss is reported on API 36 and later only`() {
    send(Broadcasts.keyMissing(remoteDevice(address, bondState = BOND_BONDED)))

    if (sdkInt >= 36) assertEquals(listOf(address), lost) else assertTrue(lost.isEmpty())
  }

  @Test
  fun `the bond receiver lives on the application context`() {
    val receivers =
      org.robolectric.Shadows.shadowOf(app).registeredReceivers.filter {
        it.intentFilter.hasAction(android.bluetooth.BluetoothDevice.ACTION_BOND_STATE_CHANGED)
      }

    assertEquals(1, receivers.size)
    assertEquals(sdkInt >= 36, receivers.single().intentFilter.hasAction(BondManager.ACTION_KEY_MISSING))
  }
}
