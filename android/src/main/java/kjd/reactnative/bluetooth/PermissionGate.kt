package kjd.reactnative.bluetooth

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener

internal enum class PermissionScope(val jsName: String) {
  DISCOVERY("discovery"),
  CONNECT("connect"),
  SERVER("server");

  companion object {
    fun parse(name: String): PermissionScope =
      entries.firstOrNull { it.jsName == name }
        ?: throw BluetoothClassicException(
          ErrorCode.INVALID_ARGUMENT,
          "scope must be 'discovery', 'connect' or 'server'"
        )
  }
}

internal data class PermissionStatus(
  val granted: Boolean,
  /** Short names, e.g. `BLUETOOTH_SCAN`. */
  val missing: List<String>,
  /** Reported for `discovery` on API 24-30 only. */
  val locationServicesEnabled: Boolean? = null,
  val canAskAgain: Boolean? = null
) {
  fun toMap(): Map<String, Any?> {
    val map = mutableMapOf<String, Any?>("granted" to granted, "missing" to missing)
    locationServicesEnabled?.let { map["locationServicesEnabled"] = it }
    canAskAgain?.let { map["canAskAgain"] = it }
    return map
  }
}

/**
 * Maps permission scopes to the runtime permissions of the running API band,
 * checks them, and requests them through the host `PermissionAwareActivity`.
 * Requests run one at a time on the main thread, because the activity keeps a
 * single permission listener.
 */
