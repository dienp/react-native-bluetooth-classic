package kjd.reactnative.bluetooth

import java.io.Closeable
import java.io.IOException
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

internal data class ConnectOptions(
  val timeoutMs: Long,
  val secure: Boolean = true,
  val uuid: UUID = RfcommTransport.SPP_UUID,
  val fallbackChannel: Int? = null
)

internal data class AcceptOptions(
  val timeoutMs: Long = 0,
  val secure: Boolean = true,
  val uuid: UUID = RfcommTransport.SPP_UUID,
  val serviceName: String = DEFAULT_SERVICE_NAME
) {
  companion object {
    const val DEFAULT_SERVICE_NAME = "RNBluetoothClassic"
  }
}

/**
 * Owns every connection and every pending connect or accept. Blocking socket
 * calls run on worker threads; a timeout or a cancel closes the socket the
 * worker is blocked on. Each pending operation settles exactly once, and an
 * operation that lost the race closes whatever socket it opened, so a
 * cancelled or timed-out connect never leaves a connection behind.
 */
internal class ConnectionManager(
  private val transport: RfcommTransport,
  private val scheduler: Scheduler,
  private val events: RfcommConnection.Events,
  private val adapterOn: () -> Boolean,
  /** Maps an address to the `androidDevice` of a `NativeConnection`. */
  private val deviceInfo: (String) -> Map<String, Any?>
) {
  private val lock = Any()
  private val nextId = AtomicInteger(1)
  private val connections = ConcurrentHashMap<String, RfcommConnection>()
  /** Guarded by [lock], like [connecting] and [accepting]. */
  private val byAddress = HashMap<String, RfcommConnection>()
  private val connecting = HashMap<String, Operation>()
  private var accepting: Operation? = null
  private val operations = ConcurrentHashMap<String, Operation>()
  private val workers: ExecutorService = Executors.newCachedThreadPool(daemonThreads("RNBluetoothClassic-io"))
  @Volatile private var shutDown = false

  private inner class Operation(
    val id: String,
    val promise: SafePromise,
    val cancelCode: String,
    val address: String?
  ) {
    private var settled = false
    private var resource: Closeable? = null
    @Volatile var timer: Cancellable? = null

    val isSettled: Boolean
      get() = synchronized(this) { settled }

    /** Tracks the socket the worker is about to block on; closes it at once if the operation already settled. */
    fun attach(closeable: Closeable): Boolean {
      synchronized(this) {
        if (!settled) {
          resource = closeable
          return true
        }
      }
      closeQuietly(closeable)
      return false
    }

    /** Wins the race to settle. The winner settles the promise; everyone else backs off. */
    fun settle(): Boolean {
      synchronized(this) {
        if (settled) return false
        settled = true
      }
      timer?.cancel()
      operations.remove(id, this)
      synchronized(lock) {
        if (address != null) connecting.remove(address, this)
        if (accepting === this) accepting = null
      }
      return true
    }

    /** Settles with [error] and closes the socket, for timeouts, cancels and adapter shutdown. */
    fun abort(error: Throwable) {
      if (!settle()) return
      closeQuietly(synchronized(this) { resource })
      promise.reject(error)
    }

    fun abandon() {
      if (!settle()) return
      closeQuietly(synchronized(this) { resource })
      promise.abandon()
    }

    fun closeResource() = closeQuietly(synchronized(this) { resource })
  }

  private class Aborted : Exception()

  // ---- Connect ----

  /**
   * Starts connecting to [address]. Throws `ALREADY_CONNECTED` or
   * `ALREADY_CONNECTING` before anything happens; otherwise runs
   * [beforeAttempt] (which stops discovery) and opens the socket on a worker
   * thread.
   */
  fun connect(
    operationId: String,
    address: String,
    options: ConnectOptions,
    promise: SafePromise,
    beforeAttempt: () -> Unit = {}
  ) {
    val operation = Operation(operationId, promise, ErrorCode.CONNECT_CANCELLED, address)
    synchronized(lock) {
      checkOpen()
      // An ended connection may still be indexed for a moment after its terminal event.
      byAddress[address]?.takeIf { it.isOpen }?.let {
        throw BluetoothClassicException(
          ErrorCode.ALREADY_CONNECTED,
          "Already connected to this device",
          deviceId = address,
          connectionId = it.id
        )
      }
      if (address in connecting) {
        throw BluetoothClassicException(
          ErrorCode.ALREADY_CONNECTING,
          "A connection to this device is already being opened",
          deviceId = address
        )
      }
      connecting[address] = operation
      operations[operationId] = operation
    }
    try {
      beforeAttempt()
    } catch (t: Throwable) {
      Logger.warn("Could not prepare the connection attempt", t)
    }
    if (options.timeoutMs > 0) {
      operation.timer =
        scheduler.schedule(options.timeoutMs) {
          operation.abort(
            BluetoothClassicException(
              ErrorCode.CONNECT_TIMEOUT,
              "The connection was not established within ${options.timeoutMs} ms",
              deviceId = address
            )
          )
        }
    }
    workers.execute { runConnect(operation, address, options) }
  }

  private fun runConnect(operation: Operation, address: String, options: ConnectOptions) {
    try {
      val socket =
        try {
          attempt(operation) { transport.clientSocket(address, options.secure, options.uuid) }
        } catch (first: IOException) {
          val channel = options.fallbackChannel ?: throw first
          if (operation.isSettled) throw Aborted()
          operation.closeResource()
          Logger.debug { "UUID connect to ${Logger.redact(address)} failed; trying channel $channel" }
          try {
            attempt(operation) { transport.channelSocket(address, options.secure, channel) }
          } catch (second: IOException) {
            if (operation.isSettled) throw Aborted()
            throw IOException("uuid ${options.uuid}: ${first.message}; channel $channel: ${second.message}", second)
          }
        }
      open(operation, address, socket)
    } catch (e: Aborted) {
      // A timeout, cancel or adapter shutdown settled the operation and closed the socket.
    } catch (e: IOException) {
      fail(operation, BluetoothClassicException(ErrorCode.CONNECT_FAILED, "Could not connect", deviceId = address, cause = e))
    } catch (t: Throwable) {
      fail(operation, t)
    }
  }

  /** Creates a socket, lets cancels close it, and blocks until it connects. */
  private fun attempt(operation: Operation, create: () -> RfcommSocket): RfcommSocket {
    val socket = create()
    if (!operation.attach(socket)) throw Aborted()
    socket.connect()
    return socket
  }

  private fun fail(operation: Operation, error: Throwable) {
    if (!operation.settle()) return
    operation.closeResource()
    operation.promise.reject(error)
  }

  /** Registers a connected socket, unless the operation was settled meanwhile. */
  private fun open(operation: Operation, address: String, socket: RfcommSocket) {
    val connection: RfcommConnection
    synchronized(lock) {
      if (!operation.settle()) {
        closeQuietly(socket)
        return
      }
      byAddress[address]?.takeIf { it.isOpen }?.let {
        // Only an accept can get here: an incoming link from a device that is already connected.
        closeQuietly(socket)
        operation.promise.reject(
          BluetoothClassicException(
            ErrorCode.ALREADY_CONNECTED,
            "Already connected to this device",
            deviceId = address,
            connectionId = it.id
          )
        )
        return
      }
      val device =
        try {
          deviceInfo(address)
        } catch (t: Throwable) {
          Logger.warn("Could not read the connected device", t)
          DeviceMapper.bare(address)
        }
      connection =
        RfcommConnection(
          "conn-${nextId.getAndIncrement()}",
          address,
          device,
          socket,
          scheduler,
          events,
          adapterOn,
          ::removed
        )
      connections[connection.id] = connection
      byAddress[address] = connection
    }
    Logger.debug { "Connection ${connection.id} opened to ${Logger.redact(address)}" }
    connection.start()
    operation.promise.resolve(Writables.map(connection.toMap()))
  }

  private fun removed(connection: RfcommConnection) {
    connections.remove(connection.id, connection)
    // Only this connection's own entry: a newer connection to the same address stays.
    synchronized(lock) { byAddress.remove(connection.address, connection) }
  }

  // ---- Accept ----

  fun accept(operationId: String, options: AcceptOptions, promise: SafePromise) {
    val operation = Operation(operationId, promise, ErrorCode.ACCEPT_CANCELLED, null)
    synchronized(lock) {
      checkOpen()
      if (accepting != null) {
        throw BluetoothClassicException(ErrorCode.ACCEPT_ALREADY_RUNNING, "Another accept() is pending")
      }
      accepting = operation
      operations[operationId] = operation
    }
    if (options.timeoutMs > 0) {
      operation.timer =
        scheduler.schedule(options.timeoutMs) {
          operation.abort(
            BluetoothClassicException(ErrorCode.ACCEPT_TIMEOUT, "No device connected within ${options.timeoutMs} ms")
          )
        }
    }
    workers.execute { runAccept(operation, options) }
  }

  private fun runAccept(operation: Operation, options: AcceptOptions) {
    val server =
      try {
        transport.listen(options.serviceName, options.secure, options.uuid)
      } catch (t: Throwable) {
        fail(operation, acceptFailed(t))
        return
      }
    if (!operation.attach(server)) return
    val socket =
      try {
        server.accept()
      } catch (t: Throwable) {
        fail(operation, acceptFailed(t))
        return
      } finally {
        // The listening socket never outlives the accept() call.
        closeQuietly(server)
      }
    val address =
      try {
        socket.remoteAddress.uppercase(Locale.ROOT)
      } catch (t: Throwable) {
        closeQuietly(socket)
        fail(operation, acceptFailed(t))
        return
      }
    open(operation, address, socket)
  }

  private fun acceptFailed(cause: Throwable) =
    if (cause is SecurityException) cause
    else BluetoothClassicException(ErrorCode.ACCEPT_FAILED, "Could not accept a connection", cause = cause)

  fun cancelAccept() {
    synchronized(lock) { accepting }
      ?.abort(BluetoothClassicException(ErrorCode.ACCEPT_CANCELLED, "The accept was cancelled"))
  }

  /** Cancels a pending connect or accept; an unknown or settled id is ignored. */
  fun cancelOperation(operationId: String) {
    val operation = operations[operationId] ?: return
    operation.abort(BluetoothClassicException(operation.cancelCode, "The operation was cancelled"))
  }

  // ---- Connections ----

  fun list(): List<Map<String, Any?>> = connections.values.filter { it.isOpen }.sortedBy { it.connectedAt }.map { it.toMap() }

  fun write(connectionId: String, data: ByteArray, timeoutMs: Long, promise: SafePromise) {
    val connection =
      connections[connectionId]
        ?: throw BluetoothClassicException(
          ErrorCode.NOT_CONNECTED,
          "Connection $connectionId is not connected",
          connectionId = connectionId
        )
    if (data.isEmpty()) {
      promise.resolve(null)
      return
    }
    connection.write(data, timeoutMs, promise)
  }

  fun disconnect(connectionId: String, timeoutMs: Long, promise: SafePromise) {
    val connection = connections[connectionId]
    if (connection == null) promise.resolve(null) else connection.disconnect(timeoutMs, promise)
  }

  fun closeWithError(connectionId: String, code: String, message: String) {
    connections[connectionId]?.closeWithError(code, message)
  }

  // ---- Global terminations ----

  /** Bluetooth turned off: pending operations reject and every connection ends with `BLUETOOTH_DISABLED`. */
  fun adapterOff() {
    for (operation in operations.values.toList()) {
      operation.abort(BluetoothClassicException(ErrorCode.BLUETOOTH_DISABLED, "Bluetooth was turned off"))
    }
    for (connection in connections.values.toList()) {
      connection.end(Terminal.error(ErrorCode.BLUETOOTH_DISABLED, "Bluetooth was turned off"))
    }
  }

  /** Closes every socket and thread without settling or emitting anything: the JS runtime is going away. */
  fun shutdown() {
    synchronized(lock) { shutDown = true }
    operations.values.toList().forEach(Operation::abandon)
    connections.values.toList().forEach(RfcommConnection::shutdown)
    connections.clear()
    synchronized(lock) { byAddress.clear() }
    workers.shutdownNow()
    scheduler.shutdown()
  }

  private fun checkOpen() {
    if (shutDown) throw BluetoothClassicException(ErrorCode.NOT_CONNECTED, "The module was invalidated")
  }
}
