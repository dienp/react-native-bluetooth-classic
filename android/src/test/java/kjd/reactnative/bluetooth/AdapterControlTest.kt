package kjd.reactnative.bluetooth

import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.os.Looper
import android.provider.Settings
import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** `requestEnable()`, `openSettings()` and `setAdapterName()`. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30, 36])
class AdapterControlTest : ModuleTest() {
  @Before
  fun grantConnect() = grant(PermissionGate.CONNECT)

  private fun turnOffSilently() = shadowOf(adapter).setState(BluetoothAdapter.STATE_OFF)

  private fun TestPermissionActivity.enablePrompts() =
    generateSequence { shadowOf(this).nextStartedActivityForResult }.toList()

  private fun answerEnablePrompt(activity: Activity, resultCode: Int) {
    reactContext.onActivityResult(activity, EnableRequester.REQUEST_CODE, resultCode, null)
    idle()
  }

  private fun turnOn() {
    transition(BluetoothAdapter.STATE_TURNING_ON, BluetoothAdapter.STATE_OFF)
    transition(BluetoothAdapter.STATE_ON, BluetoothAdapter.STATE_TURNING_ON)
  }

  // ---- requestEnable ----

  @Test
  fun `resolves immediately when Bluetooth is already on`() {
    val activity = foregroundActivity().get()

    val promise = call { module.requestEnable(it) }

    assertTrue(promise.resolved)
    assertTrue(activity.enablePrompts().isEmpty())
  }

  @Test
  fun `resolves after the user accepts and the adapter reports on`() {
    turnOffSilently()
    val activity = foregroundActivity().get()

    val promise = call { module.requestEnable(it) }
    val prompt = activity.enablePrompts().single()
    assertEquals(BluetoothAdapter.ACTION_REQUEST_ENABLE, prompt.intent.action)
    assertEquals(EnableRequester.REQUEST_CODE, prompt.requestCode)

    answerEnablePrompt(activity, Activity.RESULT_OK)
    assertFalse("waits for the adapter", promise.isSettled)
    transition(BluetoothAdapter.STATE_TURNING_ON, BluetoothAdapter.STATE_OFF)
    assertFalse(promise.isSettled)
    transition(BluetoothAdapter.STATE_ON, BluetoothAdapter.STATE_TURNING_ON)

    assertTrue(promise.resolved)
    assertEquals(1, promise.settleCount)
  }

  @Test
  fun `resolves when the adapter turns on before the prompt result arrives`() {
    turnOffSilently()
    val activity = foregroundActivity().get()

    val promise = call { module.requestEnable(it) }
    turnOn()
    assertTrue(promise.resolved)

    answerEnablePrompt(activity, Activity.RESULT_OK)
    assertEquals(1, promise.settleCount)
  }

  @Test
  fun `the user declining rejects with USER_REJECTED`() {
    turnOffSilently()
    val activity = foregroundActivity().get()

    val promise = call { module.requestEnable(it) }
    answerEnablePrompt(activity, Activity.RESULT_CANCELED)

    assertEquals(ErrorCode.USER_REJECTED, promise.code)
  }

  @Test
  fun `concurrent requests share one prompt and one result`() {
    turnOffSilently()
    val activity = foregroundActivity().get()

    val first = call { module.requestEnable(it) }
    val second = call { module.requestEnable(it) }
    assertEquals(1, activity.enablePrompts().size)

    answerEnablePrompt(activity, Activity.RESULT_CANCELED)

    assertEquals(ErrorCode.USER_REJECTED, first.code)
    assertEquals(ErrorCode.USER_REJECTED, second.code)
  }

