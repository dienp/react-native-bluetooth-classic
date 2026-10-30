package kjd.reactnative.bluetooth

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean

/** Why a connection ended, as its terminal state event reports it. Only [ERROR] carries a code. */
internal data class Terminal(
  val reason: String,
  val code: String? = null,
  val message: String? = null,
  val cause: Throwable? = null
) {
  companion object {
    const val LOCAL = "local"
    const val REMOTE = "remote"
    const val ERROR = "error"

    fun local() = Terminal(LOCAL)

    fun remote() = Terminal(REMOTE)

    fun error(code: String, message: String, cause: Throwable? = null) = Terminal(ERROR, code, message, cause)
  }
}

/**
 * One open RFCOMM link. A daemon thread reads the socket and batches what it
 * reads; a single write thread sends writes in call order. The state only
 * moves forward (`connected`, `disconnecting`, `disconnected`), and every
 * transition and data event is emitted under one lock, so JS sees them in
 * order and the terminal event exactly once, after the last data.
 */
internal class RfcommConnection(
  val id: String,
  val address: String,
  val device: Map<String, Any?>,
  private val socket: RfcommSocket,
  private val scheduler: Scheduler,
  private val events: Events,
  private val adapterOn: () -> Boolean,
  private val onEnded: (RfcommConnection) -> Unit,
  val connectedAt: Long = System.currentTimeMillis()
) {
  interface Events {
    /** [terminal] is set only for the transition to `disconnected`. */
    fun onStateChange(connectionId: String, state: String, previousState: String, terminal: Terminal?)

    fun onData(connectionId: String, data: ByteArray, seq: Int)
  }

  private enum class State(val jsName: String) {
    CONNECTED("connected"),
    DISCONNECTING("disconnecting"),
    DISCONNECTED("disconnected")
  }

  private class Write(val data: ByteArray, val timeoutMs: Long, val promise: SafePromise) {
    /** Set by whichever of completion, failure or timeout settles the write first. */
    val done = AtomicBoolean(false)
  }

  /** Guards every field below and every emitted event. */
  private val lock = Any()
  @Volatile private var state = State.CONNECTED
  private val pending = ByteArrayOutputStream()
  private var flushTimer: Cancellable? = null
  private var seq = 0
  private val disconnectWaiters = mutableListOf<SafePromise>()
  /** Writes handed to [writer] that have not started yet, and the one being sent. */
  private val queuedWrites = LinkedHashSet<Write>()
  private var inFlight: Write? = null
  private val writer = Executors.newSingleThreadExecutor(daemonThreads("RNBluetoothClassic-write-$id"))

  val isOpen: Boolean
    get() = state != State.DISCONNECTED

  fun start() {
    Thread(::readLoop, "RNBluetoothClassic-read-$id").apply { isDaemon = true }.start()
  }

  fun toMap(): Map<String, Any?> =
    mapOf("id" to id, "state" to state.jsName, "connectedAt" to connectedAt.toDouble(), "androidDevice" to device)

  // ---- Reading ----

  private fun readLoop() {
    val buffer = ByteArray(READ_BUFFER_BYTES)
    try {
      val input = socket.input
      while (true) {
        val count = input.read(buffer)
        if (count < 0) {
          // Targeting API 37 on API 37+, a peer close is end-of-stream rather than an error.
          Logger.debug { "Connection $id reached end of stream" }
          end(Terminal.remote())
          return
        }
        if (count > 0) received(buffer, count)
      }
    } catch (e: IOException) {
      if (state == State.DISCONNECTED) return
      if (adapterOn()) {
        Logger.debug { "Connection $id lost: ${e.message}" }
        end(Terminal.remote())
      } else {
        end(Terminal.error(ErrorCode.BLUETOOTH_DISABLED, "Bluetooth was turned off", e))
      }
    } catch (t: Throwable) {
      Logger.error("The read loop of connection $id failed", t)
      end(Terminal.error(ErrorCode.CONNECTION_LOST, "The connection failed unexpectedly", t))
    }
  }

  private fun received(buffer: ByteArray, count: Int) {
    synchronized(lock) {
      if (state == State.DISCONNECTED) return
      pending.write(buffer, 0, count)
      if (pending.size() >= BATCH_BYTES) {
        flushLocked()
      } else if (flushTimer == null) {
        flushTimer = scheduler.schedule(BATCH_DELAY_MS) { synchronized(lock) { flushLocked() } }
      }
    }
  }

  private fun flushLocked() {
    flushTimer?.cancel()
    flushTimer = null
    if (pending.size() == 0) return
    val data = pending.toByteArray()
    pending.reset()
    try {
      events.onData(id, data, seq++)
    } catch (t: Throwable) {
      Logger.error("Could not emit data for connection $id", t)
    }
  }

  // ---- Writing ----

  /** Queues [data] behind earlier writes; [timeoutMs] 0 means no timeout. */
  fun write(data: ByteArray, timeoutMs: Long, promise: SafePromise) {
    val write = Write(data, timeoutMs, promise)
    synchronized(lock) {
      if (state != State.CONNECTED) throw notConnected()
      queuedWrites += write
    }
    try {
      writer.execute { perform(write) }
    } catch (e: RejectedExecutionException) {
      // The connection ended in between, and end() already failed the write.
      Logger.debug { "Write on connection $id rejected: ${e.message}" }
    }
  }

  private fun perform(write: Write) {
    synchronized(lock) {
      if (!queuedWrites.remove(write)) return
      inFlight = write
    }
    val timer = if (write.timeoutMs > 0) scheduler.schedule(write.timeoutMs) { timedOut(write) } else null
    try {
      val output = socket.output
      var offset = 0
      while (offset < write.data.size) {
        val count = minOf(WRITE_CHUNK_BYTES, write.data.size - offset)
        output.write(write.data, offset, count)
        offset += count
      }
      output.flush()
      timer?.cancel()
      if (write.done.compareAndSet(false, true)) write.promise.resolve(null)
    } catch (t: Throwable) {
      timer?.cancel()
      if (!write.done.compareAndSet(false, true)) return
      // A write that fails because the connection already ended reports that instead.
      if (end(Terminal.error(ErrorCode.WRITE_FAILED, "A write failed", t))) {
        write.promise.reject(
          BluetoothClassicException(ErrorCode.WRITE_FAILED, "The write failed", connectionId = id, cause = t)
        )
      } else {
        write.promise.reject(notConnected())
      }
    } finally {
      synchronized(lock) { inFlight = null }
    }
  }

  /** The stream position is unknown after a timeout, so the connection ends. */
  private fun timedOut(write: Write) {
    if (!write.done.compareAndSet(false, true)) return
    write.promise.reject(
      BluetoothClassicException(
        ErrorCode.WRITE_TIMEOUT,
        "The write did not complete within ${write.timeoutMs} ms",
        connectionId = id
      )
    )
    end(Terminal.error(ErrorCode.WRITE_TIMEOUT, "A write did not complete in time"))
  }

  // ---- Ending ----

  /**
   * Lets writes queued before this call finish, for up to [timeoutMs], then
   * closes the link. Concurrent calls share the result; once disconnected it
   * resolves at once.
   */
  fun disconnect(timeoutMs: Long, promise: SafePromise) {
    val alreadyEnded =
      synchronized(lock) {
        when (state) {
          State.DISCONNECTED -> true
          State.DISCONNECTING -> {
            disconnectWaiters += promise
            return
          }
          State.CONNECTED -> {
            disconnectWaiters += promise
            transitionLocked(State.DISCONNECTING, null)
            false
          }
        }
      }
    if (alreadyEnded) {
      promise.resolve(null)
      return
    }
    val finished = AtomicBoolean(false)
    val finish = { if (finished.compareAndSet(false, true)) end(Terminal.local()) }
    if (timeoutMs <= 0) {
      finish()
      return
    }
    val timer = scheduler.schedule(timeoutMs) { finish() }
    try {
      // The write thread runs this after every write queued before it.
      writer.execute {
        timer.cancel()
        finish()
      }
    } catch (e: RejectedExecutionException) {
      timer.cancel()
      finish()
    }
  }

  /** Ends the connection with `'error'` and [code], as JS asks after a buffer overflow. */
  fun closeWithError(code: String, message: String) {
    end(Terminal.error(code, message))
  }

  /** Ends the connection with [terminal] unless it already ended; returns whether this call ended it. */
  fun end(terminal: Terminal): Boolean {
    val waiters: List<SafePromise>
    val writes: List<Write>
    synchronized(lock) {
      if (state == State.DISCONNECTED) return false
      flushLocked()
      transitionLocked(State.DISCONNECTED, terminal)
      waiters = disconnectWaiters.toList()
      disconnectWaiters.clear()
      writes = queuedWrites.toList()
      queuedWrites.clear()
    }
    Logger.debug { "Connection $id ended: ${terminal.reason} ${terminal.code.orEmpty()}" }
    closeQuietly(socket)
    writer.shutdown()
    for (write in writes) {
      if (write.done.compareAndSet(false, true)) write.promise.reject(notConnected())
    }
    try {
      onEnded(this)
    } catch (t: Throwable) {
      Logger.error("Could not remove connection $id", t)
    }
    waiters.forEach { it.resolve(null) }
    return true
  }

  /** Closes everything without emitting or settling anything: the JS runtime is going away. */
  fun shutdown() {
    val waiters: List<SafePromise>
    val writes: List<Write>
    synchronized(lock) {
      if (state == State.DISCONNECTED) return
      state = State.DISCONNECTED
      flushTimer?.cancel()
      flushTimer = null
      pending.reset()
      waiters = disconnectWaiters.toList()
      disconnectWaiters.clear()
      writes = queuedWrites.toList() + listOfNotNull(inFlight)
      queuedWrites.clear()
    }
    waiters.forEach(SafePromise::abandon)
    writes.forEach { it.promise.abandon() }
    closeQuietly(socket)
    writer.shutdownNow()
  }

  private fun transitionLocked(next: State, terminal: Terminal?) {
    val previous = state
    state = next
    try {
      events.onStateChange(id, next.jsName, previous.jsName, terminal)
    } catch (t: Throwable) {
      Logger.error("Could not emit a state change for connection $id", t)
    }
  }

  private fun notConnected() =
    BluetoothClassicException(ErrorCode.NOT_CONNECTED, "Connection $id is not connected", connectionId = id)

  companion object {
    /** A batch is emitted once it holds this many bytes... */
    const val BATCH_BYTES = 16 * 1024
    /** ...or this long after its first byte arrived. */
    const val BATCH_DELAY_MS = 16L
    const val READ_BUFFER_BYTES = 8 * 1024
    const val WRITE_CHUNK_BYTES = 8 * 1024
  }
}
