package kjd.reactnative.bluetooth

import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class InvalidateTest : ModuleTest() {
  @Test
  fun `no receiver remains registered after invalidation`() {
    assertEquals(1, registeredStateReceivers().size)

    module.invalidate()

    assertTrue(registeredStateReceivers().isEmpty())
  }

  @Test
  fun `no bond or discovery receiver remains after invalidation`() {
    grant(PermissionGate.SCAN, PermissionGate.CONNECT, PermissionGate.FINE_LOCATION)
    val discovery = call { module.startDiscovery(0.0, it) }
    val actions = listOf(BluetoothDevice.ACTION_BOND_STATE_CHANGED, BluetoothDevice.ACTION_FOUND)
    fun registered() = shadowOf(app).registeredReceivers.filter { r -> actions.any { r.intentFilter.hasAction(it) } }
    assertEquals(2, registered().size)

    module.invalidate()

    assertTrue(registered().isEmpty())
    assertFalse("the dropped session never settles", discovery.isSettled)
  }

  @Test
  fun `a pending pairing is dropped`() {
    grant(PermissionGate.CONNECT)
    val device = adapter.getRemoteDevice("00:11:22:AA:BB:CC")
    shadowOf(device).setCreatedBond(true)
    val promise = call { module.pair(device.address, 60_000.0, it) }

    module.invalidate()
    app.sendBroadcast(Broadcasts.bondState(device, BluetoothDevice.BOND_BONDED, BluetoothDevice.BOND_BONDING))
    idle()

    assertFalse(promise.isSettled)
  }

  @Test
  fun `adapter events stop after invalidation`() {
    val events = mutableListOf<String>()
    module.adapterMonitor.addListener { state, _ -> events += state }

    module.invalidate()
    transition(BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_ON)

    assertTrue(events.isEmpty())
  }

  @Test
  fun `a pending enable request is dropped, not delivered to the next runtime`() {
    grant(PermissionGate.CONNECT)
    shadowOf(adapter).setState(BluetoothAdapter.STATE_OFF)
    val activity = foregroundActivity().get()
    val promise = call { module.requestEnable(it) }

    module.invalidate()
    idle()
    reactContext.onActivityResult(activity, EnableRequester.REQUEST_CODE, Activity.RESULT_CANCELED, null)
    transition(BluetoothAdapter.STATE_ON, BluetoothAdapter.STATE_TURNING_ON)

    assertFalse(promise.isSettled)
  }

  @Test
  fun `a pending permission request is dropped`() {
    val activity = foregroundActivity().get()
    val promise = call { module.requestPermissions("discovery", it) }

    module.invalidate()
    idle()
    reactContext.onHostPause()
    reactContext.onHostResume(activity)
    idle()

    assertFalse(promise.isSettled)
  }

  @Test
  fun `a permission result arriving right after invalidation is dropped`() {
    val activity = foregroundActivity().get()
    val promise = call { module.requestPermissions("discovery", it) }
    val prompt = activity.prompts.single()

    module.invalidate() // On the main thread, as in Robolectric: no idle() in between.
    prompt.listener!!.onRequestPermissionsResult(prompt.requestCode, prompt.permissions.toTypedArray(), IntArray(0))
    idle()

    assertFalse(promise.isSettled)
  }

  @Test
  fun `the log level returns to the default for the next runtime`() {
    module.setLogLevel("debug")

    module.invalidate()

    assertEquals(Logger.DEFAULT_LEVEL, Logger.level)
  }

  @Test
  fun `calls queued for the main thread before invalidation do not run`() {
    grant(PermissionGate.CONNECT)
    shadowOf(adapter).setState(BluetoothAdapter.STATE_OFF)
    val activity = foregroundActivity().get()
    val promise = RecordingPromise()

    module.requestEnable(promise)
    module.invalidate()
    idle()

    assertFalse(promise.isSettled)
    assertEquals(null, shadowOf(activity).nextStartedActivityForResult)
  }
}
