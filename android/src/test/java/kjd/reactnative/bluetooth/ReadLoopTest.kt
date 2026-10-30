package kjd.reactnative.bluetooth

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.random.Random
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
internal class ReadLoopTest : ConnectionTest() {
  @Test
  fun `end of stream (API 37) ends the connection as remote exactly once and stops reading`() {
    val (id, socket) = connected()

    socket.peerClose()

    val terminal = events.awaitTerminal(id)
    assertEquals(Terminal.REMOTE, terminal.reason)
    assertNull(terminal.code)
    socket.awaitClosed()
    socket.send("late")
    never { events.data.isNotEmpty() }
    assertEquals(listOf("state:connected->disconnected"), events.logOf(id))
    assertTrue(openIds().isEmpty())
  }

  @Test
  fun `a read error (API 24-36) while Bluetooth is on ends the connection as remote`() {
    val (id, socket) = connected()

    socket.failReads(IOException("bt socket closed, read return: -1"))

    val terminal = events.awaitTerminal(id)
    assertEquals(Terminal.REMOTE, terminal.reason)
    assertNull(terminal.code)
    never { events.terminals(id).size > 1 }
    // A lost link skips disconnecting.
    assertEquals(listOf("state:connected->disconnected"), events.logOf(id))
  }

  @Test
  fun `an unexpected failure in the read loop ends the connection with CONNECTION_LOST`() {
    val (id, socket) = connected()

    socket.crashReads(IllegalStateException("parcel corrupted"))

    val terminal = events.awaitTerminal(id)
    assertEquals(Terminal.ERROR, terminal.reason)
    assertEquals(ErrorCode.CONNECTION_LOST, terminal.code)
    assertTrue(terminal.cause is IllegalStateException)
    socket.awaitClosed()
  }

  @Test
  fun `a read error while Bluetooth is off ends the connection with BLUETOOTH_DISABLED`() {
    val (id, socket) = connected()
    adapterOn = false

    socket.failReads()

    val terminal = events.awaitTerminal(id)
    assertEquals(Terminal.ERROR, terminal.reason)
    assertEquals(ErrorCode.BLUETOOTH_DISABLED, terminal.code)
    assertTrue(terminal.cause is IOException)
  }

  @Test
  fun `small reads are batched for 16 ms and carry seq numbers from 0`() {
    val (id, socket) = connected()

    socket.send("OK\r\n")
    eventually { scheduler.pending == 1 }
    socket.send("READY\r\n")
    eventually { socket.unread == 0 }
    never(50) { events.data.isNotEmpty() }

    scheduler.advance(RfcommConnection.BATCH_DELAY_MS)
    assertEquals("OK\r\nREADY\r\n", String(events.awaitReceived(id, 11)))

    socket.send("again")
    eventually { scheduler.pending == 1 }
    scheduler.advance(RfcommConnection.BATCH_DELAY_MS)
    events.awaitReceived(id, 16)
    assertEquals(listOf(0, 1), events.data.map { it.seq })
  }

  @Test
  fun `a batch is emitted at once when it reaches 16 KiB`() {
    val (id, socket) = connected()
    val payload = Random(1).nextBytes(RfcommConnection.BATCH_BYTES)

    socket.send(payload)

    // No clock advance: the size limit alone flushes.
    assertArrayEquals(payload, events.awaitReceived(id, payload.size))
    assertTrue(events.data.first().bytes.size >= RfcommConnection.BATCH_BYTES)
  }

  @Test
  fun `bytes read before the peer closed are emitted before the terminal event`() {
    val (id, socket) = connected()

    socket.send("bye")
    socket.peerClose()

    events.awaitTerminal(id)
    assertEquals(listOf("data:3", "state:connected->disconnected"), events.logOf(id))
  }

  @Test
  fun `bursts arrive complete, in order, with contiguous seq numbers`() {
    val (id, socket) = connected()
    val payload = Random(2).nextBytes(10_000)

    payload.toList().chunked(997).forEach { burst ->
      socket.send(burst.toByteArray())
      scheduler.advance(RfcommConnection.BATCH_DELAY_MS)
    }
    eventually {
      scheduler.advance(RfcommConnection.BATCH_DELAY_MS)
      events.received(id).size >= payload.size
    }

    assertArrayEquals(payload, events.received(id))
    assertEquals(events.data.indices.toList(), events.data.map { it.seq })
  }

  @Test
  fun `a small reply reaches the listener within 50 ms`() {
    val realTime = ExecutorScheduler("latency-test")
    val manager = newManager(realTime)
    try {
      val promise = RecordingPromise()
      manager.connect("op-latency", address, ConnectOptions(timeoutMs = 0), SafePromise(promise, "connect"))
      val id = promise.await().map().getString("id")!!
      val socket = transport.sockets.single()

      val sent = System.nanoTime()
      socket.send(ByteArray(12) { it.toByte() })

      events.awaitReceived(id, 12)
      val latencyMs = TimeUnit.NANOSECONDS.toMillis(events.data.single().atNanos - sent)
      assertTrue("latency $latencyMs ms", latencyMs <= 50)
    } finally {
      manager.shutdown()
    }
  }
}