  @Test
  fun `accepted but never on rejects with BLUETOOTH_DISABLED after 15 s`() {
    turnOffSilently()
    val activity = foregroundActivity().get()

    val promise = call { module.requestEnable(it) }
    answerEnablePrompt(activity, Activity.RESULT_OK)
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(EnableRequester.TIMEOUT_MS - 1))
    assertFalse(promise.isSettled)
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1))

    assertEquals(ErrorCode.BLUETOOTH_DISABLED, promise.code)
  }

  @Test
  fun `no foreground activity rejects with ACTIVITY_UNAVAILABLE`() {
    turnOffSilently()

    assertEquals(ErrorCode.ACTIVITY_UNAVAILABLE, call { module.requestEnable(it) }.code)
  }

  @Test
  fun `no app to show the prompt rejects with ACTIVITY_UNAVAILABLE`() {
    turnOffSilently()
    foregroundActivity()
    shadowOf(app).checkActivities(true)

    assertEquals(ErrorCode.ACTIVITY_UNAVAILABLE, call { module.requestEnable(it) }.code)
  }

  @Test
  fun `on API 31+ a missing BLUETOOTH_CONNECT rejects with PERMISSION_DENIED`() {
    assumeTrue(sdkInt >= 31)
    deny(PermissionGate.CONNECT)
    turnOffSilently()
    val activity = foregroundActivity().get()

    val promise = call { module.requestEnable(it) }

    assertEquals(ErrorCode.PERMISSION_DENIED, promise.code)
    assertEquals(listOf("BLUETOOTH_CONNECT"), promise.missingPermissions())
    assertTrue(activity.enablePrompts().isEmpty())
  }

  // ---- openSettings ----

  @Test
  fun `openSettings opens the Bluetooth settings`() {
    val activity = foregroundActivity().get()

    val promise = call { module.openSettings(it) }

    assertTrue(promise.resolved)
    assertEquals(Settings.ACTION_BLUETOOTH_SETTINGS, shadowOf(activity).nextStartedActivity.action)
  }

  @Test
  fun `openSettings without a foreground activity rejects with ACTIVITY_UNAVAILABLE`() {
    assertEquals(ErrorCode.ACTIVITY_UNAVAILABLE, call { module.openSettings(it) }.code)
  }

  @Test
  fun `openSettings with no settings app rejects with ACTIVITY_UNAVAILABLE`() {
    foregroundActivity()
    shadowOf(app).checkActivities(true)

    assertEquals(ErrorCode.ACTIVITY_UNAVAILABLE, call { module.openSettings(it) }.code)
  }

  // ---- setAdapterName ----

  @Test
  fun `a valid name is applied`() {
    val promise = call { module.setAdapterName("Kiosk 12", it) }

    assertTrue(promise.resolved)
    assertEquals("Kiosk 12", adapter.name)
  }

  @Test
  fun `the 248-byte limit counts UTF-8 bytes`() {
    // "é" is two bytes in UTF-8, "€" three.
    assertTrue(call { module.setAdapterName("é".repeat(124), it) }.resolved)
    assertEquals(ErrorCode.INVALID_ARGUMENT, call { module.setAdapterName("€".repeat(83), it) }.code)
    assertEquals(ErrorCode.INVALID_ARGUMENT, call { module.setAdapterName("a".repeat(249), it) }.code)
  }

  @Test
  fun `an empty name is INVALID_ARGUMENT`() {
    assertEquals(ErrorCode.INVALID_ARGUMENT, call { module.setAdapterName("", it) }.code)
  }

  @Test
  fun `setting the name while Bluetooth is off is BLUETOOTH_DISABLED`() {
    turnOffSilently()

    assertEquals(ErrorCode.BLUETOOTH_DISABLED, call { module.setAdapterName("Kiosk 12", it) }.code)
  }

  @Test
  fun `a missing permission is reported before the adapter being off`() {
    assumeTrue(sdkInt >= 31)
    deny(PermissionGate.CONNECT)
    turnOffSilently()

    assertEquals(ErrorCode.PERMISSION_DENIED, call { module.setAdapterName("Kiosk 12", it) }.code)
  }

  @Test
  fun `getAdapterState needs no permission`() {
    deny(PermissionGate.CONNECT)

    assertEquals("on", call { module.getAdapterState(it) }.value)
    assertNull(call { module.getAdapterState(it) }.code)
  }
}
