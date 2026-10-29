package kjd.reactnative.bluetooth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35, 36])
class CapabilitiesTest : ModuleTest() {
  @Test
  fun `reports the platform, the API level and the flags implemented so far`() {
    val capabilities = module.capabilitiesForTest()

    assertEquals("android", capabilities.getString("platform"))
    assertEquals(sdkInt.toString(), capabilities.getString("osVersion"))
    assertTrue(capabilities.getBoolean("adapterState"))
    assertTrue(capabilities.getBoolean("requestEnable"))
    assertFalse(capabilities.getBoolean("accessoryPicker"))
    assertEquals(0, capabilities.getArray("declaredProtocols")!!.size())
    assertTrue(capabilities.getBoolean("discovery"))
    assertTrue(capabilities.getBoolean("pairing"))
    // The server has not landed on Android yet.
    assertFalse(capabilities.getBoolean("server"))
    assertEquals(sdkInt >= 36, capabilities.getBoolean("bondLossEvents"))
  }

  @Test
  fun `bond-loss events are reported only on API 36 and later once pairing lands`() {
    val capabilities = Capabilities.android(sdkInt, landed = Feature.entries.toSet())

    assertEquals(sdkInt >= 36, capabilities["bondLossEvents"])
    assertEquals(true, capabilities["discovery"])
    assertEquals(true, capabilities["pairing"])
    assertEquals(true, capabilities["server"])
  }

  private fun BluetoothClassicModule.capabilitiesForTest() = getCapabilities()
}
