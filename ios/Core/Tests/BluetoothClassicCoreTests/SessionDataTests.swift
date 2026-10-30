import Foundation
import XCTest
@testable import BluetoothClassicCore

/// 7.7: the session data path and its terminal events.
final class SessionDataTests: XCTestCase {
  private var harness: Harness!

  override func setUp() {
    super.setUp()
    harness = Harness()
    harness.addAccessory(1)
  }

  // MARK: Reading

  func testReadsAreBatchedFor16MsAndCarrySeqNumbers() {
    let (id, streams) = harness.connected()

    streams.receive("OK\r\n")
    streams.receive("READY\r\n")
    XCTAssertTrue(harness.received(id).isEmpty)
    harness.executor.advance(AccessorySession.batchDelay)
    XCTAssertEqual(String(decoding: harness.received(id), as: UTF8.self), "OK\r\nREADY\r\n")

    streams.receive("again")
    harness.executor.advance(AccessorySession.batchDelay)

    XCTAssertEqual(harness.named("onData").map { $0["seq"] as? Int }, [0, 1])
  }

  func testABatchIsEmittedAtOnceWhenItReaches16KiB() {
    let (id, streams) = harness.connected()
    let payload = (0..<AccessorySession.batchBytes).map { UInt8($0 & 0xFF) }

    streams.receive(payload)

    XCTAssertEqual(harness.received(id), payload)
  }

  func testBytesThatArriveWhileOpeningAreDeliveredOnceConnected() {
    let recorded = harness.connect("1")
    let streams = harness.transport.last
    streams.completeOpen([.input])
    streams.receive("hello")
    streams.completeOpen([.output])
    let id = recorded.map["id"] as! String

    harness.executor.advance(AccessorySession.batchDelay)

    XCTAssertEqual(String(decoding: harness.received(id), as: UTF8.self), "hello")
  }

  func testDataIsFlushedBeforeTheTerminalEvent() {
    let (id, streams) = harness.connected()

    streams.receive("bye")
    streams.end()

    let order = harness.events.filter { $0.body["connectionId"] as? String == id }.map(\.name)
    XCTAssertEqual(order, ["onData", "onConnectionStateChange"])
  }

  // MARK: Writing

  func testWritesResolveOnceEveryByteIsAcceptedEvenAcrossPartialWrites() {
    let (id, streams) = harness.connected()
    streams.space = 3
    let payload = Array("ESC@ receipt".utf8)

    let write = harness.write(id, payload)
    XCTAssertFalse(write.settled)
    streams.grantSpace(4)
    XCTAssertFalse(write.settled)
    streams.grantSpace(100)

    XCTAssertTrue(write.resolved)
    XCTAssertEqual(streams.written, payload)
  }

  func testUnawaitedWritesAreSentInCallOrder() {
    let (id, streams) = harness.connected()
    streams.space = 0
    let a = [UInt8](repeating: 0x61, count: 10_000)
    let b = [UInt8](repeating: 0x62, count: 10_000)
    let c = [UInt8](repeating: 0x63, count: 10_000)

    let writes = [harness.write(id, a), harness.write(id, b), harness.write(id, c)]
    for _ in 0..<20 { streams.grantSpace(2_000) }

    XCTAssertTrue(writes.allSatisfy(\.resolved))
    XCTAssertEqual(streams.written, a + b + c)
  }

  func testAStreamWriteErrorIsWriteFailedAndEndsTheConnection() {
    let (id, streams) = harness.connected()
    streams.writeError = NSError(domain: NSPOSIXErrorDomain, code: 32, userInfo: [NSLocalizedDescriptionKey: "Broken pipe"])

    let write = harness.write(id, [1])

    XCTAssertEqual(write.code, ErrorCode.WRITE_FAILED)
    XCTAssertEqual(write.userInfo["nativeMessage"] as? String, "Broken pipe")
    let terminal = harness.terminals(id).single!
    XCTAssertEqual(terminal["reason"] as? String, "error")
    XCTAssertEqual(terminal["errorCode"] as? String, ErrorCode.WRITE_FAILED)
    XCTAssertTrue(streams.closed)
  }

  func testAWriteTheAccessoryNeverAcceptsTimesOutEndsTheConnectionAndFailsQueuedWrites() {
    let (id, streams) = harness.connected()
    streams.space = 0
    let stalled = harness.write(id, [1, 2, 3], timeoutMs: 2_000)
    let queued = harness.write(id, [4])

    harness.executor.advance(1.999)
    XCTAssertFalse(stalled.settled)
    harness.executor.advance(0.001)

    XCTAssertEqual(stalled.code, ErrorCode.WRITE_TIMEOUT)
    XCTAssertEqual(queued.code, ErrorCode.NOT_CONNECTED)
    XCTAssertEqual(harness.terminals(id).single?["errorCode"] as? String, ErrorCode.WRITE_TIMEOUT)
    XCTAssertTrue(streams.closed)
  }

  func testWritesToAnUnknownOrEndedConnectionAreNotConnected() {
    XCTAssertEqual(harness.write("conn-9", [1]).code, ErrorCode.NOT_CONNECTED)
    let (id, streams) = harness.connected()
    streams.end()

    let write = harness.write(id, [1])
    XCTAssertEqual(write.code, ErrorCode.NOT_CONNECTED)
    XCTAssertEqual(write.userInfo["connectionId"] as? String, id)
  }

  func testAnEmptyWriteResolvesWithoutIO() {
    let (id, streams) = harness.connected()

    XCTAssertTrue(harness.write(id, []).resolved)
    XCTAssertEqual(streams.writeCalls, 0)
  }

