package kjd.reactnative.bluetooth

/**
 * What a promise rejects with. [userInfo] holds the fields JS reads into
 * `BluetoothClassicError`: `nativeCode`, `nativeMessage`, `deviceId`,
 * `connectionId` and `missingPermissions`.
 */
internal data class Rejection(
  val code: String,
  val message: String,
  val userInfo: Map<String, Any> = emptyMap()
)

/** Maps anything thrown inside the library to an [ErrorCode]. */
internal object ErrorMapper {
  private val PERMISSION_NAME = Regex("""android\.permission\.([A-Z_]+)""")

  fun map(error: Throwable): Rejection =
    when (error) {
      is BluetoothClassicException -> fromLibrary(error)
      is SecurityException ->
        Rejection(
          ErrorCode.PERMISSION_DENIED,
          "The OS refused a Bluetooth operation because a permission is missing",
          nativeInfo(error) + permissionsNamedIn(error.message)
        )
      is IllegalArgumentException ->
        Rejection(
          ErrorCode.INVALID_ARGUMENT,
          error.message ?: "The OS rejected an argument",
          nativeInfo(error)
        )
      else ->
        Rejection(
          ErrorCode.UNKNOWN,
          "Unexpected failure: ${error.message ?: error.javaClass.simpleName}",
          nativeInfo(error)
        )
    }

  private fun fromLibrary(error: BluetoothClassicException): Rejection {
    val info = mutableMapOf<String, Any>()
    error.cause?.let { info += nativeInfo(it) }
    error.deviceId?.let { info["deviceId"] = it }
    error.connectionId?.let { info["connectionId"] = it }
    error.missingPermissions?.let { info["missingPermissions"] = it }
    return Rejection(error.code, error.message ?: error.code, info)
  }

  private fun nativeInfo(error: Throwable): Map<String, Any> {
    val info = mutableMapOf<String, Any>("nativeCode" to error.javaClass.name)
    error.message?.let { info["nativeMessage"] = it }
    return info
  }

  /** OS security exceptions name the permission, e.g. "Need android.permission.BLUETOOTH_SCAN". */
  private fun permissionsNamedIn(message: String?): Map<String, Any> {
    val names = PERMISSION_NAME.findAll(message ?: "").map { it.groupValues[1] }.distinct().toList()
    return if (names.isEmpty()) emptyMap() else mapOf("missingPermissions" to names)
  }
}
