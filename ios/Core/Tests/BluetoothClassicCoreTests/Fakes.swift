import Foundation
@testable import BluetoothClassicCore

/// A single-threaded executor the test drives: `drain()` runs queued blocks,
/// `advance(_:)` moves the clock and fires due timers.
final class ManualExecutor: Executor {
  private final class Timer: Cancellable {
    let at: TimeInterval
    let block: () -> Void
    var cancelled = false
    init(at: TimeInterval, block: @escaping () -> Void) {
      self.at = at
      self.block = block
    }
    func cancel() { cancelled = true }
  }

  private var queue: [() -> Void] = []
  private var timers: [Timer] = []
  private(set) var now: TimeInterval = 0

  func async(_ block: @escaping () -> Void) {
    queue.append(block)
  }

  func schedule(after seconds: TimeInterval, _ block: @escaping () -> Void) -> Cancellable {
    let timer = Timer(at: now + seconds, block: block)
    timers.append(timer)
    return timer
  }

  var pendingTimers: Int { timers.filter { !$0.cancelled }.count }

  func drain() {
    while !queue.isEmpty {
      queue.removeFirst()()
    }
  }

  func advance(_ seconds: TimeInterval) {
    drain()
    let target = now + seconds
    while let next = timers.filter({ !$0.cancelled && $0.at <= target + 1e-9 }).min(by: { $0.at < $1.at }) {
      timers.removeAll { $0 === next }
      now = next.at
      next.block()
      drain()
    }
    timers.removeAll { $0.cancelled }
    now = target
  }
}

final class FakeAccessory: Accessory {
  let connectionID: Int
  let name: String
  let protocolStrings: [String]
  var isConnected = true
  let manufacturer = "Acme"
  let modelNumber = "M-1"
  let serialNumber = "SN-42"
  let firmwareRevision = "1.0.0"
  let hardwareRevision = "A"

  init(_ connectionID: Int, name: String = "Printer", protocols: [String]) {
    self.connectionID = connectionID
    self.name = name
    protocolStrings = protocols
  }
}

final class FakeAccessoryManager: AccessoryManaging {
  var accessories: [FakeAccessory] = []
  private(set) var observing = false
  private var connected: ((Accessory) -> Void)?
  private var disconnected: ((Accessory) -> Void)?
  var pickerOutcome: PickerOutcome = .selected
  private(set) var pickerFilters: [String?] = []

  var connectedAccessories: [Accessory] { accessories }

  func startObserving(connected: @escaping (Accessory) -> Void, disconnected: @escaping (Accessory) -> Void) {
    observing = true
    self.connected = connected
    self.disconnected = disconnected
  }

  func stopObserving() {
    observing = false
    connected = nil
    disconnected = nil
  }

  func showPicker(nameFilter: String?, completion: @escaping (PickerOutcome) -> Void) {
    pickerFilters.append(nameFilter)
    completion(pickerOutcome)
  }

  /// The OS reports a new accessory.
  func connect(_ accessory: FakeAccessory) {
    accessories.append(accessory)
    connected?(accessory)
  }

  /// The accessory is unplugged or powered off.
  func disconnect(_ accessory: FakeAccessory) {
    accessory.isConnected = false
    accessories.removeAll { $0 === accessory }
    disconnected?(accessory)
  }
}

/// The streams of one fake session. The test plays the accessory: it opens
/// the streams, sends bytes, grants output space and ends or fails them.
final class FakeStreams: SessionStreams {
  weak var delegate: SessionStreamsDelegate?
  private(set) var opened = false
  private(set) var closed = false
  private var inbound: [UInt8] = []
  private(set) var written: [UInt8] = []
  private(set) var writeCalls = 0
  /// Bytes the output stream accepts before it is full.
  var space = Int.max
  var writeError: Error?
  var readError: Error?

  func open() { opened = true }
  func close() { closed = true }

  var hasBytesAvailable: Bool { !closed && (!inbound.isEmpty || readError != nil) }

  func read(_ buffer: UnsafeMutablePointer<UInt8>, maxLength: Int) -> Int {
    if readError != nil { return -1 }
    let count = min(maxLength, inbound.count)
    for index in 0..<count { buffer[index] = inbound[index] }
    inbound.removeFirst(count)
    return count
  }

  var hasSpaceAvailable: Bool { !closed && (space > 0 || writeError != nil) }

  func write(_ buffer: UnsafePointer<UInt8>, maxLength: Int) -> Int {
    if writeError != nil { return -1 }
    let count = min(maxLength, space)
    written.append(contentsOf: UnsafeBufferPointer(start: buffer, count: count))
    space -= count
    writeCalls += 1
    return count
  }

  var streamError: Error? { writeError ?? readError }

  // The accessory's side.

  func completeOpen(_ sides: [StreamSide] = [.input, .output]) {
    for side in sides { delegate?.streams(didReceive: .openCompleted(side)) }
  }

  func receive(_ bytes: [UInt8]) {
    inbound.append(contentsOf: bytes)
    delegate?.streams(didReceive: .hasBytesAvailable)
  }

  func receive(_ text: String) { receive(Array(text.utf8)) }

  func grantSpace(_ bytes: Int) {
    space += bytes
    delegate?.streams(didReceive: .hasSpaceAvailable)
  }