  func testInvalidBase64IsInvalidArgument() {
    let (id, _) = harness.connected()

    let recorded = harness.call { harness.core.write(connectionId: id, base64: "%%%", timeoutMs: 0, $0) }

    XCTAssertEqual(recorded.code, ErrorCode.INVALID_ARGUMENT)
  }

  // MARK: Disconnect

  func testWriteThenDisconnectSendsTheBytesBeforeClosing() {
    let (id, streams) = harness.connected()
    streams.space = 0
    let receipt = Array(String(repeating: "RECEIPT\n", count: 100).utf8)

    let write = harness.write(id, receipt)
    let disconnect = harness.disconnect(id)
    XCTAssertFalse(streams.closed)
    streams.grantSpace(receipt.count)

    XCTAssertTrue(write.resolved)
    XCTAssertTrue(disconnect.resolved)
    XCTAssertEqual(streams.written, receipt)
    XCTAssertTrue(streams.closed)
    XCTAssertEqual(harness.states(id), ["connected->disconnecting", "disconnecting->disconnected"])
    XCTAssertEqual(harness.terminals(id).single?["reason"] as? String, "local")
    XCTAssertEqual(harness.openIds(), [])
  }

  func testWritesStillPendingWhenTheDisconnectTimesOutAreNotConnected() {
    let (id, streams) = harness.connected()
    streams.space = 0
    let stalled = harness.write(id, [1])

    let disconnect = harness.disconnect(id, timeoutMs: 5_000)
    harness.executor.advance(5)

    XCTAssertTrue(disconnect.resolved)
    XCTAssertEqual(stalled.code, ErrorCode.NOT_CONNECTED)
    XCTAssertEqual(harness.terminals(id).single?["reason"] as? String, "local")
  }

  func testDisconnectingTwiceResolvesAndDoesNothingElse() {
    let (id, _) = harness.connected()
    XCTAssertTrue(harness.disconnect(id).resolved)
    let before = harness.events.count

    XCTAssertTrue(harness.disconnect(id).resolved)
    XCTAssertEqual(harness.events.count, before)
  }

  func testConcurrentDisconnectsShareOneClose() {
    let (id, streams) = harness.connected()
    streams.space = 0
    _ = harness.write(id, [1])

    let first = harness.disconnect(id)
    let second = harness.disconnect(id)
    XCTAssertFalse(first.settled || second.settled)
    streams.grantSpace(1)

    XCTAssertTrue(first.resolved && second.resolved)
    XCTAssertEqual(harness.terminals(id).count, 1)
  }

  func testWritesAfterDisconnectStartedAreNotConnected() {
    let (id, streams) = harness.connected()
    streams.space = 0
    _ = harness.write(id, [1])
    _ = harness.disconnect(id)

    XCTAssertEqual(harness.write(id, [2]).code, ErrorCode.NOT_CONNECTED)
  }

  func testCloseWithErrorEndsTheConnectionWithThatCode() {
    let (id, streams) = harness.connected()

    let recorded = harness.call {
      harness.core.closeWithError(connectionId: id, code: ErrorCode.BUFFER_OVERFLOW, message: "full", $0)
    }

    XCTAssertTrue(recorded.resolved)
    let terminal = harness.terminals(id).single!
    XCTAssertEqual(terminal["reason"] as? String, "error")
    XCTAssertEqual(terminal["errorCode"] as? String, ErrorCode.BUFFER_OVERFLOW)
    XCTAssertEqual(terminal["errorMessage"] as? String, "full")
    XCTAssertTrue(streams.closed)
  }

  // MARK: Terminal events

  func testEndOfStreamIsARemoteCloseExactlyOnce() {
    let (id, streams) = harness.connected()

    streams.end()
    streams.end()

    XCTAssertEqual(harness.states(id), ["connected->disconnected"])
    XCTAssertEqual(harness.terminals(id).single?["reason"] as? String, "remote")
    XCTAssertNil(harness.terminals(id).single?["errorCode"])
  }

  func testAnAccessoryDisconnectIsARemoteClose() {
    let accessory = harness.manager.accessories[0]
    let (id, streams) = harness.connected()

    harness.manager.disconnect(accessory)
    harness.executor.drain()

    XCTAssertEqual(harness.terminals(id).single?["reason"] as? String, "remote")
    XCTAssertTrue(streams.closed)
  }

  func testAStreamErrorWhileTheAccessoryIsConnectedIsConnectionLost() {
    let (id, streams) = harness.connected()

    streams.fail(NSError(domain: NSPOSIXErrorDomain, code: 54))

    let terminal = harness.terminals(id).single!
    XCTAssertEqual(terminal["reason"] as? String, "error")
    XCTAssertEqual(terminal["errorCode"] as? String, ErrorCode.CONNECTION_LOST)
    XCTAssertEqual(terminal["nativeCode"] as? String, "\(NSPOSIXErrorDomain):54")
  }

  func testAStreamErrorAfterTheAccessoryLeftIsARemoteClose() {
    let (id, streams) = harness.connected()
    harness.manager.accessories[0].isConnected = false

    streams.fail(NSError(domain: NSPOSIXErrorDomain, code: 54))

    XCTAssertEqual(harness.terminals(id).single?["reason"] as? String, "remote")
  }

  func testStaleEventsNeverAffectANewerConnection() {
    let (old, oldStreams) = harness.connected()
    oldStreams.end()
    let (current, currentStreams) = harness.connected()

    oldStreams.fail(NSError(domain: NSPOSIXErrorDomain, code: 54))
    _ = harness.disconnect(old)
    _ = harness.call { harness.core.closeWithError(connectionId: old, code: ErrorCode.BUFFER_OVERFLOW, message: "late", $0) }

    XCTAssertFalse(currentStreams.closed)
    XCTAssertEqual(harness.openIds(), [current])
    XCTAssertTrue(harness.terminals(current).isEmpty)
  }
}
