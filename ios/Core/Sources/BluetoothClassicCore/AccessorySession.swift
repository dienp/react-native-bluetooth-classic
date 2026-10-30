import Foundation

/// Why a connection ended, as its terminal state event reports it. Only `error` carries a code.
struct Terminal {
  let reason: String
  var code: String?
  var message: String?
  var cause: Error?

  static let local = Terminal(reason: "local")
  static let remote = Terminal(reason: "remote")

  static func error(_ code: String, _ message: String, _ cause: Error? = nil) -> Terminal {
    Terminal(reason: "error", code: code, message: message, cause: cause)
  }
}

/// The JS-facing events of connections.
protocol ConnectionEvents: AnyObject {
  /// `terminal` is set only for the transition to `disconnected`.
  func connectionStateChanged(_ connectionId: String, state: String, previousState: String, terminal: Terminal?)
  func connectionData(_ connectionId: String, bytes: Data, seq: Int)
}

/// One `EASession` and its streams. It opens once both streams report
/// `openCompleted`, then moves only forward (`connected`, `disconnecting`,
/// `disconnected`) and emits exactly one terminal event, after the last data.
/// All state is confined to the executor the streams are scheduled on.
final class AccessorySession: SessionStreamsDelegate {
  enum State: String {
    case opening
    case connected
    case disconnecting
    case disconnected
  }

  private final class Write {
    let data: Data
    let timeoutMs: Double
    let promise: Promise
    var offset = 0
    var timer: Cancellable?

    init(_ data: Data, _ timeoutMs: Double, _ promise: Promise) {
      self.data = data
      self.timeoutMs = timeoutMs
      self.promise = promise
    }
  }

  static let batchBytes = 16 * 1024
  static let batchDelay: TimeInterval = 0.016
  static let readBufferBytes = 4 * 1024
  static let writeChunkBytes = 8 * 1024

  let id: String
  let accessory: Accessory
  let protocolString: String
  /// One open connection per accessory and protocol.
  let key: String
  private(set) var state = State.opening
  private(set) var connectedAt: Double = 0

  private let streams: SessionStreams
  private let executor: Executor
  private weak var events: ConnectionEvents?
  private let now: () -> Double
  private let onEnded: (AccessorySession) -> Void
  private var openCompletion: ((Result<Void, Error>) -> Void)?
  private var inputOpen = false
  private var outputOpen = false

  private var pending = Data()
  private var flushTimer: Cancellable?
  private var seq = 0
  private var writes: [Write] = []
  private var disconnectWaiters: [Promise] = []
  private var disconnectTimer: Cancellable?

  init(
    id: String,
    accessory: Accessory,
    protocolString: String,
    streams: SessionStreams,
    executor: Executor,
    events: ConnectionEvents?,
    now: @escaping () -> Double,
    onEnded: @escaping (AccessorySession) -> Void
  ) {
    self.id = id
    self.accessory = accessory
    self.protocolString = protocolString
    key = AccessorySession.key(accessory, protocolString)
    self.streams = streams
    self.executor = executor
    self.events = events
    self.now = now
    self.onEnded = onEnded
  }

  static func key(_ accessory: Accessory, _ protocolString: String) -> String {
    "\(accessory.connectionID)|\(protocolString)"
  }

  var isOpen: Bool { state == .connected || state == .disconnecting }

  func toMap() -> [String: Any] {
    [
      "id": id,
      "state": state.rawValue,
      "connectedAt": connectedAt,
      "accessory": accessory.toMap(),
      "protocol": protocolString,
    ]
  }

  // MARK: Opening

  /// Opens both streams; `completion` runs once, when both are open or opening failed.
  func open(_ completion: @escaping (Result<Void, Error>) -> Void) {
    openCompletion = completion
    streams.delegate = self
    streams.open()
  }

  /// Abandons a pending open without reporting anything: its operation settled.
  func cancelOpen() {
    guard state == .opening else { return }
    state = .disconnected
    openCompletion = nil
    streams.close()
  }

  private func failOpen(_ error: Error) {
    guard state == .opening else { return }
    let completion = openCompletion
    cancelOpen()
    completion?(.failure(error))
  }

  // MARK: Stream events

  func streams(didReceive event: StreamEvent) {
    switch event {
    case .openCompleted(let side):
      guard state == .opening else { return }
      if side == .input { inputOpen = true } else { outputOpen = true }
      guard inputOpen && outputOpen else { return }
      state = .connected
      connectedAt = now()
      let completion = openCompletion
      openCompletion = nil
      completion?(.success(()))
      // Bytes that arrived while the output was still opening.
      scheduleFlush()
      drainWrites()
    case .hasBytesAvailable:
      readAvailable()
    case .hasSpaceAvailable:
      drainWrites()
    case .endEncountered:
      if state == .opening {
        failOpen(CoreError(ErrorCode.CONNECT_FAILED, "The accessory closed the session while it opened", deviceId: accessory.id))
      } else {
        end(.remote)
      }
    case .errorOccurred(_, let error):
      streamFailed(error)
    }
  }

  private func streamFailed(_ error: Error?) {
    if state == .opening {
      failOpen(CoreError(ErrorCode.CONNECT_FAILED, "The session's streams failed to open", deviceId: accessory.id, cause: error))
    } else if accessory.isConnected {
      end(.error(ErrorCode.CONNECTION_LOST, "The session's stream failed", error))
    } else {
      // The accessory went away; its disconnect notification may not have arrived yet.
      end(.remote)
    }
  }

  // MARK: Reading

