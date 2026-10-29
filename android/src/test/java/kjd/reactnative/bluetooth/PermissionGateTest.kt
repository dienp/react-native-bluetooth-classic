package kjd.reactnative.bluetooth

import android.content.pm.PackageManager
import android.location.LocationManager
import kjd.reactnative.bluetooth.PermissionGate.Companion.COARSE_LOCATION
import kjd.reactnative.bluetooth.PermissionGate.Companion.CONNECT
import kjd.reactnative.bluetooth.PermissionGate.Companion.FINE_LOCATION
import kjd.reactnative.bluetooth.PermissionGate.Companion.SCAN
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** Runs every test on each API band boundary. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 28, 29, 30, 31, 33, 36])
class PermissionGateTest : ModuleTest() {
  private val scopes = listOf("discovery", "connect", "server")

  private fun expectedMissing(scope: String): List<String> =
    when {
      sdkInt >= 31 -> if (scope == "discovery") listOf(SCAN, CONNECT) else listOf(CONNECT)
      scope != "discovery" -> emptyList()
      sdkInt >= 29 -> listOf(FINE_LOCATION)
      else -> listOf(COARSE_LOCATION)
    }

  /** Grants every permission any scope can need on the running band. */
  private fun grantAll() = grant(SCAN, CONNECT, FINE_LOCATION)

  private fun check(scope: String) = call { module.checkPermissions(scope, it) }.map()

  private fun setLocationEnabled(enabled: Boolean) =
    shadowOf(app.getSystemService(LocationManager::class.java)).setLocationEnabled(enabled)

  private fun TestPermissionActivity.answer(grant: Boolean, rationale: Boolean = false) {
    val prompt = prompts.removeAt(0)
    val names = prompt.permissions.toTypedArray()
    if (grant) shadowOf(app).grantPermissions(*names)
    if (rationale) this.rationale += names
    val result = if (grant) PackageManager.PERMISSION_GRANTED else PackageManager.PERMISSION_DENIED
    prompt.listener!!.onRequestPermissionsResult(prompt.requestCode, names, IntArray(names.size) { result })
    idle()
  }

  // ---- Mapping and checks ----

  @Test
  fun `each scope needs the permissions of the running API band`() {
    for (scope in scopes) {
      val status = check(scope)
      assertEquals(scope, expectedMissing(scope), status.getArray("missing")!!.toArrayList())
      assertEquals(scope, expectedMissing(scope).isEmpty(), status.getBoolean("granted"))
    }
  }

  @Test
  fun `granted permissions satisfy every scope`() {
    grantAll()

    for (scope in scopes) {
      val status = check(scope)
      assertTrue(scope, status.getBoolean("granted"))
      assertEquals(scope, 0, status.getArray("missing")!!.size())
    }
  }

  @Test
  fun `on API 24 to 28 either location permission satisfies discovery`() {
    assumeTrue(sdkInt <= 28)
    grant(FINE_LOCATION)

    assertTrue(check("discovery").getBoolean("granted"))
  }

  @Test
  fun `on API 29 and 30 coarse location is not enough for discovery`() {
    assumeTrue(sdkInt in 29..30)
    grant(COARSE_LOCATION)

    assertEquals(listOf(FINE_LOCATION), check("discovery").getArray("missing")!!.toArrayList())
  }

  @Test
  fun `checking never prompts`() {
    val activity = foregroundActivity().get()

    scopes.forEach(::check)

    assertTrue(activity.prompts.isEmpty())
  }

  @Test
  fun `Location Services is reported for discovery on API 24 to 30 only`() {
    grantAll()
    setLocationEnabled(false)

    val discovery = check("discovery")
    if (sdkInt <= 30) {
      // Granted, yet discovery would find nothing.
      assertTrue(discovery.getBoolean("granted"))
      assertFalse(discovery.getBoolean("locationServicesEnabled"))
    } else {
      assertFalse(discovery.hasKey("locationServicesEnabled"))
    }
    assertFalse(check("connect").hasKey("locationServicesEnabled"))

    setLocationEnabled(true)
    if (sdkInt <= 30) assertTrue(check("discovery").getBoolean("locationServicesEnabled"))
  }

  @Test
  fun `discovery requires Location Services on API 24 to 30 only`() {
    setLocationEnabled(false)

    val error = runCatching { module.permissions.requireLocationServices(PermissionScope.DISCOVERY) }.exceptionOrNull()

    if (sdkInt <= 30) {
      assertEquals(ErrorCode.LOCATION_SERVICES_DISABLED, (error as BluetoothClassicException).code)
    } else {
      assertNull(error)
    }
    assertNull(runCatching { module.permissions.requireLocationServices(PermissionScope.CONNECT) }.exceptionOrNull())
  }

