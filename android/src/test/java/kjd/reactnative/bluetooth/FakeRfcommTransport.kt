package kjd.reactnative.bluetooth

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** How a fake socket's `connect()` behaves. */
internal sealed interface ConnectResult {
  object Succeed : ConnectResult

  data class Fail(val message: String) : ConnectResult

  /** Blocks until the socket is closed, like an unreachable device. */
  object Hang : ConnectResult

  /** Blocks until [gate] opens, then succeeds even if the socket was closed meanwhile: a late OS result. */
  class Late(val gate: CountDownLatch) : ConnectResult
}

/**
 * A scripted RFCOMM stack. Each socket is one end of an in-memory link; the
 * test plays the remote device through the socket's peer methods. Closing a
 * socket unblocks every pending call on it with an IOException, as the OS does.
 */
internal class FakeRfcommTransport : RfcommTransport {
  /** Decides how each socket connects; called on the connecting thread. */
  @Volatile var onConnect: (FakeSocket) -> ConnectResult = { ConnectResult.Succeed }
  /** Thrown by [clientSocket] and [channelSocket], as when the OS cannot create a socket. */
  @Volatile var createFailure: IOException? = null
  @Volatile var listenFailure: Throwable? = null

  val sockets = CopyOnWriteArrayList<FakeSocket>()
  val servers = CopyOnWriteArrayList<FakeServerSocket>()

  override fun clientSocket(address: String, secure: Boolean, uuid: UUID): RfcommSocket =
    create(FakeSocket(address, "uuid $uuid", secure) { onConnect(it) })

  override fun channelSocket(address: String, secure: Boolean, channel: Int): RfcommSocket =
    create(FakeSocket(address, "channel $channel", secure) { onConnect(it) })

  private fun create(socket: FakeSocket): FakeSocket {
    createFailure?.let { throw it }
    sockets += socket
    return socket
  }

  override fun listen(serviceName: String, secure: Boolean, uuid: UUID): RfcommServerSocket {
    listenFailure?.let { throw it }
    return FakeServerSocket(serviceName, secure, uuid).also { servers += it }
  }

  fun awaitSocket(index: Int = 0): FakeSocket {
    eventually { sockets.size > index }
    return sockets[index]
  }

  fun awaitServer(index: Int = 0): FakeServerSocket {
    eventually { servers.size > index }
    return servers[index]
  }
}

