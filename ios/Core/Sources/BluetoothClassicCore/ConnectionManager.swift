import Foundation

/// Owns every accessory session and every pending connect. Public methods may
/// be called from any thread; all state lives on the executor.
final class ConnectionManager {
  private final class Operation {
    let promise: Promise
    let session: AccessorySession
    var timer: Cancellable?

    init(_ promise: Promise, _ session: AccessorySession) {
      self.promise = promise
      self.session = session
    }
  }

  private let executor: Executor
  private let registry: AccessoryRegistry
  private let transport: AccessoryTransport
  private weak var events: ConnectionEvents?
  private let now: () -> Double
  private var nextId = 1
  private var sessions: [String: AccessorySession] = [:]
  private var operations: [String: Operation] = [:]
  private var shutDown = false

  init(
    executor: Executor,
    registry: AccessoryRegistry,
    transport: AccessoryTransport,
    events: ConnectionEvents?,
    now: @escaping () -> Double
  ) {
    self.executor = executor
    self.registry = registry
    self.transport = transport
    self.events = events
    self.now = now
  }

  /// Runs `block` on the executor, unless the manager was shut down.
  private func onExecutor(_ promise: Promise?, _ block: @escaping (ConnectionManager) throws -> Void) {
    executor.async { [weak self] in
      guard let self = self, !self.shutDown else {
        promise?.abandon()
        return
      }
      if let promise = promise {
        guarded(promise) { try block(self) }
      } else {
        try? block(self)
      }
    }
  }

  // MARK: Connect

  func connect(operationId: String, deviceId: String, protocolString: String?, timeoutMs: Double, promise: Promise) {
    onExecutor(promise) {
      try $0.startConnect(operationId, deviceId, protocolString, timeoutMs, promise)
    }
  }

  private func startConnect(
    _ operationId: String,
    _ deviceId: String,
    _ requested: String?,
    _ timeoutMs: Double,
    _ promise: Promise
  ) throws {
    guard let accessory = registry.accessory(id: deviceId) else {
      throw CoreError(
        ErrorCode.ACCESSORY_NOT_CONNECTED,
        "No accessory with id \(deviceId) is connected; ids change when an accessory reconnects",
        deviceId: deviceId
      )
    }
    let protocolString = try chooseProtocol(requested, for: accessory)
    let key = AccessorySession.key(accessory, protocolString)
    if let existing = sessions.values.first(where: { $0.key == key && $0.isOpen }) {
      throw CoreError(
        ErrorCode.ALREADY_CONNECTED,
        "Already connected to this accessory with \(protocolString)",
        deviceId: deviceId,
        connectionId: existing.id
      )
    }
    if operations.values.contains(where: { $0.session.key == key }) {
      throw CoreError(
        ErrorCode.ALREADY_CONNECTING,
        "A session with this accessory and protocol is already opening",
        deviceId: deviceId
      )
    }
    guard let streams = transport.openSession(accessory, protocolString: protocolString) else {
      throw CoreError(
        ErrorCode.SESSION_OPEN_FAILED,
        "The OS did not open a session for \(protocolString)",
        deviceId: deviceId
      )
    }
    let session = AccessorySession(
      id: "conn-\(nextId)",
      accessory: accessory,
      protocolString: protocolString,
      streams: streams,
      executor: executor,
      events: events,
      now: now,
      onEnded: { [weak self] in self?.removed($0) }
    )
    nextId += 1
    let operation = Operation(promise, session)
    operations[operationId] = operation
    if timeoutMs > 0 {
      operation.timer = executor.schedule(after: timeoutMs / 1000) { [weak self] in
        self?.abort(
          operationId,
          CoreError(
            ErrorCode.CONNECT_TIMEOUT,
            "The session did not open within \(Int(timeoutMs)) ms",
            deviceId: deviceId
          )
        )
      }
    }
    session.open { [weak self, weak operation] result in
      guard let self = self, let operation = operation, self.operations[operationId] === operation else { return }
      self.operations[operationId] = nil
      operation.timer?.cancel()
      switch result {
      case .success:
        self.sessions[session.id] = session
        Log.debug("Connection \(session.id) opened with \(protocolString)")
        operation.promise.resolve(session.toMap())
      case .failure(let error):
        operation.promise.reject(error)
      }
    }
  }

