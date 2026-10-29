package kjd.reactnative.bluetooth

/**
 * An expected failure. Entry points reject with its [code], which must be one
 * of the [ErrorCode] constants, and with whichever context fields are set.
 */
internal class BluetoothClassicException(
  val code: String,
  message: String,
  val missingPermissions: List<String>? = null,
  val deviceId: String? = null,
  val connectionId: String? = null,
  cause: Throwable? = null
) : Exception(message, cause)
