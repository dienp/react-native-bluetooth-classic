package kjd.reactnative.bluetooth

import com.facebook.react.bridge.ReadableMap
import java.util.concurrent.CopyOnWriteArrayList
import org.junit.After
import org.junit.Before

/** A clock the test advances by hand. Due actions run on the test thread. */
internal class ManualScheduler : Scheduler {
  private class Task(val at: Long, val action: Runnable)

  private val tasks = mutableListOf<Task>()
  private var now = 0L
  @Volatile var shutDown = false
    private set

  @Synchronized
  override fun schedule(delayMs: Long, action: Runnable): Cancellable {
    val task = Task(now + delayMs, action)
    tasks += task
    return Cancellable { synchronized(this) { tasks.remove(task) } }
  }

  /** Runs every action due within [ms], in time order, then sets the clock. */
  fun advance(ms: Long) {
    val target = synchronized(this) { now + ms }
    while (true) {
      val next =
        synchronized(this) {
          tasks.filter { it.at <= target }.minByOrNull { it.at }?.also {
            tasks.remove(it)
            now = it.at
          }
        } ?: break
      next.action.run()
    }
    synchronized(this) { now = target }
  }

  val pending: Int
    @Synchronized get() = tasks.size

  override fun shutdown() {
    shutDown = true
  }
}

/** Records connection events in emission order. */
internal class RecordingEvents : RfcommConnection.Events {
  data class State(val connectionId: String, val state: String, val previousState: String, val terminal: Terminal?)

  class Data(val connectionId: String, val bytes: ByteArray, val seq: Int, val atNanos: Long)

  val states = CopyOnWriteArrayList<State>()
  val data = CopyOnWriteArrayList<Data>()
  /** `state:<previous>-><state>` and `data:<size>` entries, per connection, in order. */
  val log = CopyOnWriteArrayList<String>()

  /** Runs inside the terminal emit, before the manager has dropped the connection. */
  @Volatile var onTerminal: ((String) -> Unit)? = null

  override fun onStateChange(connectionId: String, state: String, previousState: String, terminal: Terminal?) {
    states += State(connectionId, state, previousState, terminal)
    log += "$connectionId state:$previousState->$state"
    if (terminal != null) onTerminal?.invoke(connectionId)
  }

  override fun onData(connectionId: String, data: ByteArray, seq: Int) {
    this.data += Data(connectionId, data, seq, System.nanoTime())
    log += "$connectionId data:${data.size}"
  }

  fun statesOf(connectionId: String) = states.filter { it.connectionId == connectionId }

  fun terminals(connectionId: String) = statesOf(connectionId).filter { it.state == "disconnected" }

  fun awaitTerminal(connectionId: String, timeoutMs: Long = 5_000): Terminal {
    eventually(timeoutMs) { terminals(connectionId).isNotEmpty() }
    return terminals(connectionId).single().terminal!!
  }

  fun received(connectionId: String): ByteArray =
    data.filter { it.connectionId == connectionId }.fold(ByteArray(0)) { all, chunk -> all + chunk.bytes }

  fun awaitReceived(connectionId: String, count: Int, timeoutMs: Long = 5_000): ByteArray {
    eventually(timeoutMs) { received(connectionId).size >= count }
    return received(connectionId)
  }

  fun logOf(connectionId: String) = log.filter { it.startsWith("$connectionId ") }.map { it.substringAfter(' ') }
}

/** Drives a [ConnectionManager] over the fake transport, with a manual clock. */
internal abstract class ConnectionTest {
  protected val address = "00:11:22:AA:BB:CC"
  protected val transport = FakeRfcommTransport()
  protected val scheduler = ManualScheduler()
  protected val events = RecordingEvents()
  @Volatile protected var adapterOn = true
  protected lateinit var manager: ConnectionManager
  private var nextOperation = 1

  @Before
  fun setUpManager() {
    useJavaOnlyWritables()
    manager = newManager(scheduler)
  }

  @After
  fun tearDownManager() {
    manager.shutdown()
  }

  protected fun newManager(scheduler: Scheduler) =
    ConnectionManager(transport, scheduler, events, { adapterOn }, { DeviceMapper.bare(it) })

  /** Starts a connect and returns its promise without waiting. */
  protected fun connect(
    target: String = address,
    options: ConnectOptions = ConnectOptions(timeoutMs = 15_000),
    operationId: String = "op-${nextOperation++}",
    beforeAttempt: () -> Unit = {}
  ): RecordingPromise {
    val promise = RecordingPromise()
    val safe = SafePromise(promise, "connect")
    guarded(safe) { manager.connect(operationId, target, options, safe, beforeAttempt) }
    return promise
  }

  protected fun accept(
    options: AcceptOptions = AcceptOptions(),
    operationId: String = "op-${nextOperation++}"
  ): RecordingPromise {
    val promise = RecordingPromise()
    val safe = SafePromise(promise, "accept")
    guarded(safe) { manager.accept(operationId, options, safe) }
    return promise
  }

  /** Connects to [target] and returns the connection id and the fake socket. */
  protected fun connected(target: String = address): Pair<String, FakeSocket> {
    val promise = connect(target).await()
    check(promise.resolved) { "connect rejected with ${promise.code}: ${promise.message}" }
    val id = promise.map().getString("id")!!
    return id to transport.sockets.last { it.remoteAddress == target && it.connected }
  }

  protected fun write(connectionId: String, bytes: ByteArray, timeoutMs: Long = 0): RecordingPromise {
    val promise = RecordingPromise()
    val safe = SafePromise(promise, "write")
    guarded(safe) { manager.write(connectionId, bytes, timeoutMs, safe) }
    return promise
  }

  protected fun disconnect(connectionId: String, timeoutMs: Long = 5_000): RecordingPromise {
    val promise = RecordingPromise()
    val safe = SafePromise(promise, "disconnect")
    guarded(safe) { manager.disconnect(connectionId, timeoutMs, safe) }
    return promise
  }

  protected fun openIds(): List<String> = manager.list().map { it["id"] as String }

  protected fun ReadableMap.device(): ReadableMap = getMap("androidDevice")!!
}
