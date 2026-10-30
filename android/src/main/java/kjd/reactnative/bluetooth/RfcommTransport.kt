package kjd.reactnative.bluetooth

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothServerSocket
import android.bluetooth.BluetoothSocket
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.lang.reflect.InvocationTargetException
import java.util.UUID

/** One RFCOMM link. Closing it from another thread unblocks [connect] and any read or write with an IOException. */
internal interface RfcommSocket : Closeable {
  val remoteAddress: String
  val input: InputStream
  val output: OutputStream

  /** Blocks until the link is up. */
  fun connect()
}

/** A listening RFCOMM socket. Closing it from another thread unblocks [accept]. */
internal interface RfcommServerSocket : Closeable {
  /** Blocks until a remote device connects. */
  fun accept(): RfcommSocket
}

/** Creates RFCOMM sockets. The OS implementation is [AndroidRfcommTransport]; tests use a fake. */
internal interface RfcommTransport {
  fun clientSocket(address: String, secure: Boolean, uuid: UUID): RfcommSocket

  /** A socket on a fixed RFCOMM channel, used only for the opt-in `fallbackChannel`. */
  fun channelSocket(address: String, secure: Boolean, channel: Int): RfcommSocket

  fun listen(serviceName: String, secure: Boolean, uuid: UUID): RfcommServerSocket

  companion object {
    /** The Serial Port Profile UUID. */
    val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
  }
}

/** RFCOMM sockets from the OS. Callers check the connect or server scope first. */
@SuppressLint("MissingPermission")
internal class AndroidRfcommTransport(private val adapterProvider: () -> BluetoothAdapter?) : RfcommTransport {
  override fun clientSocket(address: String, secure: Boolean, uuid: UUID): RfcommSocket {
    val device = adapter().getRemoteDevice(address)
    val socket =
      if (secure) device.createRfcommSocketToServiceRecord(uuid)
      else device.createInsecureRfcommSocketToServiceRecord(uuid)
    return OsSocket(socket)
  }

  override fun channelSocket(address: String, secure: Boolean, channel: Int): RfcommSocket {
    val device = adapter().getRemoteDevice(address)
    // Channel sockets have no public API on any release.
    val name = if (secure) "createRfcommSocket" else "createInsecureRfcommSocket"
    val socket =
      try {
        device.javaClass.getMethod(name, Int::class.javaPrimitiveType).invoke(device, channel) as BluetoothSocket
      } catch (e: InvocationTargetException) {
        throw IOException("Could not create a channel $channel socket: ${e.targetException.message}", e.targetException)
      } catch (e: ReflectiveOperationException) {
        throw IOException("This Android release does not allow RFCOMM channel sockets", e)
      }
    return OsSocket(socket)
  }

  override fun listen(serviceName: String, secure: Boolean, uuid: UUID): RfcommServerSocket {
    val adapter = adapter()
    val server =
      if (secure) adapter.listenUsingRfcommWithServiceRecord(serviceName, uuid)
      else adapter.listenUsingInsecureRfcommWithServiceRecord(serviceName, uuid)
    return OsServerSocket(server)
  }

  private fun adapter() = adapterProvider() ?: throw IOException("This device has no Bluetooth adapter")

  private class OsSocket(private val socket: BluetoothSocket) : RfcommSocket {
    override val remoteAddress: String
      get() = socket.remoteDevice.address

    override val input: InputStream
      get() = socket.inputStream

    override val output: OutputStream
      get() = socket.outputStream

    override fun connect() = socket.connect()

    override fun close() = socket.close()
  }

  private class OsServerSocket(private val server: BluetoothServerSocket) : RfcommServerSocket {
    override fun accept(): RfcommSocket = OsSocket(server.accept())

    override fun close() = server.close()
  }
}

/** Closes [closeable], ignoring failures: a socket that won't close is already unusable. */
internal fun closeQuietly(closeable: Closeable?) {
  try {
    closeable?.close()
  } catch (t: Throwable) {
    Logger.debug { "Close failed: ${t.message}" }
  }
}
