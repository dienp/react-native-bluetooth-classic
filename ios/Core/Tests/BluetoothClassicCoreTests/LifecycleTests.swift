import Foundation
import XCTest
@testable import BluetoothClassicCore

/// 7.8: invalidation, deallocation and resume-time terminal delivery.
final class LifecycleTests: XCTestCase {
  func testInvalidateClosesSessionsDropsPendingCallsAndStopsEvents() {
    let harness = Harness()
    harness.addAccessory(1, protocols: [Harness.serial, Harness.control])
    let (id, streams) = harness.connected("1", protocolString: Harness.serial)
    streams.space = 0
    let write = harness.write(id, [1])
    let pending = harness.connect("1", protocolString: Harness.control, operationId: "op-2")
    let pendingStreams = harness.transport.last
    let eventsBefore = harness.events.count

    harness.core.invalidate()
    harness.executor.drain()

    XCTAssertTrue(streams.closed)
    XCTAssertTrue(pendingStreams.closed)
    XCTAssertFalse(write.settled)
    XCTAssertFalse(pending.settled)
    XCTAssertFalse(harness.manager.observing)
    // Nothing reaches the old runtime any more.
    streams.receive("late")
    harness.manager.connect(FakeAccessory(2, protocols: [Harness.serial]))
    harness.executor.advance(1)
    XCTAssertEqual(harness.events.count, eventsBefore)
    let late = harness.call { harness.core.getConnections($0) }
    XCTAssertFalse(late.settled)
  }

  func testTheCoreDeallocatesAfterInvalidation() {
    weak var released: ModuleCore?
    let harness = Harness()
    harness.addAccessory(1)
    do {
      var core: ModuleCore? = harness.makeCore(declared: [Harness.serial])
      core!.start()
      let recorded = Recorded()
      core!.connect(operationId: "op", deviceId: "1", protocolString: nil, timeoutMs: 1_000, recorded.promise)
      harness.executor.drain()
      harness.transport.last.completeOpen()
      released = core
      core!.invalidate()
      harness.executor.drain()
      core = nil
    }
    harness.executor.advance(10)

    XCTAssertNil(released)
  }

  func testANewRuntimeCanConnectToTheSameAccessoryAndProtocol() {
    let harness = Harness()
    harness.addAccessory(1)
    _ = harness.connected()
    harness.core.invalidate()
    harness.executor.drain()

    let reloaded = harness.makeCore(declared: [Harness.serial])
    reloaded.start()
    let recorded = Recorded()
    reloaded.connect(operationId: "op", deviceId: "1", protocolString: nil, timeoutMs: 1_000, recorded.promise)
    harness.executor.drain()
    harness.transport.last.completeOpen()

    XCTAssertTrue(recorded.resolved)
    XCTAssertEqual(recorded.map["id"] as? String, "conn-1")
  }

  func testOnResumeSessionsWhoseAccessoryLeftEndAsRemote() {
    let harness = Harness()
    let accessory = harness.addAccessory(1)
    let (id, streams) = harness.connected()
    // The OS dropped the accessory while the app was suspended; no notification arrived.
    accessory.isConnected = false
    harness.manager.accessories = []

    harness.core.appDidBecomeActive()
    harness.executor.drain()

    XCTAssertEqual(harness.terminals(id).single?["reason"] as? String, "remote")
    XCTAssertTrue(streams.closed)
  }

  func testOnResumeLiveSessionsAreLeftAlone() {
    let harness = Harness()
    harness.addAccessory(1)
    let (id, streams) = harness.connected()

    harness.core.appDidBecomeActive()
    harness.executor.drain()

    XCTAssertTrue(harness.terminals(id).isEmpty)
    XCTAssertFalse(streams.closed)
  }

  func testStateEventsCarryTheTerminalDetails() {
    let event = ModuleCore.stateEvent(
      "conn-1",
      "disconnected",
      "connected",
      .error(ErrorCode.WRITE_FAILED, "A write failed", NSError(domain: NSPOSIXErrorDomain, code: 32)),
      1_700_000_000_000
    )

    XCTAssertEqual(event["connectionId"] as? String, "conn-1")
    XCTAssertEqual(event["reason"] as? String, "error")
    XCTAssertEqual(event["errorCode"] as? String, ErrorCode.WRITE_FAILED)
    XCTAssertEqual(event["errorMessage"] as? String, "A write failed")
    XCTAssertEqual(event["nativeCode"] as? String, "\(NSPOSIXErrorDomain):32")
    XCTAssertEqual(event["timestamp"] as? Double, 1_700_000_000_000)
    XCTAssertNil(ModuleCore.stateEvent("conn-1", "disconnecting", "connected", nil, 0)["reason"])
  }
}
