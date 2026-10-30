package kjd.reactnative.bluetooth

import java.io.IOException
import kotlin.random.Random
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
internal class WriteTest : ConnectionTest() {
  @Test
  fun `exactly the given bytes are sent`() {
    val (id, socket) = connected()

    assertTrue(write(id, byteArrayOf(0x1b, 0x40)).await().resolved)

    assertArrayEquals(byteArrayOf(0x1b, 0x40), socket.written())
  }

  @Test
  fun `a 64 KiB payload resolves only after every byte was accepted, in chunks`() {
    val (id, socket) = connected()
    val payload = Random(3).nextBytes(64 * 1024)
    socket.blockWrites()

    val promise = write(id, payload)
    never { promise.isSettled }
    socket.unblockWrites()

    assertTrue(promise.await().resolved)
    assertArrayEquals(payload, socket.written())
    assertEquals(payload.size / RfcommConnection.WRITE_CHUNK_BYTES, socket.writeCalls)
  }

  @Test
  fun `unawaited writes are sent in call order without interleaving`() {
    val (id, socket) = connected()
    val a = ByteArray(20_000) { 'a'.code.toByte() }
    val b = ByteArray(20_000) { 'b'.code.toByte() }
    val c = ByteArray(20_000) { 'c'.code.toByte() }

    val promises = listOf(write(id, a), write(id, b), write(id, c))

    promises.forEach { assertTrue(it.await().resolved) }
    assertArrayEquals(a + b + c, socket.written())
  }

  @Test
  fun `an OS write error is WRITE_FAILED and ends the connection with the same code`() {
    val (id, socket) = connected()
    socket.failWrites(IOException("Broken pipe"))

    val promise = write(id, byteArrayOf(1)).await()

    assertEquals(ErrorCode.WRITE_FAILED, promise.code)
    assertEquals("Broken pipe", promise.nativeMessage())
    assertEquals(id, promise.userInfo?.getString("connectionId"))
    val terminal = events.awaitTerminal(id)
    assertEquals(Terminal.ERROR, terminal.reason)
    assertEquals(ErrorCode.WRITE_FAILED, terminal.code)
    socket.awaitClosed()
  }

  @Test
  fun `a write the remote never accepts is WRITE_TIMEOUT, ends the connection, and fails queued writes`() {
    val (id, socket) = connected()
    socket.blockWrites()
    val stalled = write(id, byteArrayOf(1, 2, 3), timeoutMs = 2_000)
    val queued = write(id, byteArrayOf(4))
    eventually { scheduler.pending == 1 }

    scheduler.advance(1_999)
    never { stalled.isSettled }
    scheduler.advance(1)

    assertEquals(ErrorCode.WRITE_TIMEOUT, stalled.await().code)
    val terminal = events.awaitTerminal(id)
    assertEquals(Terminal.ERROR, terminal.reason)
    assertEquals(ErrorCode.WRITE_TIMEOUT, terminal.code)
    assertEquals(ErrorCode.NOT_CONNECTED, queued.await().code)
    socket.awaitClosed()
    assertEquals(1, stalled.settleCount)
  }

  @Test
  fun `a write that completes in time cancels its timeout`() {
    val (id, _) = connected()

    assertTrue(write(id, byteArrayOf(1), timeoutMs = 2_000).await().resolved)

    eventually { scheduler.pending == 0 }
    assertTrue(events.terminals(id).isEmpty())
  }

  @Test
  fun `writing to an unknown or ended connection is NOT_CONNECTED`() {
    assertEquals(ErrorCode.NOT_CONNECTED, write("conn-9", byteArrayOf(1)).await().code)

    val (id, socket) = connected()
    socket.peerClose()
    events.awaitTerminal(id)

    val promise = write(id, byteArrayOf(1)).await()
    assertEquals(ErrorCode.NOT_CONNECTED, promise.code)
    assertEquals(id, promise.userInfo?.getString("connectionId"))
  }

  @Test
  fun `an empty payload resolves without I-O`() {
    val (id, socket) = connected()

    assertTrue(write(id, ByteArray(0)).await().resolved)

    assertEquals(0, socket.writeCalls)
  }

  @Test
  fun `a write in flight when the peer closes is NOT_CONNECTED, not WRITE_FAILED`() {
    val (id, socket) = connected()
    socket.blockWrites()
    val promise = write(id, byteArrayOf(1))

    socket.peerClose()
    events.awaitTerminal(id)

    assertEquals(ErrorCode.NOT_CONNECTED, promise.await().code)
    assertEquals(Terminal.REMOTE, events.terminals(id).single().terminal?.reason)
  }
}