  @Test
  fun `operations reject with PERMISSION_DENIED naming what is missing`() {
    val error = runCatching { module.permissions.require(PermissionScope.DISCOVERY) }.exceptionOrNull()

    assertEquals(ErrorCode.PERMISSION_DENIED, (error as BluetoothClassicException).code)
    assertEquals(expectedMissing("discovery"), error.missingPermissions)

    val promise = call { module.setAdapterName("Kiosk 12", it) }
    if (sdkInt >= 31) {
      assertEquals(ErrorCode.PERMISSION_DENIED, promise.code)
      assertEquals(listOf(CONNECT), promise.missingPermissions())
    } else {
      assertTrue("no runtime permission guards the connect scope", promise.resolved)
    }
  }

  // ---- Requests ----

  @Test
  fun `the user grants every prompt`() {
    val activity = foregroundActivity().get()

    val promise = call { module.requestPermissions("discovery", it) }
    assertEquals(expectedMissing("discovery").map { "android.permission.$it" }, activity.prompts.single().permissions)
    activity.answer(grant = true)

    assertTrue(promise.map().getBoolean("granted"))
    assertEquals(0, promise.map().getArray("missing")!!.size())
    assertTrue(promise.map().getBoolean("canAskAgain"))
  }

  @Test
  fun `only missing permissions are requested`() {
    assumeTrue(sdkInt >= 31)
    grant(CONNECT)
    val activity = foregroundActivity().get()

    call { module.requestPermissions("discovery", it) }

    assertEquals(listOf("android.permission.$SCAN"), activity.prompts.single().permissions)
  }

  @Test
  fun `already granted resolves without a prompt`() {
    grantAll()
    val activity = foregroundActivity().get()

    for (scope in scopes) {
      val promise = call { module.requestPermissions(scope, it) }
      assertTrue(promise.map().getBoolean("granted"))
      assertTrue(promise.map().getBoolean("canAskAgain"))
    }
    assertTrue(activity.prompts.isEmpty())
  }

  @Test
  fun `a denial the OS will ask about again leaves canAskAgain true`() {
    val activity = foregroundActivity().get()

    val promise = call { module.requestPermissions("discovery", it) }
    activity.answer(grant = false, rationale = true)

    assertFalse(promise.map().getBoolean("granted"))
    assertEquals(expectedMissing("discovery"), promise.map().getArray("missing")!!.toArrayList())
    assertTrue(promise.map().getBoolean("canAskAgain"))
  }

  @Test
  fun `a permanent denial reports canAskAgain false`() {
    val activity = foregroundActivity().get()

    // "Don't ask again": the OS denies and stops asking for a rationale.
    val first = call { module.requestPermissions("discovery", it) }
    activity.answer(grant = false, rationale = false)
    assertFalse(first.map().getBoolean("canAskAgain"))

    // From now on the OS answers without showing anything.
    val second = call { module.requestPermissions("discovery", it) }
    activity.answer(grant = false, rationale = false)
    assertFalse(second.map().getBoolean("granted"))
    assertEquals(expectedMissing("discovery"), second.map().getArray("missing")!!.toArrayList())
    assertFalse(second.map().getBoolean("canAskAgain"))
  }

  @Test
  fun `an interrupted prompt does not count as asked`() {
    val activity = foregroundActivity().get()

    val promise = call { module.requestPermissions("discovery", it) }
    val prompt = activity.prompts.removeAt(0)
    // The OS reports an interrupted request with empty arrays.
    prompt.listener!!.onRequestPermissionsResult(prompt.requestCode, emptyArray(), IntArray(0))
    idle()

    assertFalse(promise.map().getBoolean("granted"))
    assertTrue(promise.map().getBoolean("canAskAgain"))
  }

  @Test
  fun `requesting without a foreground activity is ACTIVITY_UNAVAILABLE`() {
    val promise = call { module.requestPermissions("discovery", it) }

    assertEquals(ErrorCode.ACTIVITY_UNAVAILABLE, promise.code)
  }

  @Test
  fun `concurrent requests are prompted one at a time`() {
    val activity = foregroundActivity().get()

    val first = call { module.requestPermissions("discovery", it) }
    val second = call { module.requestPermissions("discovery", it) }
    assertEquals(1, activity.prompts.size)

    activity.answer(grant = true)

    assertTrue(first.map().getBoolean("granted"))
    assertTrue("the second needs no prompt once the first was granted", second.map().getBoolean("granted"))
    assertTrue(activity.prompts.isEmpty())
  }

  @Test
  fun `a result the activity never delivers settles when the activity resumes`() {
    val controller = foregroundActivity()
    val activity = controller.get()

    val promise = call { module.requestPermissions("discovery", it) }
    assertEquals(1, activity.prompts.size)
    reactContext.onHostPause()
    reactContext.onHostResume(activity)
    idle()

    assertTrue(promise.isSettled)
    assertFalse(promise.map().getBoolean("granted"))
  }
}
