import Foundation

/// What the module needs from the OS. The app passes ExternalAccessory and
/// UIKit implementations; tests pass fakes.
struct ModuleEnvironment {
  var osVersion: String
  var declaredProtocols: [String]
  var accessoryManager: AccessoryManaging
  var transport: AccessoryTransport
  var executor: Executor
  /// Runs UI and accessory-manager work on the main thread.
  var onMain: (@escaping () -> Void) -> Void
  /// Opens the app's page in Settings; the completion reports whether it opened.
  var openSettings: (@escaping (Bool) -> Void) -> Void
  /// Epoch milliseconds.
  var now: () -> Double = { Date().timeIntervalSince1970 * 1000 }
}

/// The iOS module behind the Objective-C++ shim, without any Objective-C
/// types, so XCTest can drive it with fakes. Every promise settles exactly
/// once; after `invalidate()` nothing is settled or emitted.
final class ModuleCore: ConnectionEvents {
  typealias Emit = (_ event: String, _ body: [String: Any]) -> Void

  private let environment: ModuleEnvironment
  private let emitter: Emit
  let registry: AccessoryRegistry
  private var connections: ConnectionManager!
  private let lock = NSLock()
  private var invalidated = false

  init(environment: ModuleEnvironment, emit: @escaping Emit) {
    self.environment = environment
    emitter = emit
    registry = AccessoryRegistry(
      manager: environment.accessoryManager,
      declaredProtocols: environment.declaredProtocols
    )
    connections = ConnectionManager(
      executor: environment.executor,
      registry: registry,
      transport: environment.transport,
      events: self,
      now: environment.now
    )
  }

  private var isInvalidated: Bool {
    lock.lock()
    defer { lock.unlock() }
    return invalidated
  }

  private func emit(_ event: String, _ body: [String: Any]) {
    guard !isInvalidated else { return }
    emitter(event, body)
  }

  /// Starts following accessory connections. Call once, after init.
  func start() {
    guard !isInvalidated else { return }
    registry.start(
      connected: { [weak self] accessory, relevant in
        guard let self = self, relevant else { return }
        Log.debug("Accessory \(accessory.id) connected")
        self.emit("onAccessoryConnected", ["accessory": accessory.toMap(), "timestamp": self.environment.now()])
      },
      disconnected: { [weak self] accessory, relevant in
        guard let self = self else { return }
        self.connections.accessoryDisconnected(accessory)
        if relevant {
          self.emit("onAccessoryDisconnected", ["accessory": accessory.toMap(), "timestamp": self.environment.now()])
        }
      }
    )
  }

  /// Runs when the JS runtime is reloaded or destroyed: nothing may survive into the next one.
  func invalidate() {
    lock.lock()
    let already = invalidated
    invalidated = true
    lock.unlock()
    guard !already else { return }
    registry.stop()
    connections.shutdown()
    // The level is process-wide; the next runtime starts at the default, like JS.
    Log.setLevel(Log.defaultLevel)
  }

  /// The app became active again: report sessions the OS closed while it was suspended.
  func appDidBecomeActive() {
    guard !isInvalidated else { return }
    connections.reconcile()
  }

  // MARK: Entry points

  /// Wraps an entry point: settles once, never throws, and drops the call after invalidation.
  private func entry(_ promise: Promise, _ block: (Promise) throws -> Void) {
    guard !isInvalidated else {
      promise.abandon()
      return
    }
    guarded(promise) { try block(promise) }
  }

  private func onMain(_ promise: Promise, _ block: @escaping (Promise) throws -> Void) {
    environment.onMain { [weak self] in
      guard let self = self else {
        promise.abandon()
        return
      }
      self.entry(promise, block)
    }
  }

  func capabilities() -> [String: Any] {
    Capabilities.ios(osVersion: environment.osVersion, declaredProtocols: environment.declaredProtocols)
  }

  func setLogLevel(_ level: String) {
    Log.setLevel(level)
  }

  /// For the Android-only entry points.
  func unsupported(_ operation: String, _ promise: Promise) {
    entry(promise) { _ in throw CoreError.unsupported(operation) }
  }

