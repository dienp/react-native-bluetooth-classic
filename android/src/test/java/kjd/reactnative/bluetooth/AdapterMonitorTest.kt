package kjd.reactnative.bluetooth

import android.bluetooth.BluetoothAdapter
import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 36])
class AdapterMonitorTest : ModuleTest() {
  private val events = mutableListOf<Pair<String, String>>()

  private fun listen() = module.adapterMonitor.addListener { state, previous -> events += state to previous }

  @Test
  fun `getAdapterState reports the OS state`() {
    assertEquals("on", call { module.getAdapterState(it) }.value)

    shadowAdapterState(BluetoothAdapter.STATE_TURNING_OFF)
    assertEquals("turningOff", call { module.getAdapterState(it) }.value)
    shadowAdapterState(BluetoothAdapter.STATE_OFF)
    assertEquals("off", call { module.getAdapterState(it) }.value)
    shadowAdapterState(BluetoothAdapter.STATE_TURNING_ON)
    assertEquals("turningOn", call { module.getAdapterState(it) }.value)
  }

  @Test
  fun `turning Bluetooth off delivers turningOff then off with the previous state`() {
    listen()

    transition(BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_ON)
    transition(BluetoothAdapter.STATE_OFF, BluetoothAdapter.STATE_TURNING_OFF)

    assertEquals(listOf("turningOff" to "on", "off" to "turningOff"), events)
  }

  @Test
  fun `transitions while the host activity is paused are still delivered`() {
    listen()
    val controller = foregroundActivity()
    controller.pause().stop()
    reactContext.onHostPause()

    transition(BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_ON)
    transition(BluetoothAdapter.STATE_OFF, BluetoothAdapter.STATE_TURNING_OFF)
    transition(BluetoothAdapter.STATE_TURNING_ON, BluetoothAdapter.STATE_OFF)
    transition(BluetoothAdapter.STATE_ON, BluetoothAdapter.STATE_TURNING_ON)

    assertEquals(
      listOf("turningOff" to "on", "off" to "turningOff", "turningOn" to "off", "on" to "turningOn"),
      events
    )
  }

  @Test
  fun `a listener that throws does not stop the others`() {
    module.adapterMonitor.addListener { _, _ -> throw IllegalStateException("listener bug") }
    listen()

    transition(BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_ON)

    assertEquals(listOf("turningOff" to "on"), events)
  }

  @Test
  fun `the event sent to JS carries state, previous state and timestamp`() {
    assertEquals(
      mapOf("state" to "off", "previousState" to "turningOff", "timestamp" to 1_700_000_000_000.0),
      BluetoothClassicModule.adapterStateEvent("off", "turningOff", 1_700_000_000_000L)
    )
  }

  @Test
  fun `the state receiver is exported and lives on the application context`() {
    val receiver = registeredStateReceivers().single()

    // Application.registerReceiver lands on the application's base context.
    assertSame(app.baseContext, receiver.context)
    if (sdkInt >= 33) {
      assertEquals(Context.RECEIVER_EXPORTED, receiver.flags and Context.RECEIVER_EXPORTED)
    }
  }

  private fun shadowAdapterState(state: Int) =
    org.robolectric.Shadows.shadowOf(adapter).setState(state)
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class NoBluetoothHardwareTest : ModuleTest() {
  override fun adapterProvider(): () -> BluetoothAdapter? = { null }

  @Test
  fun `getAdapterState resolves unavailable`() {
    assertEquals("unavailable", call { module.getAdapterState(it) }.value)
  }

  @Test
  fun `operations that need the adapter reject with BLUETOOTH_UNAVAILABLE before checking permissions`() {
    deny(PermissionGate.CONNECT)
    foregroundActivity()

    assertEquals(ErrorCode.BLUETOOTH_UNAVAILABLE, call { module.setAdapterName("Kiosk 12", it) }.code)
    assertEquals(ErrorCode.BLUETOOTH_UNAVAILABLE, call { module.requestEnable(it) }.code)
  }
}
