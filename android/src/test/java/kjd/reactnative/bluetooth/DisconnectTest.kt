package kjd.reactnative.bluetooth

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
internal class DisconnectTest : ConnectionTest() {
  private val receipt = "RECEIPT\n".repeat(500).toByteArray()

  @Test
  fun `write then disconnect immediately sends the bytes before closing`() {
    val (id, socket) = connected()
    socket.blockWrites()

    val write = write(id, receipt)
    val disconnect = disconnect(id)
    eventually { events.statesOf(id).isNotEmpty() }
    never { socket.closed }
    socket.unblockWrites()

    assertTrue(write.await().resolved)
    assertTrue(disconnect.await().resolved)
    assertArrayEquals(receipt, socket.written())
    assertTrue(socket.closed)
    assertEquals(listOf("state:connected->disconnecting", "state:disconnecting->disconnected"), events.logOf(id))
    assertEquals(Terminal.LOCAL, events.terminals(id).single().terminal?.reason)
    assertTrue(openIds().isEmpty())
  }

  @Test
  fun `writes still pending when the timeout elapses are NOT_CONNECTED`() {
    val (id, socket) = connected()
    socket.blockWrites()
    val stalled = write(id, byteArrayOf(1))
    val queued = write(id, byteArrayOf(2))
    val disconnect = disconnect(id, timeoutMs = 5_000)
    eventually { scheduler.pending == 1 }

    scheduler.advance(5_000)

    assertTrue(disconnect.await().resolved)
    assertEquals(ErrorCode.NOT_CONNECTED, stalled.await().code)
    assertEquals(ErrorCode.NOT_CONNECTED, queued.await().code)
    assertEquals(Terminal.LOCAL, events.awaitTerminal(id).reason)
    assertTrue(socket.closed)
  }

  @Test
  fun `disconnecting twice resolves and does nothing else`() {
    val (id, _) = connected()
    disconnect(id).await()
    val before = events.log.toList()

    assertTrue(disconnect(id).await().resolved)

    assertEquals(before, events.log.toList())
  }

  @Test
  fun `concurrent disconnects share one close`() {
    val (id, socket) = connected()
    socket.blockWrites()
    write(id, byteArrayOf(1))

    val first = disconnect(id)
    val second = disconnect(id)
    socket.unblockWrites()

    assertTrue(first.await().resolved)
    assertTrue(second.await().resolved)
    assertEquals(1, events.terminals(id).size)
    assertEquals(1, events.statesOf(id).count { it.state == "disconnecting" })
  }

  @Test
  fun `writes after disconnect started are NOT_CONNECTED`() {
    val (id, socket) = connected()
    socket.blockWrites()
    write(id, byteArrayOf(1))
    disconnect(id)
    eventually { events.statesOf(id).isNotEmpty() }

    assertEquals(ErrorCode.NOT_CONNECTED, write(id, byteArrayOf(2)).await().code)
  }

  @Test
  fun `a zero timeout closes at once`() {
    val (id, socket) = connected()
    socket.blockWrites()
    val stalled = write(id, byteArrayOf(1))

    assertTrue(disconnect(id, timeoutMs = 0).await().resolved)

    assertEquals(ErrorCode.NOT_CONNECTED, stalled.await().code)
    assertTrue(socket.closed)
  }

  @Test
  fun `the peer closing during a disconnect still resolves it`() {
    val (id, socket) = connected()
    socket.blockWrites()
    write(id, byteArrayOf(1))
    val disconnect = disconnect(id)
    eventually { events.statesOf(id).isNotEmpty() }

    socket.peerClose()

    assertTrue(disconnect.await().resolved)
    assertEquals(1, events.terminals(id).size)
  }

  @Test
  fun `closeWithError ends the connection with that code`() {
    val (id, socket) = connected()

    manager.closeWithError(id, ErrorCode.BUFFER_OVERFLOW, "More than 1048576 bytes are buffered")

    val terminal = events.awaitTerminal(id)
    assertEquals(Terminal.ERROR, terminal.reason)
    assertEquals(ErrorCode.BUFFER_OVERFLOW, terminal.code)
    assertEquals("More than 1048576 bytes are buffered", terminal.message)
    assertTrue(socket.closed)
  }

  @Test
  fun `disconnecting an unknown connection resolves`() {
    assertTrue(disconnect("conn-42").await().resolved)
  }
}
