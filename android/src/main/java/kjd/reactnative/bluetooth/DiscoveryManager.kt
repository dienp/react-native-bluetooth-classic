package kjd.reactnative.bluetooth

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Runs one discovery session at a time. The session's receiver lives on the
 * application context, so pausing or backgrounding the app doesn't stop it.
 * All state is confined to the main thread.
 */
internal class DiscoveryManager(
  private val context: Context,
  private val preconditions: Preconditions,
  private val permissions: PermissionGate,
  private val main: Handler
) : AdapterMonitor.Listener {
  fun interface Listener {
    fun onDeviceFound(device: Map<String, Any?>)
  }

  private val listeners = CopyOnWriteArrayList<Listener>()
  private class Session(val adapter: BluetoothAdapter, val promise: SafePromise) {
    /** Latest report per address, in discovery order. */
    val found = LinkedHashMap<String, Map<String, Any?>>()
    var started = false
    var receiver: BroadcastReceiver? = null
    val timers = mutableListOf<Runnable>()
  }

  private var session: Session? = null

  fun addListener(listener: Listener) {
    listeners += listener
  }

  /** Test seam: Robolectric's adapter never refuses to start discovery. */
  internal var startOsDiscovery: (BluetoothAdapter) -> Boolean = { it.startDiscovery() }

  /** Starts a session; [timeoutMs] 0 means "until the OS finishes". Call on the main thread. */
  @SuppressLint("MissingPermission") // requireAdapter checks the discovery scope.
  fun start(timeoutMs: Long, promise: SafePromise) {
    val adapter = preconditions.requireAdapter(PermissionScope.DISCOVERY)
    permissions.requireLocationServices(PermissionScope.DISCOVERY)
    if (session != null) {
      throw BluetoothClassicException(ErrorCode.DISCOVERY_ALREADY_RUNNING, "A discovery session is already running")
    }
    val session = Session(adapter, promise)
    val receiver =
      object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
          try {
            handle(session, intent)
          } catch (t: Throwable) {
            Logger.error("Could not handle ${intent.action}", t)
          }
        }
      }
    session.receiver = receiver
    this.session = session
    val filter =
      IntentFilter().apply {
        addAction(BluetoothDevice.ACTION_FOUND)
        addAction(BluetoothAdapter.ACTION_DISCOVERY_STARTED)
        addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
      }
    // Registered before the OS call, so no result can be missed.
    ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_EXPORTED)
    // A scan the OS is already running (for another app) counts as started.
    session.started = adapter.isDiscovering
    val accepted =
      try {
        startOsDiscovery(adapter)
      } catch (t: Throwable) {
        cleanUp(session)
        throw t
      }
    if (!accepted) {
      cleanUp(session)
      throw BluetoothClassicException(ErrorCode.DISCOVERY_FAILED, "The OS refused to start discovery")
    }
    schedule(session, START_GUARD_MS) {
      if (!session.started && !adapter.isDiscovering) {
        finish(session, BluetoothClassicException(ErrorCode.DISCOVERY_FAILED, "The OS did not start discovery"))
      }
    }
    // Without a timeout the OS ends the session (about 12 s); the cap only
    // guards against a finish broadcast that never comes.
    schedule(session, if (timeoutMs > 0) timeoutMs else MAX_SESSION_MS) { stop(session) }
  }

  /** Ends the running session, which resolves with what it found. Call on the main thread. */
  fun cancel(promise: SafePromise) {
    stop()
    promise.resolve(null)
  }

  /** Ends the running session, if any, before a connection attempt. Call on the main thread. */
  fun stop() {
    session?.let { stop(it) }
  }

  override fun onAdapterStateChanged(state: String, previousState: String) {
    val session = session ?: return
    if (state != AdapterMonitor.ON) {
      finish(session, BluetoothClassicException(ErrorCode.BLUETOOTH_DISABLED, "Bluetooth was turned off during discovery"))
    }
  }

  /** Stops scanning and drops the pending caller; its JS runtime is going away. */
  fun tearDown() {
    listeners.clear()
    val session = session ?: return
    cleanUp(session)
    session.promise.abandon()
  }

  private fun handle(session: Session, intent: Intent) {
    if (this.session !== session) return
    when (intent.action) {
      BluetoothAdapter.ACTION_DISCOVERY_STARTED -> session.started = true
      // A finish from a scan that ended before this session started is ignored.
      BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> if (session.started) finish(session, null)
      BluetoothDevice.ACTION_FOUND -> found(session, intent)
    }
  }

  private fun found(session: Session, intent: Intent) {
    val device =
      IntentCompat.getParcelableExtra(intent, BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java) ?: return
    val address = device.address.uppercase(Locale.ROOT)
    val rssi = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE).takeIf { it != Short.MIN_VALUE }
    val previous = session.found[address]
    // A repeat report may omit the name; keep the one seen earlier.
    val name = intent.getStringExtra(BluetoothDevice.EXTRA_NAME) ?: previous?.get("name") as String?
    val mapped = DeviceMapper.toMap(device, rssi?.toInt(), name)
    session.found[address] = mapped
    if (previous == null) {
      Logger.debug { "Found ${mapped["address"]} (${mapped["name"]})" }
      for (listener in listeners) {
        try {
          listener.onDeviceFound(mapped)
        } catch (t: Throwable) {
          Logger.error("A device-found listener threw", t)
        }
      }
    }
  }

  @SuppressLint("MissingPermission")
  private fun stop(session: Session) {
    try {
      session.adapter.cancelDiscovery()
    } catch (t: Throwable) {
      Logger.warn("Could not cancel discovery", t)
    }
    finish(session, null)
  }

  private fun finish(session: Session, error: Throwable?) {
    if (this.session !== session) return
    cleanUp(session)
    if (error == null) {
      session.promise.resolve(Writables.array(session.found.values.toList()))
    } else {
      session.promise.reject(error)
    }
  }

  @SuppressLint("MissingPermission")
  private fun cleanUp(session: Session) {
    if (this.session === session) this.session = null
    session.timers.forEach(main::removeCallbacks)
    session.timers.clear()
    session.receiver?.let {
      try {
        context.unregisterReceiver(it)
      } catch (e: IllegalArgumentException) {
        Logger.warn("The discovery receiver was already unregistered", e)
      }
    }
    session.receiver = null
    if (session.adapter.isDiscovering) {
      try {
        session.adapter.cancelDiscovery()
      } catch (t: Throwable) {
        Logger.warn("Could not cancel discovery", t)
      }
    }
  }

  private fun schedule(session: Session, delayMs: Long, action: () -> Unit) {
    val runnable = Runnable { if (this.session === session) action() }
    session.timers += runnable
    main.postDelayed(runnable, delayMs)
  }

  companion object {
    /** How long the OS may take to report that discovery started. */
    const val START_GUARD_MS = 10_000L
    /** The longest session JS can ask for; also the cap when no timeout is given. */
    const val MAX_SESSION_MS = 120_000L
  }
}