  func end() { delegate?.streams(didReceive: .endEncountered(.input)) }

  func fail(_ error: Error) {
    readError = error
    delegate?.streams(didReceive: .errorOccurred(.input, error))
  }
}

final class FakeTransport: AccessoryTransport {
  var refuse = false
  private(set) var sessions: [(accessory: Accessory, protocolString: String, streams: FakeStreams)] = []

  func openSession(_ accessory: Accessory, protocolString: String) -> SessionStreams? {
    if refuse { return nil }
    let streams = FakeStreams()
    sessions.append((accessory, protocolString, streams))
    return streams
  }

  var last: FakeStreams { sessions.last!.streams }
}

/// How a promise settled, and how many times anything tried to settle it.
final class Recorded {
  private(set) var count = 0
  private(set) var value: Any?
  private(set) var resolved = false
  private(set) var code: String?
  private(set) var message: String?
  private(set) var userInfo: [String: Any] = [:]

  private(set) lazy var promise = Promise(
    "test",
    // Weak: a test may drop the record while the library still holds the promise.
    resolve: { [weak self] value in
      guard let self = self else { return }
      self.count += 1
      self.resolved = true
      self.value = value
    },
    reject: { [weak self] code, message, userInfo in
      guard let self = self else { return }
      self.count += 1
      self.code = code
      self.message = message
      self.userInfo = userInfo
    }
  )

  var settled: Bool { count > 0 }
  var map: [String: Any] { value as! [String: Any] }
}

struct FakeError: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}

/// A module core over fakes, with every emitted event recorded.
final class Harness {
  static let serial = "com.acme.serial"
  static let control = "com.acme.control"

  let executor = ManualExecutor()
  let manager = FakeAccessoryManager()
  let transport = FakeTransport()
  private(set) var events: [(name: String, body: [String: Any])] = []
  var settingsOpen = true
  private(set) var settingsCalls = 0
  private(set) var core: ModuleCore!

  init(declared: [String] = [Harness.serial, Harness.control]) {
    core = makeCore(declared: declared)
    core.start()
  }

  func makeCore(declared: [String]) -> ModuleCore {
    ModuleCore(
      environment: ModuleEnvironment(
        osVersion: "27.0",
        declaredProtocols: declared,
        accessoryManager: manager,
        transport: transport,
        executor: executor,
        onMain: { $0() },
        openSettings: { [unowned self] completion in
          self.settingsCalls += 1
          completion(self.settingsOpen)
        },
        now: { 1_700_000_000_000 }
      ),
      emit: { [unowned self] name, body in self.events.append((name, body)) }
    )
  }

  @discardableResult
  func addAccessory(_ id: Int, protocols: [String] = [Harness.serial], name: String = "Printer") -> FakeAccessory {
    let accessory = FakeAccessory(id, name: name, protocols: protocols)
    manager.accessories.append(accessory)
    return accessory
  }

  func connect(
    _ deviceId: String,
    protocolString: String? = nil,
    timeoutMs: Double = 15_000,
    operationId: String = "op-1"
  ) -> Recorded {
    let recorded = Recorded()
    core.connect(
      operationId: operationId,
      deviceId: deviceId,
      protocolString: protocolString,
      timeoutMs: timeoutMs,
      recorded.promise
    )
    executor.drain()
    return recorded
  }

  /// Connects and opens both streams; returns the connection id and its streams.
  func connected(_ deviceId: String = "1", protocolString: String? = nil) -> (id: String, streams: FakeStreams) {
    let recorded = connect(deviceId, protocolString: protocolString)
    let streams = transport.last
    streams.completeOpen()
    precondition(recorded.resolved, "connect rejected with \(recorded.code ?? "?")")
    return (recorded.map["id"] as! String, streams)
  }

  func call(_ invoke: (Promise) -> Void) -> Recorded {
    let recorded = Recorded()
    invoke(recorded.promise)
    executor.drain()
    return recorded
  }

  func write(_ connectionId: String, _ bytes: [UInt8], timeoutMs: Double = 0) -> Recorded {
    call { core.write(connectionId: connectionId, base64: Data(bytes).base64EncodedString(), timeoutMs: timeoutMs, $0) }
  }

  func disconnect(_ connectionId: String, timeoutMs: Double = 5_000) -> Recorded {
    call { core.disconnect(connectionId: connectionId, timeoutMs: timeoutMs, $0) }
  }

  func openIds() -> [String] {
    (call { core.getConnections($0) }.value as! [[String: Any]]).map { $0["id"] as! String }
  }

  func named(_ name: String) -> [[String: Any]] {
    events.filter { $0.name == name }.map(\.body)
  }

  func states(_ connectionId: String) -> [String] {
    named("onConnectionStateChange").filter { $0["connectionId"] as? String == connectionId }
      .map { "\($0["previousState"]!)->\($0["state"]!)" }
  }

  func terminals(_ connectionId: String) -> [[String: Any]] {
    named("onConnectionStateChange").filter {
      $0["connectionId"] as? String == connectionId && $0["state"] as? String == "disconnected"
    }
  }

  func received(_ connectionId: String) -> [UInt8] {
    named("onData").filter { $0["connectionId"] as? String == connectionId }
      .flatMap { Array(Data(base64Encoded: $0["data"] as! String)!) }
  }
}
