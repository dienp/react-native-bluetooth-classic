package kjd.reactnative.bluetooth

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.location.LocationManager
import android.os.Looper
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import java.time.Duration
import kjd.reactnative.bluetooth.PermissionGate.Companion.CONNECT
import kjd.reactnative.bluetooth.PermissionGate.Companion.FINE_LOCATION
import kjd.reactnative.bluetooth.PermissionGate.Companion.SCAN
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

/** Every `device-discovery` Android scenario, on both sides of the Location Services band. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29, 33, 36])
class DiscoveryTest : ModuleTest() {
  private val printer = "00:11:22:AA:BB:01"
  private val scale = "00:11:22:AA:BB:02"
  private val found = mutableListOf<Map<String, Any?>>()

  @Before
  fun ready() {
    grant(SCAN, CONNECT, FINE_LOCATION)
    setLocationEnabled(true)
    module.discovery.addListener { found += it }
  }

  private fun setLocationEnabled(enabled: Boolean) =
    shadowOf(app.getSystemService(LocationManager::class.java)).setLocationEnabled(enabled)

  private fun start(timeoutMs: Double = 0.0) = call { module.startDiscovery(timeoutMs, it) }

  private fun advance(ms: Long) {
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))
  }

  private fun RecordingPromise.devices(): List<ReadableMap> {
    val array = value as ReadableArray
    return (0 until array.size()).map { array.getMap(it)!! }
  }

  private fun discoveryReceivers() =
    shadowOf(app).registeredReceivers.filter { it.intentFilter.hasAction(BluetoothDevice.ACTION_FOUND) }

  @Test
  fun `a device seen twice is reported once, with its latest name and RSSI`() {
    val promise = start()
    send(Broadcasts.discoveryStarted())
    send(Broadcasts.found(remoteDevice(printer), rssi = -70, name = "Printer"))
    send(Broadcasts.found(remoteDevice(printer), rssi = -52))
    send(Broadcasts.found(remoteDevice(scale), rssi = -60, name = "Scale"))
    send(Broadcasts.discoveryFinished())

    assertEquals(listOf(printer, scale), found.map { it["id"] })
    assertEquals(-70, found.first()["rssi"])
    val devices = promise.devices()
    assertEquals(listOf(printer, scale), devices.map { it.getString("id") })
    assertEquals("Printer", devices[0].getString("name"))
    assertEquals(-52, devices[0].getInt("rssi"))
  }

  @Test
  fun `the session ends by timeout with the devices found so far`() {
    val promise = start(timeoutMs = 5_000.0)
    send(Broadcasts.discoveryStarted())
    send(Broadcasts.found(remoteDevice(printer), rssi = -70))

    advance(4_999)
    assertFalse(promise.isSettled)
    advance(1)

    assertEquals(listOf(printer), promise.devices().map { it.getString("id") })
    assertFalse("discovery was stopped", adapter.isDiscovering)
  }

  @Test
  fun `the OS finishing the session resolves it`() {
    val promise = start()
    send(Broadcasts.discoveryStarted())
    send(Broadcasts.discoveryFinished())

    assertTrue(promise.resolved)
    assertTrue(promise.devices().isEmpty())
    assertTrue("the receiver is gone", discoveryReceivers().isEmpty())
  }

  @Test
  fun `a finish from an earlier scan does not end a new session`() {
    val promise = start()
    send(Broadcasts.discoveryFinished())
    assertFalse(promise.isSettled)

    send(Broadcasts.discoveryStarted())
    send(Broadcasts.discoveryFinished())
    assertTrue(promise.resolved)
  }

  @Test
  fun `cancelling a session that found two devices resolves both promises`() {
    val promise = start()
    send(Broadcasts.discoveryStarted())
    send(Broadcasts.found(remoteDevice(printer)))
    send(Broadcasts.found(remoteDevice(scale)))

    val cancel = call { module.cancelDiscovery(it) }

    assertTrue(cancel.resolved)
    assertEquals(2, promise.devices().size)
    assertFalse(adapter.isDiscovering)
  }

  @Test
  fun `cancelling with nothing running resolves`() {
    assertTrue(call { module.cancelDiscovery(it) }.resolved)
  }

  @Test
  fun `a second start is DISCOVERY_ALREADY_RUNNING and the first continues`() {
    val first = start()
    send(Broadcasts.discoveryStarted())

    assertEquals(ErrorCode.DISCOVERY_ALREADY_RUNNING, start().code)

    send(Broadcasts.found(remoteDevice(printer)))
    send(Broadcasts.discoveryFinished())
    assertEquals(listOf(printer), first.devices().map { it.getString("id") })
  }

  @Test
  fun `the adapter turning off rejects with BLUETOOTH_DISABLED`() {
    val promise = start()
    send(Broadcasts.discoveryStarted())

    transition(BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_ON)

    assertEquals(ErrorCode.BLUETOOTH_DISABLED, promise.code)
    assertTrue(discoveryReceivers().isEmpty())
  }

  @Test
  fun `the OS refusing to start rejects with DISCOVERY_FAILED`() {
    module.discovery.startOsDiscovery = { false }

    assertEquals(ErrorCode.DISCOVERY_FAILED, start().code)
    assertTrue(discoveryReceivers().isEmpty())
  }

  @Test
  fun `a scan the OS never starts fails instead of hanging`() {
    module.discovery.startOsDiscovery = { true }
    val promise = start()

    advance(DiscoveryManager.START_GUARD_MS)

    assertEquals(ErrorCode.DISCOVERY_FAILED, promise.code)
  }

  @Test
  fun `without a timeout the session is capped`() {
    val promise = start()
    send(Broadcasts.discoveryStarted())

    advance(DiscoveryManager.MAX_SESSION_MS)

    assertTrue(promise.resolved)
  }

  @Test
  fun `pausing the app does not stop the session`() {
    val controller = foregroundActivity()
    val promise = start()
    send(Broadcasts.discoveryStarted())
    controller.pause().stop()
    reactContext.onHostPause()

    send(Broadcasts.found(remoteDevice(printer)))
    send(Broadcasts.discoveryFinished())

    assertEquals(listOf(printer), promise.devices().map { it.getString("id") })
  }

  @Test
  fun `Location Services off fails discovery only on API 24 to 30`() {
    setLocationEnabled(false)

    val promise = start()

    if (sdkInt <= 30) {
      assertEquals(ErrorCode.LOCATION_SERVICES_DISABLED, promise.code)
    } else {
      assertFalse(promise.isSettled)
      send(Broadcasts.discoveryStarted())
      send(Broadcasts.discoveryFinished())
      assertTrue(promise.resolved)
    }
  }

  @Test
  fun `a missing scan permission is PERMISSION_DENIED`() {
    deny(SCAN, FINE_LOCATION)

    val promise = start()

    assertEquals(ErrorCode.PERMISSION_DENIED, promise.code)
    assertEquals(listOf(if (sdkInt >= 31) SCAN else FINE_LOCATION), promise.missingPermissions())
    assertTrue(discoveryReceivers().isEmpty())
  }

  @Test
  fun `Bluetooth off is BLUETOOTH_DISABLED before anything starts`() {
    shadowOf(adapter).setState(BluetoothAdapter.STATE_OFF)

    assertEquals(ErrorCode.BLUETOOTH_DISABLED, start().code)
  }

  @Test
  fun `API 29 to 30 needs fine location, API 31+ does not`() {
    assumeTrue(sdkInt >= 31)
    deny(FINE_LOCATION)

    val promise = start()
    send(Broadcasts.discoveryStarted())
    send(Broadcasts.discoveryFinished())

    assertTrue(promise.resolved)
  }
}
