package kjd.reactnative.bluetooth

import android.bluetooth.BluetoothAdapter
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import java.io.IOException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The connection entry points as JS calls them, with the fake transport under the module. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ConnectionModuleTest : ModuleTest() {
  private val address = "00:11:22:AA:BB:CC"
  private val transport = FakeRfcommTransport()

  override fun transport(): RfcommTransport = transport

  @Before
  fun grantConnect() = grant("BLUETOOTH_CONNECT")

  private fun options(vararg pairs: Pair<String, Any>): ReadableMap =
    JavaOnlyMap().apply { pairs.forEach { (key, value) -> if (value is String) putString(key, value) else putDouble(key, (value as Number).toDouble()) } }

  private fun connect(target: String = address, options: ReadableMap = options("timeoutMs" to 15_000), operationId: String = "op-1") =
    call { module.connect(operationId, target, options, it) }

  private fun connections(): ReadableArray = call { module.getConnections(it) }.value as ReadableArray

  @Test
  fun `connect resolves with the connection and the device as the OS describes it`() {
    remoteDevice(address, name = "Printer")

    val connection = connect().await().map()

    assertEquals("conn-1", connection.getString("id"))
    assertEquals("connected", connection.getString("state"))
    val device = connection.getMap("androidDevice")!!
    assertEquals(address, device.getString("id"))
    assertEquals("Printer", device.getString("name"))
    assertEquals(1, connections().size())
    assertEquals("conn-1", connections().getMap(0)!!.getString("id"))
  }

  @Test
  fun `addresses are accepted in any case`() {
    connect("00:11:22:aa:bb:cc").await()

    assertEquals(address, transport.sockets.single().remoteAddress)
  }

  @Test
  fun `invalid arguments are INVALID_ARGUMENT before any socket is created`() {
    assertEquals(ErrorCode.INVALID_ARGUMENT, connect("printer").await().code)
    assertEquals(
      ErrorCode.INVALID_ARGUMENT,
      connect(options = options("timeoutMs" to 1_000, "uuid" to "not-a-uuid")).await().code
    )
    assertEquals(
      ErrorCode.INVALID_ARGUMENT,
      connect(options = options("timeoutMs" to 1_000, "transport" to "le")).await().code
    )
    assertEquals(
      ErrorCode.INVALID_ARGUMENT,
      connect(options = options("timeoutMs" to 1_000, "fallbackChannel" to 31)).await().code
    )
    assertTrue(transport.sockets.isEmpty())
  }

  @Test
  fun `options reach the socket`() {
    transport.onConnect = { if (it.target.startsWith("uuid")) ConnectResult.Fail("refused") else ConnectResult.Succeed }

    connect(
        options =
          options(
            "timeoutMs" to 15_000,
            "transport" to "insecure",
            "uuid" to "0000ffe0-0000-1000-8000-00805f9b34fb",
            "fallbackChannel" to 2
          )
      )
      .await()

    val (uuidSocket, channelSocket) = transport.sockets.toList()
    assertEquals("uuid 0000ffe0-0000-1000-8000-00805f9b34fb", uuidSocket.target)
    assertFalse(uuidSocket.secure)
    assertEquals("channel 2", channelSocket.target)
  }

  @Test
  fun `connect without BLUETOOTH_CONNECT is PERMISSION_DENIED`() {
    deny("BLUETOOTH_CONNECT")

    val promise = connect().await()

    assertEquals(ErrorCode.PERMISSION_DENIED, promise.code)
    assertEquals(listOf("BLUETOOTH_CONNECT"), promise.missingPermissions())
    assertTrue(transport.sockets.isEmpty())
  }

  @Test
  fun `a running discovery resolves with what it found before the attempt starts`() {
    grant("BLUETOOTH_SCAN")
    val discovery = call { module.startDiscovery(0.0, it) }
    send(Broadcasts.discoveryStarted())
    send(Broadcasts.found(remoteDevice("00:11:22:33:44:55", name = "Scanner")))
    var discoverySettledFirst = false
    transport.onConnect = {
      discoverySettledFirst = discovery.isSettled
      ConnectResult.Succeed
    }

    connect().await()

    assertTrue(discoverySettledFirst)
    assertTrue(discovery.resolved)
    assertEquals(1, (discovery.value as ReadableArray).size())
  }

  @Test
  fun `write sends the decoded bytes, and bad base64 is INVALID_ARGUMENT`() {
    val id = connect().await().map().getString("id")!!
    val socket = transport.sockets.single()

    assertTrue(call { module.write(id, "G0A=", 0.0, it) }.await().resolved)
    assertArrayEquals(byteArrayOf(0x1b, 0x40), socket.written())

    // The decoder skips unknown characters, but rejects a truncated quantum.
    assertEquals(ErrorCode.INVALID_ARGUMENT, call { module.write(id, "A", 0.0, it) }.await().code)
  }

  @Test
  fun `disconnect, closeWithError, cancelOperation and cancelAccept resolve`() {
    val id = connect().await().map().getString("id")!!

    assertTrue(call { module.disconnect(id, 5_000.0, it) }.await().resolved)
    assertTrue(transport.sockets.single().closed)
    assertTrue(call { module.closeWithError(id, ErrorCode.BUFFER_OVERFLOW, "full", it) }.await().resolved)
    assertTrue(call { module.cancelOperation("op-unknown", it) }.await().resolved)
    assertTrue(call { module.cancelAccept(it) }.await().resolved)
    assertEquals(0, connections().size())
  }

  @Test
  fun `accept resolves with the incoming connection, and needs BLUETOOTH_CONNECT`() {
    val accept = call { module.accept("op-a", options("serviceName" to "Kiosk"), it) }
    val server = transport.awaitServer()
    assertEquals("Kiosk", server.serviceName)

    server.connectFrom(address)

    assertEquals(address, accept.await().map().getMap("androidDevice")!!.getString("address"))

    deny("BLUETOOTH_CONNECT")
    assertEquals(ErrorCode.PERMISSION_DENIED, call { module.accept("op-b", options(), it) }.await().code)
  }

  @Test
  fun `Bluetooth turning off ends connections and rejects pending connects and accepts`() {
    connect().await()
    val connected = transport.sockets.single()
    transport.onConnect = { ConnectResult.Hang }
    val pendingConnect = connect("00:11:22:AA:BB:DD", operationId = "op-2")
    val pendingAccept = call { module.accept("op-3", options(), it) }
    transport.awaitSocket(1)
    val server = transport.awaitServer()

    transition(BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_ON)

    assertEquals(ErrorCode.BLUETOOTH_DISABLED, pendingConnect.await().code)
    assertEquals(ErrorCode.BLUETOOTH_DISABLED, pendingAccept.await().code)
    connected.awaitClosed()
    transport.sockets[1].awaitClosed()
    server.awaitClosed()
    assertEquals(0, connections().size())
  }

  @Test
  fun `invalidate closes every socket without settling anything, and a new runtime reconnects`() {
    connect().await()
    val connected = transport.sockets.single()
    connected.blockWrites()
    val id = "conn-1"
    val write = call { module.write(id, "AQ==", 0.0, it) }
    transport.onConnect = { ConnectResult.Hang }
    val pendingConnect = connect("00:11:22:AA:BB:DD", operationId = "op-2")
    val pendingAccept = call { module.accept("op-3", options(), it) }
    transport.awaitSocket(1)
    val server = transport.awaitServer()

    module.invalidate()
    idle()

    connected.awaitClosed()
    transport.sockets[1].awaitClosed()
    server.awaitClosed()
    never { write.isSettled || pendingConnect.isSettled || pendingAccept.isSettled }

    // The reloaded runtime gets a new module, which can connect to the same device.
    module = BluetoothClassicModule(reactContext, null, transport)
    module.initialize()
    transport.onConnect = { ConnectResult.Succeed }
    val again = connect().await()
    assertTrue(again.resolved)
    assertEquals("conn-1", again.map().getString("id"))
  }

  @Test
  fun `a terminal event carries the reason, the code and the native cause`() {
    val event =
      BluetoothClassicModule.connectionStateEvent(
        "conn-1",
        "disconnected",
        "connected",
        Terminal.error(ErrorCode.WRITE_FAILED, "A write failed", IOException("Broken pipe")),
        1_700_000_000_000
      )

    assertEquals(
      mapOf(
        "connectionId" to "conn-1",
        "state" to "disconnected",
        "previousState" to "connected",
        "timestamp" to 1.7e12,
        "reason" to "error",
        "errorCode" to ErrorCode.WRITE_FAILED,
        "errorMessage" to "A write failed",
        "nativeCode" to "java.io.IOException",
        "nativeMessage" to "Broken pipe"
      ),
      event
    )
    assertEquals(
      mapOf(
        "connectionId" to "conn-1",
        "state" to "disconnecting",
        "previousState" to "connected",
        "timestamp" to 1.7e12
      ),
      BluetoothClassicModule.connectionStateEvent("conn-1", "disconnecting", "connected", null, 1_700_000_000_000)
    )
  }

  @Test
  fun `data events carry base64 and the seq number`() {
    assertEquals(
      mapOf("connectionId" to "conn-1", "data" to "G0D/", "seq" to 4.0),
      BluetoothClassicModule.dataEvent("conn-1", byteArrayOf(0x1b, 0x40, -1), 4)
    )
  }
}
