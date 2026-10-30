package kjd.reactnative.bluetooth

import java.io.IOException
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
internal class AcceptTest : ConnectionTest() {
  @Test
  fun `an incoming connection resolves, and the listening socket is closed`() {
    val promise = accept()
    val server = transport.awaitServer()

    val remote = server.connectFrom("00:11:22:aa:bb:cc")

    val connection = promise.await().map()
    assertEquals("connected", connection.getString("state"))
    assertEquals(address, connection.device().getString("address"))
    assertTrue(server.closed)
    assertFalse(remote.closed)
    assertEquals(listOf(connection.getString("id")), openIds())
  }

  @Test
  fun `the service name, uuid and transport reach the listening socket`() {
    val uuid = UUID.fromString("0000FFE0-0000-1000-8000-00805F9B34FB")

    accept(AcceptOptions(secure = false, uuid = uuid, serviceName = "Kiosk"))

    val server = transport.awaitServer()
    assertEquals("Kiosk", server.serviceName)
    assertEquals(uuid, server.uuid)
    assertFalse(server.secure)
  }

  @Test
  fun `no device within the timeout is ACCEPT_TIMEOUT and closes the listening socket`() {
    val promise = accept(AcceptOptions(timeoutMs = 30_000))
    val server = transport.awaitServer()

    scheduler.advance(30_000)

    assertEquals(ErrorCode.ACCEPT_TIMEOUT, promise.await().code)
    server.awaitClosed()
  }

  @Test
  fun `a second accept while one is pending is ACCEPT_ALREADY_RUNNING`() {
    val first = accept()
    transport.awaitServer()

    assertEquals(ErrorCode.ACCEPT_ALREADY_RUNNING, accept().await().code)
    assertFalse(first.isSettled)
  }

  @Test
  fun `cancelAccept rejects the pending accept, closes the socket, and a later accept works`() {
    val first = accept()
    val firstServer = transport.awaitServer()

    manager.cancelAccept()

    assertEquals(ErrorCode.ACCEPT_CANCELLED, first.await().code)
    firstServer.awaitClosed()
    val second = accept()
    transport.awaitServer(1).connectFrom(address)
    assertTrue(second.await().resolved)
  }

  @Test
  fun `cancelAccept with nothing pending does nothing`() {
    manager.cancelAccept()

    assertTrue(transport.servers.isEmpty())
  }

  @Test
  fun `an aborted signal is ACCEPT_CANCELLED`() {
    val promise = accept(operationId = "op-accept")
    val server = transport.awaitServer()

    manager.cancelOperation("op-accept")

    assertEquals(ErrorCode.ACCEPT_CANCELLED, promise.await().code)
    server.awaitClosed()
  }

  @Test
  fun `a failure to listen is ACCEPT_FAILED`() {
    transport.listenFailure = IOException("Error: -1")

    val promise = accept().await()

    assertEquals(ErrorCode.ACCEPT_FAILED, promise.code)
    assertEquals("Error: -1", promise.nativeMessage())
    // The failed accept no longer blocks the next one.
    transport.listenFailure = null
    accept()
    transport.awaitServer()
  }

  @Test
  fun `a failing accept is ACCEPT_FAILED and closes the listening socket`() {
    val promise = accept()
    val server = transport.awaitServer()

    server.fail(IOException("accept failed"))

    assertEquals(ErrorCode.ACCEPT_FAILED, promise.await().code)
    server.awaitClosed()
  }

  @Test
  fun `an incoming link from a device that is already connected is refused`() {
    val (existing, _) = connected()
    val promise = accept()

    val remote = transport.awaitServer().connectFrom(address)

    assertEquals(ErrorCode.ALREADY_CONNECTED, promise.await().code)
    assertEquals(existing, promise.userInfo?.getString("connectionId"))
    remote.awaitClosed()
    assertEquals(listOf(existing), openIds())
  }
}
