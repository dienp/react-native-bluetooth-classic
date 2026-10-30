import Foundation

/// An expected failure. Promises reject with its `code`, one of the
/// `ErrorCode` constants, and with whichever context fields are set.
struct CoreError: Error {
  let code: String
  let message: String
  var deviceId: String?
  var connectionId: String?
  var nativeCode: String?
  var nativeMessage: String?

  init(
    _ code: String,
    _ message: String,
    deviceId: String? = nil,
    connectionId: String? = nil,
    cause: Error? = nil
  ) {
    self.code = code
    self.message = message
    self.deviceId = deviceId
    self.connectionId = connectionId
    if let cause = cause {
      let native = ErrorMapper.nativeInfo(cause)
      nativeCode = native.code
      nativeMessage = native.message
    }
  }

  /// The fields JS reads into `BluetoothClassicError`.
  var userInfo: [String: Any] {
    var info: [String: Any] = [:]
    if let deviceId = deviceId { info["deviceId"] = deviceId }
    if let connectionId = connectionId { info["connectionId"] = connectionId }
    if let nativeCode = nativeCode { info["nativeCode"] = nativeCode }
    if let nativeMessage = nativeMessage { info["nativeMessage"] = nativeMessage }
    return info
  }

  static func unsupported(_ operation: String) -> CoreError {
    CoreError(ErrorCode.UNSUPPORTED_ON_PLATFORM, "\(operation)() is only available on Android")
  }

  static func notConnected(_ connectionId: String) -> CoreError {
    CoreError(
      ErrorCode.NOT_CONNECTED,
      "Connection \(connectionId) is not connected",
      connectionId: connectionId
    )
  }
}

/// Maps anything thrown inside the library to a `CoreError`.
enum ErrorMapper {
  static func map(_ error: Error) -> CoreError {
    if let error = error as? CoreError { return error }
    return CoreError(
      ErrorCode.UNKNOWN,
      "Unexpected failure: \(nativeInfo(error).message)",
      cause: error
    )
  }

  /// `nativeCode` is `<domain>:<code>` for an `NSError`, and the type name otherwise.
  static func nativeInfo(_ error: Error) -> (code: String, message: String) {
    if type(of: error) is NSError.Type {
      let nsError = error as NSError
      return ("\(nsError.domain):\(nsError.code)", nsError.localizedDescription)
    }
    return (String(describing: type(of: error)), String(describing: error))
  }
}
