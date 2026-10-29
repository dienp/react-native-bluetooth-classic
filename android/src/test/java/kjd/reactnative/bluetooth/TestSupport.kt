package kjd.reactnative.bluetooth

import android.app.Activity
import android.app.Application
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Intent
import android.os.Build
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import org.junit.After
import org.junit.Before
import org.robolectric.Robolectric
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.shadows.ShadowApplication

/** Swaps the JNI-backed React Native maps for plain Java ones. */
fun useJavaOnlyWritables() {
  Writables.createMap = { JavaOnlyMap() }
  Writables.createArray = { JavaOnlyArray() }
}

/** Records how a promise settled, and how many times anything tried to settle it. */
class RecordingPromise : Promise {
  var settleCount = 0
    private set
  var resolved = false
    private set
  var value: Any? = null
    private set
  var code: String? = null
    private set
  var message: String? = null
    private set
  var userInfo: ReadableMap? = null
    private set

  val isSettled: Boolean
    get() = settleCount > 0

  override fun resolve(value: Any?) {
    settleCount++
    resolved = true
    this.value = value
  }

  private fun fail(code: String?, message: String?, userInfo: WritableMap?) {
    settleCount++
    this.code = code
    this.message = message
    this.userInfo = userInfo
  }

  override fun reject(code: String?, message: String?) = fail(code, message, null)

  override fun reject(code: String?, throwable: Throwable?) = fail(code, throwable?.message, null)

  override fun reject(code: String?, message: String?, throwable: Throwable?) = fail(code, message, null)

  override fun reject(throwable: Throwable) = fail(null, throwable.message, null)

  override fun reject(throwable: Throwable, userInfo: WritableMap) = fail(null, throwable.message, userInfo)

  override fun reject(code: String?, userInfo: WritableMap) = fail(code, null, userInfo)

  override fun reject(code: String?, throwable: Throwable?, userInfo: WritableMap) =
    fail(code, throwable?.message, userInfo)

  override fun reject(code: String?, message: String?, userInfo: WritableMap) = fail(code, message, userInfo)

  override fun reject(code: String?, message: String?, throwable: Throwable?, userInfo: WritableMap?) =
    fail(code, message, userInfo)

  override fun reject(message: String) = fail(null, message, null)

  fun map(): ReadableMap = value as ReadableMap

  fun missingPermissions(): List<String> =
    userInfo?.getArray("missingPermissions")?.toArrayList()?.map { it as String } ?: emptyList()
}

/** A host activity whose permission prompts the test answers. */
class TestPermissionActivity : Activity(), PermissionAwareActivity {
  class Prompt(val permissions: List<String>, val requestCode: Int, val listener: PermissionListener?)

  val prompts = mutableListOf<Prompt>()
  /** Permissions (full names) for which the OS would show a rationale. */
  val rationale = mutableSetOf<String>()

  override fun requestPermissions(permissions: Array<String>, requestCode: Int, listener: PermissionListener?) {
    prompts += Prompt(permissions.toList(), requestCode, listener)
  }

  override fun shouldShowRequestPermissionRationale(permission: String): Boolean = permission in rationale
}

/** Runs a [BluetoothClassicModule] on a Robolectric application, as the TurboModule system would. */
abstract class ModuleTest {
  protected lateinit var app: Application
  protected lateinit var reactContext: ReactApplicationContext
  protected lateinit var module: BluetoothClassicModule

  protected val adapter: BluetoothAdapter
    get() = app.getSystemService(BluetoothManager::class.java).adapter

  protected val sdkInt: Int
    get() = Build.VERSION.SDK_INT

  /** Overridden by tests that need a different adapter, or none. */
  protected open fun adapterProvider(): (() -> BluetoothAdapter?)? = null

  @Before
  fun setUpModule() {
    useJavaOnlyWritables()
    Logger.setLevel(Logger.DEFAULT_LEVEL)
    app = ApplicationProvider.getApplicationContext()
    reactContext = BridgeReactContext(app)
    shadowOf(adapter).setState(BluetoothAdapter.STATE_ON)
    module = BluetoothClassicModule(reactContext, adapterProvider())
    module.initialize()
  }

  @After
  fun tearDownModule() {
    module.invalidate()
    idle()
  }

  protected fun idle() = shadowOf(Looper.getMainLooper()).idle()

  protected fun grant(vararg permissions: String) =
    shadowOf(app).grantPermissions(*permissions.map { "android.permission.$it" }.toTypedArray())

  protected fun deny(vararg permissions: String) =
    shadowOf(app).denyPermissions(*permissions.map { "android.permission.$it" }.toTypedArray())

  /** Changes the adapter state the way the OS does: state first, then the broadcast. */
  protected fun transition(state: Int, previous: Int) {
    shadowOf(adapter).setState(state)
    app.sendBroadcast(
      Intent(BluetoothAdapter.ACTION_STATE_CHANGED)
        .putExtra(BluetoothAdapter.EXTRA_STATE, state)
        .putExtra(BluetoothAdapter.EXTRA_PREVIOUS_STATE, previous)
    )
    idle()
  }

  /** Starts a host activity and makes it React Native's current activity. */
  protected fun foregroundActivity(): ActivityController<TestPermissionActivity> {
    val controller = Robolectric.buildActivity(TestPermissionActivity::class.java).setup()
    reactContext.onHostResume(controller.get())
    return controller
  }

  /** Receivers registered for adapter state changes. */
  protected fun registeredStateReceivers(): List<ShadowApplication.Wrapper> =
    shadowOf(app).registeredReceivers.filter { it.intentFilter.hasAction(BluetoothAdapter.ACTION_STATE_CHANGED) }

  /** Calls an entry point and lets posted main-thread work run. */
  protected fun call(block: (Promise) -> Unit): RecordingPromise {
    val promise = RecordingPromise()
    block(promise)
    idle()
    return promise
  }
}

