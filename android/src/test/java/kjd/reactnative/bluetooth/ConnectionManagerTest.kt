package kjd.reactnative.bluetooth

import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
internal class ConnectionManagerTest : ConnectionTest() {
  private val other = "00:11:22:AA:BB:DD"

  @Test
  fun `connection ids are unique for the life of the manager`() {
    val (first, firstSocket) = connected()
    firstSocket.peerClose()
    events.awaitTerminal(first)
    val (second, _) = connected()
    val (third, _) = connected(other)

    assertEquals(listOf("conn-1", "conn-2", "conn-3"), listOf(first, second, third))
  }

  @Test
  fun `a second connect to a connected device is ALREADY_CONNECTED naming the existing connection`() {
    val (id, socket) = connected()

    val second = connect().await()

    assertEquals(ErrorCode.ALREADY_CONNECTED, second.code)
    assertEquals(id, second.userInfo?.getString("connectionId"))
    assertEquals(address, second.userInfo?.getString("deviceId"))
    assertEquals(1, transport.sockets.size)
    assertFalse(socket.closed)
    assertEquals(listOf(id), openIds())
  }

  @Test
  fun `a connect while another to the same device is pending is ALREADY_CONNECTING`() {
    transport.onConnect = { ConnectResult.Hang }
    val first = connect()
    transport.awaitSocket()

    val second = connect().await()

    assertEquals(ErrorCode.ALREADY_CONNECTING, second.code)
    assertFalse(first.isSettled)
    assertEquals(1, transport.sockets.size)
  }

  @Test
  fun `different devices connect independently`() {
    val (first, _) = connected()
    val (second, _) = connected(other)

    assertEquals(listOf(first, second), openIds())
  }

  @Test
  fun `getConnections lists connections in the order they opened, even within one millisecond`() {
    val ids = (1..8).map { connected("00:11:22:AA:BB:%02X".format(it)).first }

    assertEquals(ids, openIds())
  }

  @Test
  fun `getConnections lists only connections that have not ended`() {
    val (first, firstSocket) = connected()
    val (second, _) = connected(other)

    firstSocket.peerClose()
    events.awaitTerminal(first)

    assertEquals(listOf(second), openIds())
    val listed = manager.list().single()
    assertEquals("connected", listed["state"])
    assertEquals(other, (listed["androidDevice"] as Map<*, *>)["address"])
  }

  @Test
  fun `stale events never affect newer connections`() {
    val (old, oldSocket) = connected()
    oldSocket.peerClose()
    events.awaitTerminal(old)
    val (current, currentSocket) = connected()

    // Late OS notifications about the old link, and late calls naming it.
    oldSocket.failReads()
    manager.closeWithError(old, ErrorCode.BUFFER_OVERFLOW, "late")
    disconnect(old).await()
    write(old, byteArrayOf(1)).await().also { assertEquals(ErrorCode.NOT_CONNECTED, it.code) }

    never { currentSocket.closed }
    assertEquals(listOf(current), openIds())
    assertTrue(events.terminals(current).isEmpty())
    assertEquals(1, events.terminals(old).size)
    // The address is still taken by the new connection.
    assertEquals(ErrorCode.ALREADY_CONNECTED, connect().await().code)
  }

  @Test
  fun `a reconnect from the terminal event succeeds, and the old connection's cleanup leaves it alone`() {
    val (old, oldSocket) = connected()
    val reconnect = AtomicReference<RecordingPromise>()
    // JS may reconnect as soon as it sees the terminal event, before the old connection is dropped.
    events.onTerminal = { id -> if (id == old) reconnect.set(connect().await()) }

    oldSocket.peerClose()
    eventually { reconnect.get() != null }

    val current = reconnect.get().map().getString("id")!!
    assertEquals(listOf(current), openIds())
    val third = connect().await()
    assertEquals(ErrorCode.ALREADY_CONNECTED, third.code)
    assertEquals(current, third.userInfo?.getString("connectionId"))
  }

  @Test
  fun `a device can be connected again once its connection ended`() {
    val (first, socket) = connected()
    disconnect(first).await()
    assertTrue(socket.closed)

    val (second, _) = connected()

    assertEquals(listOf(second), openIds())
  }
}