internal class FakeSocket(
  override val remoteAddress: String,
  /** `uuid <uuid>`, `channel <n>` or `incoming`. */
  val target: String,
  val secure: Boolean,
  private val connectResult: (FakeSocket) -> ConnectResult = { ConnectResult.Succeed }
) : RfcommSocket {
  private val lock = ReentrantLock()
  private val changed = lock.newCondition()
  private val inbound = ArrayDeque<Byte>()
  private val written = ByteArrayOutputStream()
  private var peerClosed = false
  private var readFailure: IOException? = null
  private var readCrash: RuntimeException? = null
  private var writeFailure: IOException? = null
  private var writesBlocked = false

  @Volatile var closed = false
    private set
  @Volatile var connected = false
    private set
  /** How many `write` calls reached the stream. */
  @Volatile var writeCalls = 0
    private set

  override fun connect() {
    when (val result = connectResult(this)) {
      ConnectResult.Succeed -> lock.withLock {
        if (closed) throw IOException("socket closed")
        connected = true
      }
      is ConnectResult.Fail -> throw IOException(result.message)
      ConnectResult.Hang -> lock.withLock {
        while (!closed) changed.await()
        throw IOException("socket closed")
      }
      is ConnectResult.Late -> {
        result.gate.await()
        connected = true
      }
    }
  }

  internal fun markConnected() {
    connected = true
  }

  override val input: InputStream =
    object : InputStream() {
      override fun read(): Int {
        val one = ByteArray(1)
        return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xFF
      }

      override fun read(b: ByteArray, off: Int, len: Int): Int =
        lock.withLock {
          while (!closed && readFailure == null && readCrash == null && inbound.isEmpty() && !peerClosed) {
            changed.await()
          }
          if (closed) throw IOException("socket closed")
          readFailure?.let { throw it }
          readCrash?.let { throw it }
          if (inbound.isEmpty()) return -1
          var count = 0
          while (count < len && inbound.isNotEmpty()) b[off + count++] = inbound.removeFirst()
          count
        }
    }

  override val output: OutputStream =
    object : OutputStream() {
      override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)

      override fun write(b: ByteArray, off: Int, len: Int) =
        lock.withLock {
          while (writesBlocked && !closed && writeFailure == null) changed.await()
          if (closed) throw IOException("socket closed")
          writeFailure?.let { throw it }
          written.write(b, off, len)
          writeCalls++
          changed.signalAll()
        }
    }

  override fun close() =
    lock.withLock {
      closed = true
      changed.signalAll()
    }

  // ---- The remote device ----

  fun send(bytes: ByteArray) =
    lock.withLock {
      bytes.forEach(inbound::addLast)
      changed.signalAll()
    }

  fun send(text: String) = send(text.toByteArray())

  /** The peer closes the link: reads report end-of-stream, as on API 37. */
  fun peerClose() =
    lock.withLock {
      peerClosed = true
      changed.signalAll()
    }

  /** The link drops: reads fail, as on API 24 to 36. */
  fun failReads(error: IOException = IOException("bt socket closed, read return: -1")) =
    lock.withLock {
      readFailure = error
      changed.signalAll()
    }

  /** Reads throw something that is not an I/O error, like a bug below the library. */
  fun crashReads(error: RuntimeException) =
    lock.withLock {
      readCrash = error
      changed.signalAll()
    }

  fun failWrites(error: IOException = IOException("Broken pipe")) =
    lock.withLock {
      writeFailure = error
      changed.signalAll()
    }

  /** The remote stops reading: writes block until [unblockWrites] or close. */
  fun blockWrites() = lock.withLock { writesBlocked = true }

  fun unblockWrites() =
    lock.withLock {
      writesBlocked = false
      changed.signalAll()
    }

  fun written(): ByteArray = lock.withLock { written.toByteArray() }

  /** Bytes the peer sent that the library has not read yet. */
  val unread: Int
    get() = lock.withLock { inbound.size }

  fun awaitWritten(count: Int, timeoutMs: Long = 5_000): ByteArray {
    eventually(timeoutMs) { written().size >= count }
    return written()
  }

  fun awaitClosed(timeoutMs: Long = 5_000) = eventually(timeoutMs) { closed }
}

internal class FakeServerSocket(val serviceName: String, val secure: Boolean, val uuid: UUID) : RfcommServerSocket {
  private val lock = ReentrantLock()
  private val changed = lock.newCondition()
  private val incoming = ArrayDeque<FakeSocket>()
  private var failure: IOException? = null

  @Volatile var closed = false
    private set

  override fun accept(): RfcommSocket =
    lock.withLock {
      while (!closed && failure == null && incoming.isEmpty()) changed.await()
      if (closed) throw IOException("server socket closed")
      failure?.let { throw it }
      incoming.removeFirst().also { it.markConnected() }
    }

  override fun close() =
    lock.withLock {
      closed = true
      changed.signalAll()
    }

  /** A remote device connects to the advertised service. */
  fun connectFrom(address: String): FakeSocket {
    val socket = FakeSocket(address, "incoming", secure)
    lock.withLock {
      incoming.addLast(socket)
      changed.signalAll()
    }
    return socket
  }

  fun fail(error: IOException) =
    lock.withLock {
      failure = error
      changed.signalAll()
    }

  fun awaitClosed(timeoutMs: Long = 5_000) = eventually(timeoutMs) { closed }
}

/** Polls [condition] until it holds, or fails the test after [timeoutMs]. */
fun eventually(timeoutMs: Long = 5_000, condition: () -> Boolean) {
  val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
  while (!condition()) {
    if (System.nanoTime() > deadline) throw AssertionError("Condition not met within $timeoutMs ms")
    Thread.sleep(2)
  }
}

/** Asserts that [condition] stays false for [ms], for things that must not happen. */
fun never(ms: Long = 100, condition: () -> Boolean) {
  val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(ms)
  while (System.nanoTime() < deadline) {
    if (condition()) throw AssertionError("Condition became true")
    Thread.sleep(2)
  }
}