  func checkPermissions(_ scope: String, _ promise: Promise) {
    entry(promise) { promise in
      switch scope {
      case "connect": promise.resolve(["granted": true, "missing": [String]()])
      case "discovery", "server":
        throw CoreError(ErrorCode.UNSUPPORTED_ON_PLATFORM, "The '\(scope)' scope does not exist on iOS")
      default: throw CoreError(ErrorCode.INVALID_ARGUMENT, "Unknown permission scope: \(scope)")
      }
    }
  }

  func getConnectedAccessories(_ promise: Promise) {
    onMain(promise) { [registry] promise in
      promise.resolve(registry.connectedAccessories().map { $0.toMap() })
    }
  }

  func showAccessoryPicker(nameFilter: String?, _ promise: Promise) {
    onMain(promise) { [environment] promise in
      environment.accessoryManager.showPicker(nameFilter: nameFilter) { outcome in
        switch outcome {
        case .selected, .alreadyConnected:
          promise.resolve()
        case .cancelled:
          promise.reject(CoreError(ErrorCode.USER_REJECTED, "The user dismissed the accessory picker"))
        case .notFound:
          promise.reject(CoreError(ErrorCode.DEVICE_NOT_FOUND, "The picker found no matching accessory"))
        case .failed(let error):
          promise.reject(CoreError(ErrorCode.UNKNOWN, "The accessory picker failed", cause: error))
        }
      }
    }
  }

  func openSettings(_ promise: Promise) {
    onMain(promise) { [environment] promise in
      environment.openSettings { opened in
        if opened {
          promise.resolve()
        } else {
          promise.reject(CoreError(ErrorCode.UNKNOWN, "The OS did not open the app's settings"))
        }
      }
    }
  }

  func connect(operationId: String, deviceId: String, protocolString: String?, timeoutMs: Double, _ promise: Promise) {
    entry(promise) { promise in
      connections.connect(
        operationId: operationId,
        deviceId: deviceId,
        protocolString: protocolString,
        timeoutMs: timeoutMs,
        promise: promise
      )
    }
  }

  func cancelOperation(_ operationId: String, _ promise: Promise) {
    entry(promise) { connections.cancelOperation(operationId, promise: $0) }
  }

  func getConnections(_ promise: Promise) {
    entry(promise) { connections.list(promise: $0) }
  }

  func write(connectionId: String, base64: String, timeoutMs: Double, _ promise: Promise) {
    entry(promise) { promise in
      guard let data = Data(base64Encoded: base64) else {
        throw CoreError(ErrorCode.INVALID_ARGUMENT, "data must be base64")
      }
      Log.debug("write \(data.count) bytes to \(connectionId)")
      connections.write(connectionId: connectionId, data: data, timeoutMs: timeoutMs, promise: promise)
    }
  }

  func disconnect(connectionId: String, timeoutMs: Double, _ promise: Promise) {
    entry(promise) { connections.disconnect(connectionId: connectionId, timeoutMs: timeoutMs, promise: $0) }
  }

  func closeWithError(connectionId: String, code: String, message: String, _ promise: Promise) {
    entry(promise) { connections.closeWithError(connectionId: connectionId, code: code, message: message, promise: $0) }
  }

  // MARK: ConnectionEvents

  func connectionStateChanged(_ connectionId: String, state: String, previousState: String, terminal: Terminal?) {
    emit("onConnectionStateChange", ModuleCore.stateEvent(connectionId, state, previousState, terminal, environment.now()))
  }

  func connectionData(_ connectionId: String, bytes: Data, seq: Int) {
    Log.debug("read \(bytes.count) bytes from \(connectionId) (seq \(seq))")
    emit("onData", ["connectionId": connectionId, "data": bytes.base64EncodedString(), "seq": seq])
  }

  static func stateEvent(
    _ connectionId: String,
    _ state: String,
    _ previousState: String,
    _ terminal: Terminal?,
    _ timestamp: Double
  ) -> [String: Any] {
    var event: [String: Any] = [
      "connectionId": connectionId,
      "state": state,
      "previousState": previousState,
      "timestamp": timestamp,
    ]
    if let terminal = terminal {
      event["reason"] = terminal.reason
      if let code = terminal.code { event["errorCode"] = code }
      if let message = terminal.message { event["errorMessage"] = message }
      if let cause = terminal.cause {
        let native = ErrorMapper.nativeInfo(cause)
        event["nativeCode"] = native.code
        event["nativeMessage"] = native.message
      }
    }
    return event
  }
}
