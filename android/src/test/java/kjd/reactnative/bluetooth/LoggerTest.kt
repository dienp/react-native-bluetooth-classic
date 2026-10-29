package kjd.reactnative.bluetooth

import android.bluetooth.BluetoothAdapter
import android.util.Log
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class LoggerTest : ModuleTest() {
  private val address = "00:11:22:33:44:55"
  private val payload = "SECRET-PAYLOAD"

  private val logs
    get() = ShadowLog.getLogsForTag(Logger.TAG)

  @Before
  fun clearLogs() = ShadowLog.clear()

  /** Exercises the paths that log: a state change, a rejection and a warning about a device. */
  private fun produceLogs() {
    transition(BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_ON)
    call { module.setAdapterName("Kiosk 12", it) }
    Logger.debug { "Received $payload from $address" }
    Logger.warn("Write to ${Logger.redact(address)} failed")
  }

  @Test
  fun `the default level is warn`() {
    assertEquals("warn", Logger.level)
  }

  @Test
  fun `no payload, name or address is logged at the default level`() {
    var built = false
    Logger.debug {
      built = true
      payload
    }
    produceLogs()

    assertFalse("debug messages are not even built", built)
    assertTrue(logs.none { it.type < Log.WARN })
    assertTrue(logs.none { address in it.msg || payload in it.msg })
    assertTrue(logs.any { it.msg == "Write to <redacted> failed" })
  }

  @Test
  fun `debug logging includes details`() {
    module.setLogLevel("debug")
    produceLogs()

    assertTrue(logs.any { it.type == Log.DEBUG && it.msg.contains("Adapter state on -> turningOff") })
    assertTrue(logs.any { it.msg.contains(payload) && it.msg.contains(address) })
    assertTrue(logs.any { it.msg == "Write to $address failed" })
  }

  @Test
  fun `silent turns everything off`() {
    module.setLogLevel("silent")
    produceLogs()
    Logger.error("boom")

    assertTrue(logs.isEmpty())
  }

  @Test
  fun `an unknown level is ignored`() {
    module.setLogLevel("verbose")

    assertEquals("warn", Logger.level)
  }
}
