package kjd.reactnative.bluetooth

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import java.lang.reflect.InvocationTargetException
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList

/** OS bond calls that have no public API on every supported release. */
internal interface BondApi {
  /** Returns `false` when the OS refuses; throws when apps may not call it. */
  fun removeBond(device: BluetoothDevice): Boolean

  fun cancelBondProcess(device: BluetoothDevice): Boolean
}

/**
 * Calls through reflection: `removeBond()` is hidden on every release, and
 * `cancelBondProcess()` only became public in API 37, above the library's
 * default compileSdk.
 */
internal object ReflectiveBondApi : BondApi {
  override fun removeBond(device: BluetoothDevice) = invoke(device, "removeBond")

  override fun cancelBondProcess(device: BluetoothDevice) = invoke(device, "cancelBondProcess")

  private fun invoke(device: BluetoothDevice, name: String): Boolean =
    try {
      BluetoothDevice::class.java.getMethod(name).invoke(device) as Boolean
    } catch (e: InvocationTargetException) {
      throw e.targetException
    }
}

/**
 * Pairing, unpairing and bond events. The bond receiver lives on the
 * application context for the module's lifetime, so bonds that complete
 * behind the system pairing dialog are seen. All state is confined to the
 * main thread.
 */
internal class BondManager(
  private val context: Context,
  private val preconditions: Preconditions,
  private val main: Handler
) : AdapterMonitor.Listener {
  interface Listener {
    fun onBondStateChange(device: Map<String, Any?>, state: String, previousState: String)

    fun onBondLost(device: Map<String, Any?>)
  }

  private class Pending(val promise: SafePromise) {
    var timeout: Runnable? = null
  }

  internal var bondApi: BondApi = ReflectiveBondApi

  private val pairings = HashMap<String, Pending>()
  private val unpairings = HashMap<String, MutableList<Pending>>()
  private var receiver: BroadcastReceiver? = null
  private val listeners = CopyOnWriteArrayList<Listener>()

  fun addListener(listener: Listener) {
    listeners += listener
  }

  @Synchronized
  fun start() {
    if (receiver != null) return
    val receiver =
      object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
          try {
            handle(intent)
          } catch (t: Throwable) {
            Logger.error("Could not handle ${intent.action}", t)
          }
        }
      }
    val filter = IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED)
    if (Build.VERSION.SDK_INT >= Capabilities.BOND_LOSS_MIN_SDK) filter.addAction(ACTION_KEY_MISSING)
    // System broadcasts: they must be exported to be received.
    ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_EXPORTED)
    this.receiver = receiver
  }

  /** Unregisters the receiver. Safe from any thread. */
  @Synchronized
  fun stop() {
    receiver?.let {
      try {
        context.unregisterReceiver(it)
      } catch (e: IllegalArgumentException) {
        Logger.warn("The bond receiver was already unregistered", e)
      }
    }
    receiver = null
  }

  /** Drops pending callers; their JS runtime is going away. Call on the main thread. */
  fun tearDown() {
    listeners.clear()
    allPending().forEach {
      clearTimeout(it)
      it.promise.abandon()
    }
    pairings.clear()
    unpairings.clear()
  }

  /** Bonds with [address] through the system pairing UI. Call on the main thread. */
  @SuppressLint("MissingPermission") // requireAdapter checks the connect scope.
  fun pair(address: String, timeoutMs: Long, promise: SafePromise) {
    val key = DeviceMapper.requireAddress(address)
    val adapter = preconditions.requireAdapter(PermissionScope.CONNECT)
    if (pairings.containsKey(key)) {
      throw BluetoothClassicException(
        ErrorCode.PAIRING_IN_PROGRESS,
        "Pairing with this device is already in progress",
        deviceId = key
      )
    }
    val device = adapter.getRemoteDevice(key)
    if (device.bondState == BluetoothDevice.BOND_BONDED) {
      promise.resolve(Writables.map(DeviceMapper.toMap(device)))
      return
    }
    // Registered before createBond, so a fast outcome can't be missed.
    val pending = Pending(promise)
    pairings[key] = pending
    val started =
      try {
        device.createBond()
      } catch (t: Throwable) {
        pairings.remove(key)
        throw t
      }
    if (!started) {
      pairings.remove(key)
      throw BluetoothClassicException(ErrorCode.PAIRING_FAILED, "The OS refused to start bonding", deviceId = key)
    }
    Logger.debug { "Pairing with $key" }
    schedule(pending, timeoutMs) {
      pairings.remove(key)
      try {
        bondApi.cancelBondProcess(device)
      } catch (t: Throwable) {
        Logger.warn("Could not cancel the bonding attempt", t)
      }
      promise.reject(
        BluetoothClassicException(
          ErrorCode.PAIRING_TIMEOUT,
          "Pairing did not complete within $timeoutMs ms",
          deviceId = key
        )
      )
    }
  }

  /** Removes the bond with [address]. Call on the main thread. */
  @SuppressLint("MissingPermission") // requireAdapter checks the connect scope.
  fun unpair(address: String, promise: SafePromise) {
    val key = DeviceMapper.requireAddress(address)
    val adapter = preconditions.requireAdapter(PermissionScope.CONNECT)
    val device = adapter.getRemoteDevice(key)
    if (device.bondState == BluetoothDevice.BOND_NONE) {
      promise.resolve(null)
      return
    }
    val pending = Pending(promise)
    val waiting = unpairings[key]
    if (waiting != null) {
      // Already removing this bond: settle with the same outcome.
      waiting += pending
      return
    }
    val removed =
      try {
        bondApi.removeBond(device)
      } catch (e: ReflectiveOperationException) {
        throw unpairBlocked(key, e)
      } catch (e: SecurityException) {
        throw unpairBlocked(key, e)
      }
    if (!removed) throw unpairBlocked(key, null)
    unpairings[key] = mutableListOf(pending)
    schedule(pending, UNPAIR_GUARD_MS) {
      settleUnpair(key, BluetoothClassicException(ErrorCode.UNKNOWN, "The OS did not remove the bond within 15 s", deviceId = key))
    }
  }

  override fun onAdapterStateChanged(state: String, previousState: String) {
    if (state == AdapterMonitor.ON) return
    val error = { key: String ->
      BluetoothClassicException(ErrorCode.BLUETOOTH_DISABLED, "Bluetooth was turned off", deviceId = key)
    }
    for (key in pairings.keys.toList()) settlePairing(key, null, error(key))
    for (key in unpairings.keys.toList()) settleUnpair(key, error(key))
  }

  private fun handle(intent: Intent) {
    val device =
      IntentCompat.getParcelableExtra(intent, BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java) ?: return
    val key = device.address.uppercase(Locale.ROOT)
    when (intent.action) {
      BluetoothDevice.ACTION_BOND_STATE_CHANGED -> {
        val state = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.ERROR)
        val previous = intent.getIntExtra(BluetoothDevice.EXTRA_PREVIOUS_BOND_STATE, BluetoothDevice.ERROR)
        if (state == BluetoothDevice.ERROR) return
        val mapped = DeviceMapper.toMap(device) + ("bondState" to DeviceMapper.bondStateName(state))
        Logger.debug { "Bond state of $key: ${DeviceMapper.bondStateName(previous)} -> ${mapped["bondState"]}" }
        notify { it.onBondStateChange(mapped, DeviceMapper.bondStateName(state), DeviceMapper.bondStateName(previous)) }
        when (state) {
          BluetoothDevice.BOND_BONDED -> settlePairing(key, mapped, null)
          BluetoothDevice.BOND_NONE -> {
            settlePairing(
              key,
              null,
              BluetoothClassicException(ErrorCode.PAIRING_FAILED, "Bonding ended without a bond", deviceId = key)
            )
            settleUnpair(key, null)
          }
        }
      }
      ACTION_KEY_MISSING -> {
        Logger.debug { "Bond keys missing for $key" }
        val mapped = DeviceMapper.toMap(device)
        notify { it.onBondLost(mapped) }
      }
    }
  }

  private fun notify(event: (Listener) -> Unit) {
    for (listener in listeners) {
      try {
        event(listener)
      } catch (t: Throwable) {
        Logger.error("A bond listener threw", t)
      }
    }
  }

  private fun settlePairing(key: String, device: Map<String, Any?>?, error: Throwable?) {
    val pending = pairings.remove(key) ?: return
    clearTimeout(pending)
    if (error == null) pending.promise.resolve(Writables.map(device!!)) else pending.promise.reject(error)
  }

  private fun settleUnpair(key: String, error: Throwable?) {
    val waiting = unpairings.remove(key) ?: return
    for (pending in waiting) {
      clearTimeout(pending)
      if (error == null) pending.promise.resolve(null) else pending.promise.reject(error)
    }
  }

  private fun unpairBlocked(key: String, cause: Throwable?) =
    BluetoothClassicException(
      ErrorCode.UNSUPPORTED_ON_PLATFORM,
      "This Android release does not allow apps to remove bonds; unpair in system settings",
      deviceId = key,
      cause = cause
    )

  private fun schedule(pending: Pending, delayMs: Long, action: () -> Unit) {
    val runnable = Runnable(action)
    pending.timeout = runnable
    main.postDelayed(runnable, delayMs)
  }

  private fun clearTimeout(pending: Pending) {
    pending.timeout?.let(main::removeCallbacks)
    pending.timeout = null
  }

  private fun allPending(): List<Pending> = pairings.values + unpairings.values.flatten()

  companion object {
    /** `BluetoothDevice.ACTION_KEY_MISSING` (API 36), spelled out for apps compiling against older SDKs. */
    const val ACTION_KEY_MISSING = "android.bluetooth.device.action.KEY_MISSING"
    const val UNPAIR_GUARD_MS = 15_000L
  }
}
