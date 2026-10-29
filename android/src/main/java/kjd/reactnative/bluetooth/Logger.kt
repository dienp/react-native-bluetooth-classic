package kjd.reactnative.bluetooth

import android.util.Log

/**
 * The library's logcat output. The level is set from JS with `setLogLevel` and
 * defaults to `warn`. Payloads, device names and addresses may only appear in
 * [debug] messages, which are not even built below `debug`, or through
 * [redact] in messages logged at higher levels.
 */
internal object Logger {
  const val TAG = "RNBluetoothClassic"
  const val DEFAULT_LEVEL = "warn"

  private val LEVELS = listOf("debug", "info", "warn", "error", "silent")

  @Volatile private var threshold = LEVELS.indexOf(DEFAULT_LEVEL)

  val level: String
    get() = LEVELS[threshold]

  /** Sets the level; an unknown name is ignored, because JS validates it first. */
  fun setLevel(name: String) {
    val index = LEVELS.indexOf(name)
    if (index >= 0) threshold = index
  }

  val isDebug: Boolean
    get() = threshold == 0

  /** Returns [value] when debug logging is on, and a placeholder otherwise. */
  fun redact(value: String?): String = if (isDebug) value.toString() else "<redacted>"

  inline fun debug(message: () -> String) {
    if (isDebug) Log.d(TAG, message())
  }

  fun info(message: String) {
    if (enabled(1)) Log.i(TAG, message)
  }

  fun warn(message: String, error: Throwable? = null) {
    if (enabled(2)) Log.w(TAG, message, error)
  }

  fun error(message: String, error: Throwable? = null) {
    if (enabled(3)) Log.e(TAG, message, error)
  }

  private fun enabled(index: Int) = threshold <= index
}
