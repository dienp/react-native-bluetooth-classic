package kjd.reactnative.bluetooth

import java.io.IOException
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
internal class ConnectTest : ConnectionTest() {
  private val refusal = "read failed, socket might closed or timeout, read ret: -1"

  @Test
  fun `a successful connect resolves with a connected connection on a secure SPP socket`() {
    val promise = connect().await()

    assertTrue(promise.resolved)
    val connection = promise.map()
    assertEquals("conn-1", connection.getString("id"))
    assertEquals("connected", connection.getString("state"))
    assertTrue(connection.getDouble("connectedAt") > 0)
    assertEquals(address, connection.device().getString("address"))
    val socket = transport.sockets.single()
    assertEquals("uuid ${RfcommTransport.SPP_UUID}", socket.target)
    assertTrue(socket.secure)
    assertFalse(socket.closed)
  }

  @Test
  fun `the insecure transport and a custom uuid reach the socket`() {
    val uuid = UUID.fromString("0000FFE0-0000-1000-8000-00805F9B34FB")

    connect(options = ConnectOptions(timeoutMs = 15_000, secure = false, uuid = uuid)).await()

    val socket = transport.sockets.single()
    assertEquals("uuid $uuid", socket.target)
    assertFalse(socket.secure)
  }

  @Test
  fun `discovery is stopped before the attempt starts`() {
    val order = CopyOnWriteArrayList<String>()
    transport.onConnect = {
      order += "socket"
      ConnectResult.Succeed
    }

    connect(beforeAttempt = { order += "stop discovery" }).await()

    assertEquals(listOf("stop discovery", "socket"), order)
  }

  @Test
  fun `a rejected target does not stop discovery`() {
    connected()
    var stopped = false

    connect(beforeAttempt = { stopped = true }).await()

    assertFalse(stopped)
  }

  @Test
  fun `an unreachable device is CONNECT_FAILED with the OS reason, and the socket is closed`() {
    transport.onConnect = { ConnectResult.Fail(refusal) }

    val promise = connect().await()

    assertEquals(ErrorCode.CONNECT_FAILED, promise.code)
    assertEquals(refusal, promise.nativeMessage())
    assertEquals(IOException::class.java.name, promise.userInfo?.getString("nativeCode"))
    assertEquals(address, promise.userInfo?.getString("deviceId"))
    assertTrue(transport.sockets.single().closed)
    assertTrue(openIds().isEmpty())
  }

  @Test
  fun `a socket the OS cannot create is CONNECT_FAILED`() {
    transport.createFailure = IOException("Bluetooth is off")

    val promise = connect().await()

    assertEquals(ErrorCode.CONNECT_FAILED, promise.code)
    assertEquals("Bluetooth is off", promise.nativeMessage())
  }

  @Test
  fun `a connect that does not complete in time is CONNECT_TIMEOUT and closes the socket`() {
    transport.onConnect = { ConnectResult.Hang }
    val promise = connect(options = ConnectOptions(timeoutMs = 8_000))
    val socket = transport.awaitSocket()

    scheduler.advance(7_999)
    never { promise.isSettled }
    scheduler.advance(1)

    promise.await()
    assertEquals(ErrorCode.CONNECT_TIMEOUT, promise.code)
    assertEquals(address, promise.userInfo?.getString("deviceId"))
    socket.awaitClosed()
    assertEquals(1, promise.settleCount)
  }

  @Test
  fun `a link the OS reports after the timeout is closed, and no connection is created`() {
    val gate = CountDownLatch(1)
    transport.onConnect = { ConnectResult.Late(gate) }
    val promise = connect(options = ConnectOptions(timeoutMs = 1_000))
    val socket = transport.awaitSocket()
    scheduler.advance(1_000)
    assertEquals(ErrorCode.CONNECT_TIMEOUT, promise.await().code)

    gate.countDown()

    eventually { socket.connected }
    socket.awaitClosed()
    never { openIds().isNotEmpty() }
    assertTrue(events.states.isEmpty())
    assertEquals(1, promise.settleCount)
  }

  @Test
  fun `cancelling a pending connect is CONNECT_CANCELLED, closes the socket and frees the device`() {
    transport.onConnect = { ConnectResult.Hang }
    val promise = connect(operationId = "op-cancel")
    val socket = transport.awaitSocket()

    manager.cancelOperation("op-cancel")

    assertEquals(ErrorCode.CONNECT_CANCELLED, promise.await().code)
    socket.awaitClosed()
    assertTrue(openIds().isEmpty())
    transport.onConnect = { ConnectResult.Succeed }
    assertTrue(connect().await().resolved)
  }

  @Test
  fun `cancelling after the connect settled has no effect`() {
    val promise = connect(operationId = "op-done").await()
    val socket = transport.sockets.single()

    manager.cancelOperation("op-done")
    manager.cancelOperation("unknown")

    assertEquals(1, promise.settleCount)
    assertFalse(socket.closed)
    assertEquals(listOf("conn-1"), openIds())
  }

  @Test
  fun `the fallback channel is tried once after the uuid attempt fails, leaving one socket open`() {
    transport.onConnect = { if (it.target.startsWith("uuid")) ConnectResult.Fail(refusal) else ConnectResult.Succeed }

    val promise = connect(options = ConnectOptions(timeoutMs = 15_000, fallbackChannel = 1)).await()

    assertTrue(promise.resolved)
    val (uuidSocket, channelSocket) = transport.sockets.toList()
    assertEquals("channel 1", channelSocket.target)
    assertTrue(uuidSocket.closed)
    assertFalse(channelSocket.closed)
    assertEquals(2, transport.sockets.size)
  }

  @Test
  fun `when both attempts fail the rejection reports both reasons`() {
    transport.onConnect = {
      if (it.target.startsWith("uuid")) ConnectResult.Fail(refusal) else ConnectResult.Fail("Connection refused")
    }

    val promise = connect(options = ConnectOptions(timeoutMs = 15_000, fallbackChannel = 3)).await()

    assertEquals(ErrorCode.CONNECT_FAILED, promise.code)
    assertEquals(
      "uuid ${RfcommTransport.SPP_UUID}: $refusal; channel 3: Connection refused",
      promise.nativeMessage()
    )
    assertTrue(transport.sockets.all { it.closed })
  }

  @Test
  fun `no channel is tried without the fallback option`() {
    transport.onConnect = { ConnectResult.Fail(refusal) }

    assertEquals(ErrorCode.CONNECT_FAILED, connect().await().code)

    never { transport.sockets.size > 1 }
    assertEquals(1, transport.sockets.size)
  }

  @Test
  fun `a cancel during the uuid attempt skips the fallback`() {
    transport.onConnect = { ConnectResult.Hang }
    val promise = connect(operationId = "op-x", options = ConnectOptions(timeoutMs = 15_000, fallbackChannel = 1))
    transport.awaitSocket()

    manager.cancelOperation("op-x")

    assertEquals(ErrorCode.CONNECT_CANCELLED, promise.await().code)
    never { transport.sockets.size > 1 }
  }

  @Test
  fun `a connect with no timeout waits for the OS`() {
    transport.onConnect = { ConnectResult.Hang }
    val promise = connect(options = ConnectOptions(timeoutMs = 0))
    transport.awaitSocket()

    assertEquals(0, scheduler.pending)
    never { promise.isSettled }
    assertNull(promise.code)
  }
}
