package kjd.reactnative.bluetooth

import android.content.pm.PackageManager
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class EntryPointTest : ModuleTest() {
  private var adapterFailure: Throwable? = null

  override fun adapterProvider(): (() -> android.bluetooth.BluetoothAdapter?) = {
    adapterFailure?.let { throw it }
    adapter
  }

  /** Every promise-returning entry point, with valid arguments. */
  private val entryPoints: Map<String, (Promise) -> Unit>
    get() =
      mapOf(
        "getAdapterState" to { p -> module.getAdapterState(p) },
        "requestEnable" to { p -> module.requestEnable(p) },
        "openSettings" to { p -> module.openSettings(p) },
        "setAdapterName" to { p -> module.setAdapterName("Kiosk 12", p) },
        "checkPermissions" to { p -> module.checkPermissions("connect", p) },
        "requestPermissions" to { p -> module.requestPermissions("connect", p) },
        "getBondedDevices" to { p -> module.getBondedDevices(p) },
        "startDiscovery" to { p -> module.startDiscovery(12_000.0, p) },
        "cancelDiscovery" to { p -> module.cancelDiscovery(p) },
        "pair" to { p -> module.pair("00:11:22:33:44:55", 30_000.0, p) },
        "unpair" to { p -> module.unpair("00:11:22:33:44:55", p) },
        "getConnectedAccessories" to { p -> module.getConnectedAccessories(p) },
        "showAccessoryPicker" to { p -> module.showAccessoryPicker(null, p) },
        "connect" to { p -> module.connect("op-1", "00:11:22:33:44:55", JavaOnlyMap.of("timeoutMs", 10_000.0), p) },
        "accept" to { p -> module.accept("op-2", JavaOnlyMap.of("timeoutMs", 10_000.0), p) },
        "cancelOperation" to { p -> module.cancelOperation("op-1", p) },
        "cancelAccept" to { p -> module.cancelAccept(p) },
        "getConnections" to { p -> module.getConnections(p) },
        "write" to { p -> module.write("c1", "AAE=", 5_000.0, p) },
        "disconnect" to { p -> module.disconnect("c1", 5_000.0, p) },
        "closeWithError" to { p -> module.closeWithError("c1", ErrorCode.UNKNOWN, "x", p) }
      )

  private val knownCodes = ErrorCode::class.java.declaredFields.mapNotNull { it.get(null) as? String }.toSet()

  private fun assertEveryEntryPointSettlesOnce() {
    val activity = foregroundActivity().get()
    for ((name, invoke) in entryPoints) {
      val promise = call(invoke)
      // The emulated user denies any permission prompt.
      activity.prompts.forEach { prompt ->
        val denied = IntArray(prompt.permissions.size) { PackageManager.PERMISSION_DENIED }
        prompt.listener?.onRequestPermissionsResult(prompt.requestCode, prompt.permissions.toTypedArray(), denied)
      }
      activity.prompts.clear()
      // End a discovery session the call may have started.
      module.cancelDiscovery(RecordingPromise())
      idle()
      assertEquals("$name settles exactly once", 1, promise.settleCount)
      if (!promise.resolved) {
        assertTrue("$name rejects with a known code, got ${promise.code}", promise.code in knownCodes)
      }
    }
  }

  @Test
  fun `every entry point settles exactly once`() = assertEveryEntryPointSettlesOnce()

  @Test
  fun `an OS security exception settles every entry point instead of escaping`() {
    adapterFailure = SecurityException("Need android.permission.BLUETOOTH_CONNECT permission")
    assertEveryEntryPointSettlesOnce()

    val promise = call { module.getAdapterState(it) }
    assertEquals(ErrorCode.PERMISSION_DENIED, promise.code)
    assertEquals(listOf("BLUETOOTH_CONNECT"), promise.missingPermissions())
  }

  @Test
  fun `an unexpected exception settles every entry point with UNKNOWN`() {
    adapterFailure = IllegalStateException("binder died")
    assertEveryEntryPointSettlesOnce()

    val promise = call { module.getAdapterState(it) }
    assertEquals(ErrorCode.UNKNOWN, promise.code)
    assertEquals("java.lang.IllegalStateException", promise.userInfo?.getString("nativeCode"))
    assertEquals("binder died", promise.userInfo?.getString("nativeMessage"))
  }

  @Test
  fun `a promise that throws while settling does not escape`() {
    val throwing =
      object : Promise by RecordingPromise() {
        override fun resolve(value: Any?) = throw IllegalStateException("runtime gone")

        override fun reject(code: String?, message: String?, userInfo: WritableMap) =
          throw IllegalStateException("runtime gone")
      }

    module.getAdapterState(throwing)
    module.checkPermissions("nope", throwing)
    idle()
  }

  @Test
  fun `an unknown scope is INVALID_ARGUMENT`() {
    assertEquals(ErrorCode.INVALID_ARGUMENT, call { module.checkPermissions("everything", it) }.code)
    assertEquals(ErrorCode.INVALID_ARGUMENT, call { module.requestPermissions("everything", it) }.code)
  }

  @Test
  fun `iOS-only and not yet implemented operations reject with UNSUPPORTED_ON_PLATFORM`() {
    val picker = call { module.showAccessoryPicker(null, it) }
    assertEquals(ErrorCode.UNSUPPORTED_ON_PLATFORM, picker.code)
    assertEquals("showAccessoryPicker() is only available on iOS", picker.message)

    assertEquals(
      ErrorCode.UNSUPPORTED_ON_PLATFORM,
      call { module.connect("op-3", "00:11:22:33:44:55", JavaOnlyMap.of("timeoutMs", 1_000.0), it) }.code
    )
  }

  @Test
  fun `getConnections resolves with no connections`() {
    val promise = call { module.getConnections(it) }
    assertEquals(0, (promise.value as ReadableArray).size())
  }
}
