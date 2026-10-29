package kjd.reactnative.bluetooth

import com.facebook.react.bridge.Promise
import java.util.concurrent.atomic.AtomicBoolean

/**
 * A promise that settles at most once and never throws. Every entry point
 * wraps its promise in one, so a late or repeated callback is dropped instead
 * of crashing the app.
 */
internal class SafePromise(private val promise: Promise, private val operation: String) {
  private val settled = AtomicBoolean(false)

  val isSettled: Boolean
    get() = settled.get()

  fun resolve(value: Any?) {
    if (!settled.compareAndSet(false, true)) return
    try {
      promise.resolve(value)
    } catch (t: Throwable) {
      Logger.error("Could not resolve $operation", t)
    }
  }

  fun reject(error: Throwable) {
    if (!settled.compareAndSet(false, true)) return
    val rejection = ErrorMapper.map(error)
    Logger.debug { "$operation rejected with ${rejection.code}: ${rejection.message}" }
    try {
      promise.reject(rejection.code, rejection.message, Writables.map(rejection.userInfo))
    } catch (t: Throwable) {
      Logger.error("Could not reject $operation", t)
    }
  }

  /** Drops the promise without settling it, for teardown: its JS runtime is gone. */
  fun abandon() {
    settled.set(true)
  }
}

/** Runs [block] and turns anything it throws into a rejection of [promise]. */
internal inline fun guarded(promise: SafePromise, block: () -> Unit) {
  try {
    block()
  } catch (t: Throwable) {
    promise.reject(t)
  }
}