internal class PermissionGate(
  private val context: Context,
  private val currentActivity: () -> Activity?,
  private val main: Handler
) : LifecycleEventListener {
  private class Request(val scope: PermissionScope, val promise: SafePromise) {
    var dispatched = false
    var hostPaused = false
  }

  // Main thread only.
  private val queue = ArrayDeque<Request>()

  private val sdkInt: Int
    get() = Build.VERSION.SDK_INT

  private val prefs by lazy { context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE) }

  /**
   * The permissions a scope needs. Each inner list is satisfied by any one of
   * its entries; the first entry is the one requested and reported as missing.
   */
  fun required(scope: PermissionScope): List<List<String>> =
    when {
      sdkInt >= Build.VERSION_CODES.S ->
        if (scope == PermissionScope.DISCOVERY) listOf(listOf(SCAN), listOf(CONNECT)) else listOf(listOf(CONNECT))
      scope != PermissionScope.DISCOVERY -> emptyList()
      sdkInt >= Build.VERSION_CODES.Q -> listOf(listOf(FINE_LOCATION))
      else -> listOf(listOf(COARSE_LOCATION, FINE_LOCATION))
    }

  fun missing(scope: PermissionScope): List<String> =
    required(scope).filter { alternatives -> alternatives.none(::isGranted) }.map { it.first() }

  fun status(scope: PermissionScope): PermissionStatus {
    val missing = missing(scope)
    val location = if (needsLocationServices(scope)) isLocationEnabled() else null
    return PermissionStatus(missing.isEmpty(), missing, location)
  }

  /** Rejects with `PERMISSION_DENIED` when the scope lacks a permission. */
  fun require(scope: PermissionScope) {
    val missing = missing(scope)
    if (missing.isNotEmpty()) {
      throw BluetoothClassicException(
        ErrorCode.PERMISSION_DENIED,
        "Missing permissions: ${missing.joinToString(", ")}",
        missingPermissions = missing
      )
    }
  }

  /** On API 24-30 the OS silently finds nothing while Location Services is off. */
  fun requireLocationServices(scope: PermissionScope) {
    if (needsLocationServices(scope) && !isLocationEnabled()) {
      throw BluetoothClassicException(
        ErrorCode.LOCATION_SERVICES_DISABLED,
        "Location Services must be on for discovery on Android 7 to 11"
      )
    }
  }

  fun isLocationEnabled(): Boolean {
    val manager = context.getSystemService(LocationManager::class.java) ?: return false
    return LocationManagerCompat.isLocationEnabled(manager)
  }

  /** Prompts for the scope's missing permissions. Call on the main thread. */
  fun request(scope: PermissionScope, promise: SafePromise) {
    val status = status(scope)
    if (status.granted) {
      promise.resolve(Writables.map(status.copy(canAskAgain = true).toMap()))
      return
    }
    queue.addLast(Request(scope, promise))
    if (queue.size == 1) startNext()
  }

  /** Drops queued requests; their JS runtime is going away. */
  fun cancel() {
    queue.forEach { it.promise.abandon() }
    queue.clear()
  }

  override fun onHostPause() {
    queue.firstOrNull()?.takeIf { it.dispatched }?.hostPaused = true
  }

  override fun onHostResume() {
    val head = queue.firstOrNull() ?: return
    if (!head.dispatched || !head.hostPaused) return
    // ReactActivity delivers the permission result right after this callback
    // in the same onResume. If it doesn't (another library replaced the
    // activity's listener, or the activity was recreated), finish with the
    // current state instead of leaving the promise pending forever.
    main.post { if (queue.firstOrNull() === head) finish(head, answered = emptyList()) }
  }

  override fun onHostDestroy() {
    queue.firstOrNull()?.takeIf { it.dispatched }?.let { finish(it, answered = emptyList()) }
  }

  private fun startNext() {
    val request = queue.firstOrNull() ?: return
    guarded(request.promise) {
      val status = status(request.scope)
      if (status.granted) {
        finish(request, answered = emptyList())
        return
      }
      val activity = currentActivity() as? PermissionAwareActivity
      if (activity == null) {
        throw BluetoothClassicException(
          ErrorCode.ACTIVITY_UNAVAILABLE,
          "requestPermissions() needs a React Native activity in the foreground"
        )
      }
      val names = status.missing.map { "$PREFIX$it" }.toTypedArray()
      request.dispatched = true
      activity.requestPermissions(
        names,
        REQUEST_CODE,
        // Called on the main thread. Finishing here, not in a posted task,
        // keeps the onHostResume fallback from running first.
        PermissionListener { requestCode, permissions, _ ->
          if (requestCode != REQUEST_CODE) return@PermissionListener false
          if (queue.firstOrNull() === request) {
            finish(request, permissions.map { it.removePrefix(PREFIX) })
          }
          true
        }
      )
    }
    if (request.promise.isSettled && queue.firstOrNull() === request) {
      queue.removeFirst()
      main.post(::startNext)
    }
  }

  /** Settles the head request with the current state and starts the next one. */
  private fun finish(request: Request, answered: List<String>) {
    queue.remove(request)
    guarded(request.promise) {
      if (answered.isNotEmpty()) {
        prefs.edit().apply { answered.forEach { putBoolean(it, true) } }.apply()
      }
      val status = status(request.scope)
      request.promise.resolve(Writables.map(status.copy(canAskAgain = canAskAgain(status.missing)).toMap()))
    }
    main.post(::startNext)
  }

  /**
   * The OS stops prompting once the user picks "don't ask again" (or denies
   * twice on API 30+). After that it no longer asks for a rationale either, so
   * a permission asked for before with no rationale pending is blocked.
   */
  private fun canAskAgain(missing: List<String>): Boolean {
    val activity = currentActivity() as? PermissionAwareActivity
    return missing.all { permission ->
      !prefs.getBoolean(permission, false) ||
        activity?.shouldShowRequestPermissionRationale("$PREFIX$permission") ?: true
    }
  }

  private fun needsLocationServices(scope: PermissionScope) =
    scope == PermissionScope.DISCOVERY && sdkInt <= Build.VERSION_CODES.R

  private fun isGranted(permission: String) =
    ContextCompat.checkSelfPermission(context, "$PREFIX$permission") == PackageManager.PERMISSION_GRANTED

  companion object {
    const val SCAN = "BLUETOOTH_SCAN"
    const val CONNECT = "BLUETOOTH_CONNECT"
    const val FINE_LOCATION = "ACCESS_FINE_LOCATION"
    const val COARSE_LOCATION = "ACCESS_COARSE_LOCATION"

    /** Library-unique; must fit in 16 bits for FragmentActivity. */
    const val REQUEST_CODE = 0x4231
    private const val PREFIX = "android.permission."
    private const val PREFS_NAME = "kjd.reactnative.bluetooth.permissions"
  }
}
