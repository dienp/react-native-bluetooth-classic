package kjd.reactnative.bluetooth

import java.io.IOException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** The fake must behave like an OS socket, or the connection tests prove nothing. */
class FakeTransportTest {
  private val socket = FakeSocket("00:11:22:AA:BB:CC", "uuid", secure = true)

  private fun <T> async(block: () -> T): CompletableFuture<T> = CompletableFuture.supplyAsync(block)

  @Test
  fun `a read blocks until the peer sends, then returns what was sent`() {
    val buffer = ByteArray(16)
    val read = async { socket.input.read(buffer) }
    never { read.isDone }

    socket.send(byteArrayOf(1, 2, 3))

    assertEquals(3, read.get(1, TimeUnit.SECONDS))
    assertArrayEquals(byteArrayOf(1, 2, 3), buffer.copyOf(3))
  }

  @Test
  fun `a peer close makes reads return -1 after the remaining bytes`() {
    socket.send(byteArrayOf(7))
    socket.peerClose()
    val buffer = ByteArray(4)

    assertEquals(1, socket.input.read(buffer))
    assertEquals(-1, socket.input.read(buffer))
    assertEquals(-1, socket.input.read(buffer))
  }

  @Test
  fun `a read error is thrown to the reader`() {
    val read = async { socket.input.read(ByteArray(4)) }
    socket.failReads(IOException("bt socket closed, read return: -1"))

    val error = runCatching { read.get(1, TimeUnit.SECONDS) }.exceptionOrNull()?.cause
    assertTrue(error is IOException)
    assertEquals("bt socket closed, read return: -1", error!!.message)
  }

  @Test
  fun `closing unblocks a pending read with an IOException`() {
    val read = async { socket.input.read(ByteArray(4)) }
    never { read.isDone }

    socket.close()

    assertTrue(runCatching { read.get(1, TimeUnit.SECONDS) }.exceptionOrNull()?.cause is IOException)
  }

  @Test
  fun `a slow peer blocks writes until it reads again, and close unblocks them`() {
    socket.blockWrites()
    val first = async { socket.output.write(byteArrayOf(1, 2)) }
    never { first.isDone }

    socket.unblockWrites()
    first.get(1, TimeUnit.SECONDS)
    assertArrayEquals(byteArrayOf(1, 2), socket.written())

    socket.blockWrites()
    val second = async { socket.output.write(byteArrayOf(3)) }
    never { second.isDone }
    socket.close()
    assertTrue(runCatching { second.get(1, TimeUnit.SECONDS) }.exceptionOrNull()?.cause is IOException)
    assertArrayEquals(byteArrayOf(1, 2), socket.written())
  }

  @Test
  fun `a write error is thrown and nothing is recorded`() {
    socket.failWrites(IOException("Broken pipe"))

    val error = assertThrows(IOException::class.java) { socket.output.write(byteArrayOf(1)) }
    assertEquals("Broken pipe", error.message)
    assertEquals(0, socket.written().size)
  }

  @Test
  fun `connect follows its script, and a hanging connect fails once closed`() {
    FakeSocket("A", "uuid", true) { ConnectResult.Succeed }.also {
      it.connect()
      assertTrue(it.connected)
    }
    val refused = FakeSocket("A", "uuid", true) { ConnectResult.Fail("read failed, socket might closed or timeout") }
    assertEquals(
      "read failed, socket might closed or timeout",
      assertThrows(IOException::class.java) { refused.connect() }.message
    )

    val hanging = FakeSocket("A", "uuid", true) { ConnectResult.Hang }
    val connect = async { hanging.connect() }
    never { connect.isDone }
    hanging.close()
    assertTrue(runCatching { connect.get(1, TimeUnit.SECONDS) }.exceptionOrNull()?.cause is IOException)
    assertFalse(hanging.connected)
  }

  @Test
  fun `a server socket hands out incoming links and fails once closed`() {
    val server = FakeServerSocket("svc", true, RfcommTransport.SPP_UUID)
    val accepted = async { server.accept() }
    never { accepted.isDone }

    val remote = server.connectFrom("00:11:22:AA:BB:CC")
    assertEquals(remote, accepted.get(1, TimeUnit.SECONDS))

    val next = async { server.accept() }
    server.close()
    assertTrue(runCatching { next.get(1, TimeUnit.SECONDS) }.exceptionOrNull()?.cause is IOException)
  }
}
