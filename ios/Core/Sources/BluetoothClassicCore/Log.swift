import Foundation
#if canImport(os)
  import os
#endif

/// The library's unified-logging output, category `RNBluetoothClassic`. The
/// level is set from JS with `setLogLevel` and defaults to `warn`. Payloads,
/// accessory names and serial numbers may only appear in `debug` messages,
/// which are not even built below `debug`.
enum Log {
  static let levels = ["debug", "info", "warn", "error", "silent"]
  static let defaultLevel = "warn"

  private static let lock = NSLock()
  private static var threshold = levels.firstIndex(of: defaultLevel)!

  #if canImport(os)
    private static let logger = Logger(subsystem: "dynlabs.react-native-bluetooth-classic", category: "RNBluetoothClassic")
  #endif

  static var level: String {
    lock.lock()
    defer { lock.unlock() }
    return levels[threshold]
  }

  /// Sets the level; an unknown name is ignored, because JS validates it first.
  static func setLevel(_ name: String) {
    guard let index = levels.firstIndex(of: name) else { return }
    lock.lock()
    threshold = index
    lock.unlock()
  }

  private static func enabled(_ index: Int) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return threshold <= index
  }

  static func debug(_ message: @autoclosure () -> String) {
    guard enabled(0) else { return }
    write(message(), level: 0)
  }

  static func info(_ message: @autoclosure () -> String) {
    guard enabled(1) else { return }
    write(message(), level: 1)
  }

  static func warn(_ message: @autoclosure () -> String) {
    guard enabled(2) else { return }
    write(message(), level: 2)
  }

  static func error(_ message: @autoclosure () -> String) {
    guard enabled(3) else { return }
    write(message(), level: 3)
  }

  private static func write(_ message: String, level: Int) {
    #if canImport(os)
      switch level {
      case 0: logger.debug("\(message, privacy: .public)")
      case 1: logger.info("\(message, privacy: .public)")
      case 2: logger.warning("\(message, privacy: .public)")
      default: logger.error("\(message, privacy: .public)")
      }
    #endif
  }
}
