import Foundation
import XCTest
@testable import BluetoothClassicCore

/// 7.6: every "Connect to an accessory on iOS" scenario.
final class ConnectTests: XCTestCase {
  func testTheDefaultProtocolIsTheFirstDeclaredOneTheAccessorySupports() {
    let harness = Harness()
    harness.addAccessory(1, protocols: ["com.other", Harness.control])

    let recorded = harness.connect("1")

    XCTAssertEqual(harness.transport.sessions.single?.protocolString, Harness.control)
    XCTAssertFalse(recorded.settled)
    harness.transport.last.completeOpen()
    XCTAssertEqual(recorded.map["protocol"] as? String, Harness.control)
  }

  func testConnectResolvesOnlyOnceBothStreamsAreOpen() {
    let harness = Harness()
    harness.addAccessory(1)

    let recorded = harness.connect("1")
    let streams = harness.transport.last
    XCTAssertTrue(streams.opened)
    streams.completeOpen([.input])
    XCTAssertFalse(recorded.settled)
    streams.completeOpen([.output])

    XCTAssertTrue(recorded.resolved)
    let connection = recorded.map
    XCTAssertEqual(connection["id"] as? String, "conn-1")
    XCTAssertEqual(connection["state"] as? String, "connected")
    XCTAssertEqual(connection["connectedAt"] as? Double, 1_700_000_000_000)
    XCTAssertEqual((connection["accessory"] as? [String: Any])?["id"] as? String, "1")
    XCTAssertEqual(harness.openIds(), ["conn-1"])
  }

  func testAProtocolMissingFromInfoPlistIsProtocolNotDeclared() {
    let harness = Harness()
    harness.addAccessory(1, protocols: ["com.undeclared"])

    let recorded = harness.connect("1", protocolString: "com.undeclared")

    XCTAssertEqual(recorded.code, ErrorCode.PROTOCOL_NOT_DECLARED)
    XCTAssertTrue(harness.transport.sessions.isEmpty)
  }

  func testADeclaredProtocolTheAccessoryLacksIsProtocolNotSupported() {
    let harness = Harness()
    harness.addAccessory(1, protocols: [Harness.serial])

    XCTAssertEqual(harness.connect("1", protocolString: Harness.control).code, ErrorCode.PROTOCOL_NOT_SUPPORTED)
    harness.addAccessory(2, protocols: ["com.other"])
    XCTAssertEqual(harness.connect("2").code, ErrorCode.PROTOCOL_NOT_SUPPORTED)
  }

  func testAnIdThatIsNotConnectedIsAccessoryNotConnected() {
    let harness = Harness()
    harness.addAccessory(1).isConnected = false

    for id in ["1", "99", "printer"] {
      let recorded = harness.connect(id)
      XCTAssertEqual(recorded.code, ErrorCode.ACCESSORY_NOT_CONNECTED, id)
      XCTAssertEqual(recorded.userInfo["deviceId"] as? String, id)
    }
  }

  func testAnOSRefusalIsSessionOpenFailed() {
    let harness = Harness()
    harness.addAccessory(1)
    harness.transport.refuse = true

    XCTAssertEqual(harness.connect("1").code, ErrorCode.SESSION_OPEN_FAILED)
  }

  func testStreamsThatNeverOpenTimeOutAndAreClosed() {
    let harness = Harness()
    harness.addAccessory(1)
    let recorded = harness.connect("1", timeoutMs: 8_000)
    let streams = harness.transport.last
    streams.completeOpen([.input])

    harness.executor.advance(7.999)
    XCTAssertFalse(recorded.settled)
    harness.executor.advance(0.001)

    XCTAssertEqual(recorded.code, ErrorCode.CONNECT_TIMEOUT)
    XCTAssertTrue(streams.closed)
    // A late open changes nothing.
    streams.completeOpen([.output])
    XCTAssertEqual(recorded.count, 1)
    XCTAssertEqual(harness.openIds(), [])
    XCTAssertTrue(harness.named("onConnectionStateChange").isEmpty)
  }

  func testCancellingAPendingConnectClosesTheSession() {
    let harness = Harness()
    harness.addAccessory(1)
    let recorded = harness.connect("1", operationId: "op-cancel")
    let streams = harness.transport.last

    let cancel = harness.call { harness.core.cancelOperation("op-cancel", $0) }

    XCTAssertTrue(cancel.resolved)
    XCTAssertEqual(recorded.code, ErrorCode.CONNECT_CANCELLED)
    XCTAssertTrue(streams.closed)
    XCTAssertEqual(harness.executor.pendingTimers, 0)
    // The pair is free again.
    XCTAssertFalse(harness.connect("1", operationId: "op-2").settled)
  }

  func testCancellingASettledConnectHasNoEffect() {
    let harness = Harness()
    harness.addAccessory(1)
    let (id, streams) = harness.connected()

    XCTAssertTrue(harness.call { harness.core.cancelOperation("op-1", $0) }.resolved)

    XCTAssertFalse(streams.closed)
    XCTAssertEqual(harness.openIds(), [id])
  }

  func testOneConnectionPerAccessoryAndProtocol() {
    let harness = Harness()
    harness.addAccessory(1, protocols: [Harness.serial, Harness.control])
    let (id, _) = harness.connected("1", protocolString: Harness.serial)

    let again = harness.connect("1", protocolString: Harness.serial, operationId: "op-2")
    XCTAssertEqual(again.code, ErrorCode.ALREADY_CONNECTED)
    XCTAssertEqual(again.userInfo["connectionId"] as? String, id)

    let pending = harness.connect("1", protocolString: Harness.control, operationId: "op-3")
    XCTAssertFalse(pending.settled)
    XCTAssertEqual(harness.connect("1", protocolString: Harness.control, operationId: "op-4").code, ErrorCode.ALREADY_CONNECTING)
    harness.transport.last.completeOpen()
    XCTAssertTrue(pending.resolved)
  }

  func testAStreamFailureWhileOpeningIsConnectFailed() {
    let harness = Harness()
    harness.addAccessory(1)
    let recorded = harness.connect("1")
    let streams = harness.transport.last

    streams.fail(NSError(domain: NSPOSIXErrorDomain, code: 61))

    XCTAssertEqual(recorded.code, ErrorCode.CONNECT_FAILED)
    XCTAssertEqual(recorded.userInfo["nativeCode"] as? String, "\(NSPOSIXErrorDomain):61")
    XCTAssertTrue(streams.closed)
  }

  func testAnAccessoryThatLeavesWhileOpeningFailsTheConnect() {
    let harness = Harness()
    let accessory = harness.addAccessory(1)
    let recorded = harness.connect("1")

    harness.manager.disconnect(accessory)
    harness.executor.drain()

    XCTAssertEqual(recorded.code, ErrorCode.ACCESSORY_NOT_CONNECTED)
    XCTAssertTrue(harness.transport.last.closed)
  }
}

extension Array {
  var single: Element? { count == 1 ? first : nil }
}
