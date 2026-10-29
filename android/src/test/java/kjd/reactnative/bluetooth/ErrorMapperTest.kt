package kjd.reactnative.bluetooth

import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ErrorMapperTest {
  @Test
  fun `library exceptions keep their code and context`() {
    val cause = IOException("read failed: socket closed")
    val rejection =
      ErrorMapper.map(
        BluetoothClassicException(
          ErrorCode.CONNECT_FAILED,
          "Could not connect",
          deviceId = "00:11:22:33:44:55",
          connectionId = "c1",
          cause = cause
        )
      )

    assertEquals(ErrorCode.CONNECT_FAILED, rejection.code)
    assertEquals("Could not connect", rejection.message)
    assertEquals("00:11:22:33:44:55", rejection.userInfo["deviceId"])
    assertEquals("c1", rejection.userInfo["connectionId"])
    assertEquals("java.io.IOException", rejection.userInfo["nativeCode"])
    assertEquals("read failed: socket closed", rejection.userInfo["nativeMessage"])
  }

  @Test
  fun `missing permissions are passed on`() {
    val rejection =
      ErrorMapper.map(
        BluetoothClassicException(ErrorCode.PERMISSION_DENIED, "Missing", missingPermissions = listOf("BLUETOOTH_SCAN"))
      )

    assertEquals(listOf("BLUETOOTH_SCAN"), rejection.userInfo["missingPermissions"])
    assertFalse(rejection.userInfo.containsKey("nativeCode"))
  }

  @Test
  fun `security exceptions become PERMISSION_DENIED naming the permission`() {
    val rejection =
      ErrorMapper.map(
        SecurityException("Need android.permission.BLUETOOTH_CONNECT permission for AttributionSource { uid = 10123 }")
      )

    assertEquals(ErrorCode.PERMISSION_DENIED, rejection.code)
    assertEquals(listOf("BLUETOOTH_CONNECT"), rejection.userInfo["missingPermissions"])
    assertEquals("java.lang.SecurityException", rejection.userInfo["nativeCode"])
  }

  @Test
  fun `security exceptions without a permission name have no missingPermissions`() {
    val rejection = ErrorMapper.map(SecurityException("denied"))

    assertEquals(ErrorCode.PERMISSION_DENIED, rejection.code)
    assertFalse(rejection.userInfo.containsKey("missingPermissions"))
  }

  @Test
  fun `illegal arguments become INVALID_ARGUMENT`() {
    val rejection = ErrorMapper.map(IllegalArgumentException("00:11 is not a valid Bluetooth address"))

    assertEquals(ErrorCode.INVALID_ARGUMENT, rejection.code)
    assertEquals("00:11 is not a valid Bluetooth address", rejection.message)
    assertEquals("java.lang.IllegalArgumentException", rejection.userInfo["nativeCode"])
  }

  @Test
  fun `anything else becomes UNKNOWN with the exception class and message`() {
    val rejection = ErrorMapper.map(IOException("Broken pipe"))

    assertEquals(ErrorCode.UNKNOWN, rejection.code)
    assertEquals("Unexpected failure: Broken pipe", rejection.message)
    assertEquals("java.io.IOException", rejection.userInfo["nativeCode"])
    assertEquals("Broken pipe", rejection.userInfo["nativeMessage"])
  }

  @Test
  fun `exceptions without a message still map`() {
    val rejection = ErrorMapper.map(IllegalStateException())

    assertEquals(ErrorCode.UNKNOWN, rejection.code)
    assertEquals("Unexpected failure: IllegalStateException", rejection.message)
    assertFalse(rejection.userInfo.containsKey("nativeMessage"))
  }

  @Test
  fun `errors are mapped too`() {
    val rejection = ErrorMapper.map(StackOverflowError())

    assertEquals(ErrorCode.UNKNOWN, rejection.code)
    assertEquals("java.lang.StackOverflowError", rejection.userInfo["nativeCode"])
  }
}