  private func readAvailable() {
    guard state != .disconnected else { return }
    var buffer = [UInt8](repeating: 0, count: AccessorySession.readBufferBytes)
    while state != .disconnected && streams.hasBytesAvailable {
      let count = buffer.withUnsafeMutableBufferPointer { streams.read($0.baseAddress!, maxLength: $0.count) }
      if count < 0 {
        streamFailed(streams.streamError)
        return
      }
      if count == 0 { break }
      pending.append(buffer, count: count)
      if pending.count >= AccessorySession.batchBytes && isOpen { flush() }
    }
    scheduleFlush()
  }

  private func scheduleFlush() {
    guard isOpen, !pending.isEmpty, flushTimer == nil else { return }
    flushTimer = executor.schedule(after: AccessorySession.batchDelay) { [weak self] in self?.flush() }
  }

  private func flush() {
    flushTimer?.cancel()
    flushTimer = nil
    guard !pending.isEmpty else { return }
    let data = pending
    pending = Data()
    events?.connectionData(id, bytes: data, seq: seq)
    seq += 1
  }

  // MARK: Writing

  /// Queues `data` behind earlier writes; `timeoutMs` 0 means no timeout.
  func write(_ data: Data, timeoutMs: Double, promise: Promise) {
    guard state == .connected else {
      promise.reject(CoreError.notConnected(id))
      return
    }
    if data.isEmpty {
      promise.resolve()
      return
    }
    let write = Write(data, timeoutMs, promise)
    if timeoutMs > 0 {
      write.timer = executor.schedule(after: timeoutMs / 1000) { [weak self, weak write] in
        guard let self = self, let write = write else { return }
        self.writeTimedOut(write)
      }
    }
    writes.append(write)
    drainWrites()
  }

  /// Writes as much as the output stream accepts now; the rest waits for `hasSpaceAvailable`.
  private func drainWrites() {
    while isOpen, let write = writes.first, streams.hasSpaceAvailable {
      let length = min(write.data.count - write.offset, AccessorySession.writeChunkBytes)
      let written = write.data.withUnsafeBytes { raw -> Int in
        let base = raw.bindMemory(to: UInt8.self).baseAddress!
        return streams.write(base + write.offset, maxLength: length)
      }
      if written < 0 {
        writeFailed(write, streams.streamError)
        return
      }
      if written == 0 { break }
      write.offset += written
      if write.offset == write.data.count {
        writes.removeFirst()
        write.timer?.cancel()
        write.promise.resolve()
      }
    }
    if state == .disconnecting && writes.isEmpty { end(.local) }
  }

  private func writeFailed(_ write: Write, _ error: Error?) {
    writes.removeAll { $0 === write }
    write.timer?.cancel()
    end(.error(ErrorCode.WRITE_FAILED, "A write failed", error))
    write.promise.reject(CoreError(ErrorCode.WRITE_FAILED, "The write failed", connectionId: id, cause: error))
  }

  /// The stream position is unknown after a timeout, so the connection ends.
  private func writeTimedOut(_ write: Write) {
    guard writes.contains(where: { $0 === write }) else { return }
    writes.removeAll { $0 === write }
    write.promise.reject(
      CoreError(
        ErrorCode.WRITE_TIMEOUT,
        "The write did not complete within \(Int(write.timeoutMs)) ms",
        connectionId: id
      )
    )
    end(.error(ErrorCode.WRITE_TIMEOUT, "A write did not complete in time"))
  }

  // MARK: Ending

  /// Lets writes queued before this call finish, for up to `timeoutMs`, then
  /// closes the session. Concurrent calls share the result; once disconnected
  /// it resolves at once.
  func disconnect(timeoutMs: Double, promise: Promise) {
    switch state {
    case .opening, .disconnected:
      promise.resolve()
    case .disconnecting:
      disconnectWaiters.append(promise)
    case .connected:
      disconnectWaiters.append(promise)
      state = .disconnecting
      events?.connectionStateChanged(id, state: State.disconnecting.rawValue, previousState: State.connected.rawValue, terminal: nil)
      if writes.isEmpty || timeoutMs <= 0 {
        end(.local)
      } else {
        disconnectTimer = executor.schedule(after: timeoutMs / 1000) { [weak self] in self?.end(.local) }
      }
    }
  }

  /// Ends the connection with `'error'` and `code`, as JS asks after a buffer overflow.
  func closeWithError(code: String, message: String) {
    end(.error(code, message))
  }

  /// Ends the connection unless it already ended; returns whether this call ended it.
  @discardableResult
  func end(_ terminal: Terminal) -> Bool {
    guard isOpen else { return false }
    flush()
    let previous = state
    state = .disconnected
    events?.connectionStateChanged(id, state: State.disconnected.rawValue, previousState: previous.rawValue, terminal: terminal)
    Log.debug("Connection \(id) ended: \(terminal.reason) \(terminal.code ?? "")")
    disconnectTimer?.cancel()
    streams.close()
    let queued = writes
    writes = []
    for write in queued {
      write.timer?.cancel()
      write.promise.reject(CoreError.notConnected(id))
    }
    onEnded(self)
    let waiters = disconnectWaiters
    disconnectWaiters = []
    waiters.forEach { $0.resolve() }
    return true
  }

  /// Closes the session without emitting or settling anything: the JS runtime is going away.
  func shutdown() {
    if state == .opening {
      cancelOpen()
      return
    }
    guard isOpen else { return }
    state = .disconnected
    flushTimer?.cancel()
    disconnectTimer?.cancel()
    pending = Data()
    streams.close()
    writes.forEach {
      $0.timer?.cancel()
      $0.promise.abandon()
    }
    writes = []
    disconnectWaiters.forEach { $0.abandon() }
    disconnectWaiters = []
  }
}