  /// The requested protocol after checking it, or the first declared protocol the accessory supports.
  private func chooseProtocol(_ requested: String?, for accessory: Accessory) throws -> String {
    let declared = registry.declaredProtocols
    if let requested = requested {
      guard declared.contains(requested) else {
        throw CoreError(
          ErrorCode.PROTOCOL_NOT_DECLARED,
          "\(requested) is not declared in \(Capabilities.protocolsKey)",
          deviceId: accessory.id
        )
      }
      guard accessory.protocolStrings.contains(requested) else {
        throw CoreError(
          ErrorCode.PROTOCOL_NOT_SUPPORTED,
          "The accessory does not support \(requested)",
          deviceId: accessory.id
        )
      }
      return requested
    }
    guard !declared.isEmpty else {
      throw CoreError(
        ErrorCode.PROTOCOL_NOT_DECLARED,
        "Info.plist declares no \(Capabilities.protocolsKey)",
        deviceId: accessory.id
      )
    }
    guard let supported = declared.first(where: accessory.protocolStrings.contains) else {
      throw CoreError(
        ErrorCode.PROTOCOL_NOT_SUPPORTED,
        "The accessory supports none of the declared protocols",
        deviceId: accessory.id
      )
    }
    return supported
  }

  private func abort(_ operationId: String, _ error: Error) {
    guard let operation = operations.removeValue(forKey: operationId) else { return }
    operation.timer?.cancel()
    operation.session.cancelOpen()
    operation.promise.reject(error)
  }

  /// Cancels a pending connect; an unknown or settled id is ignored.
  func cancelOperation(_ operationId: String, promise: Promise) {
    onExecutor(promise) {
      $0.abort(operationId, CoreError(ErrorCode.CONNECT_CANCELLED, "The operation was cancelled"))
      promise.resolve()
    }
  }

  private func removed(_ session: AccessorySession) {
    // Only this session's own entry, never a newer one.
    if sessions[session.id] === session { sessions[session.id] = nil }
  }

  // MARK: Connections

  func list(promise: Promise) {
    onExecutor(promise) {
      promise.resolve(
        $0.sessions.values.filter(\.isOpen).sorted { $0.connectedAt < $1.connectedAt }.map { $0.toMap() }
      )
    }
  }

  func write(connectionId: String, data: Data, timeoutMs: Double, promise: Promise) {
    onExecutor(promise) {
      guard let session = $0.sessions[connectionId] else { throw CoreError.notConnected(connectionId) }
      session.write(data, timeoutMs: timeoutMs, promise: promise)
    }
  }

  func disconnect(connectionId: String, timeoutMs: Double, promise: Promise) {
    onExecutor(promise) {
      guard let session = $0.sessions[connectionId] else {
        promise.resolve()
        return
      }
      session.disconnect(timeoutMs: timeoutMs, promise: promise)
    }
  }

  func closeWithError(connectionId: String, code: String, message: String, promise: Promise) {
    onExecutor(promise) {
      $0.sessions[connectionId]?.closeWithError(code: code, message: message)
      promise.resolve()
    }
  }

  // MARK: Accessory changes

  /// The accessory left the OS: its sessions end as `'remote'`, and pending connects fail.
  func accessoryDisconnected(_ accessory: Accessory) {
    let connectionID = accessory.connectionID
    onExecutor(nil) { manager in
      for session in manager.sessions.values where session.accessory.connectionID == connectionID {
        session.end(.remote)
      }
      for (operationId, operation) in manager.operations where operation.session.accessory.connectionID == connectionID {
        manager.abort(
          operationId,
          CoreError(ErrorCode.ACCESSORY_NOT_CONNECTED, "The accessory disconnected", deviceId: accessory.id)
        )
      }
    }
  }

  /// After a suspension, ends the sessions whose accessory left while no notification could arrive.
  func reconcile() {
    onExecutor(nil) { manager in
      for session in manager.sessions.values where manager.registry.accessory(id: session.accessory.id) == nil {
        session.end(.remote)
      }
    }
  }

  /// Closes every session without settling or emitting anything: the JS runtime is going away.
  func shutdown() {
    executor.async { [weak self] in
      guard let self = self, !self.shutDown else { return }
      self.shutDown = true
      for operation in self.operations.values {
        operation.timer?.cancel()
        operation.session.cancelOpen()
        operation.promise.abandon()
      }
      self.operations = [:]
      for session in self.sessions.values { session.shutdown() }
      self.sessions = [:]
    }
  }
}
