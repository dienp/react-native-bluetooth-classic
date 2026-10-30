import Foundation
import XCTest
@testable import BluetoothClassicCore

/// 7.1 and 7.2: error mapping, the entry guard, capabilities and Android-only calls.
final class ContractTests: XCTestCase {
  func testALibraryErrorKeepsItsCodeAndContext() {
    let error = CoreError(
      ErrorCode.ALREADY_CONNECTED,
      "Already connected",
      deviceId: "7",
      connectionId: "conn-1",
      cause: NSError(domain: "EASessionErrorDomain", code: 3, userInfo: [NSLocalizedDescriptionKey: "busy"])
    )

    let mapped = ErrorMapper.map(error)

    XCTAssertEqual(mapped.code, ErrorCode.ALREADY_CONNECTED)
    XCTAssertEqual(mapped.userInfo["deviceId"] as? String, "7")
    XCTAssertEqual(mapped.userInfo["connectionId"] as? String, "conn-1")
    XCTAssertEqual(mapped.userInfo["nativeCode"] as? String, "EASessionErrorDomain:3")
    XCTAssertEqual(mapped.userInfo["nativeMessage"] as? String, "busy")
  }

  func testAnUnexpectedErrorIsUnknownWithItsNativeDetails() {
    let fromNSError = ErrorMapper.map(NSError(domain: NSPOSIXErrorDomain, code: 57, userInfo: nil))
    XCTAssertEqual(fromNSError.code, ErrorCode.UNKNOWN)
    XCTAssertEqual(fromNSError.nativeCode, "\(NSPOSIXErrorDomain):57")

    let fromSwift = ErrorMapper.map(FakeError("binder died"))
    XCTAssertEqual(fromSwift.code, ErrorCode.UNKNOWN)
    XCTAssertEqual(fromSwift.nativeCode, "FakeError")
    XCTAssertEqual(fromSwift.nativeMessage, "binder died")
  }

  func testAPromiseSettlesOnceAndGuardedTurnsThrowsIntoRejections() {
    let recorded = Recorded()
    guarded(recorded.promise) { throw FakeError("boom") }
    recorded.promise.resolve("late")
    recorded.promise.reject(FakeError("again"))

    XCTAssertEqual(recorded.count, 1)
    XCTAssertEqual(recorded.code, ErrorCode.UNKNOWN)

    let abandoned = Recorded()
    abandoned.promise.abandon()
    abandoned.promise.resolve(nil)
    XCTAssertEqual(abandoned.count, 0)
  }

  func testCapabilitiesReportTheIOSFlagsAndTheDeclaredProtocols() {
    let harness = Harness()

    let capabilities = harness.core.capabilities()

    XCTAssertEqual(capabilities["platform"] as? String, "ios")
    XCTAssertEqual(capabilities["osVersion"] as? String, "27.0")
    XCTAssertEqual(capabilities["accessoryPicker"] as? Bool, true)
    for flag in ["discovery", "pairing", "server", "adapterState", "requestEnable", "bondLossEvents"] {
      XCTAssertEqual(capabilities[flag] as? Bool, false, flag)
    }
    XCTAssertEqual(capabilities["declaredProtocols"] as? [String], [Harness.serial, Harness.control])
  }

  func testDeclaredProtocolsAreReadSafelyFromInfoPlist() {
    XCTAssertEqual(Capabilities.declaredProtocols(in: nil), [])
    XCTAssertEqual(Capabilities.declaredProtocols(in: [:]), [])
    XCTAssertEqual(Capabilities.declaredProtocols(in: [Capabilities.protocolsKey: "com.acme.serial"]), [])
    XCTAssertEqual(
      Capabilities.declaredProtocols(in: [Capabilities.protocolsKey: ["b", 42, "a", "", "b"] as [Any]]),
      ["b", "a"]
    )
  }

  func testAnAppWithoutDeclaredProtocolsStartsAndReportsNone() {
    let harness = Harness(declared: [])
    harness.addAccessory(1)

    XCTAssertEqual(harness.core.capabilities()["declaredProtocols"] as? [String], [])
    XCTAssertEqual((harness.call { harness.core.getConnectedAccessories($0) }.value as? [Any])?.count, 0)
    XCTAssertEqual(harness.connect("1").code, ErrorCode.PROTOCOL_NOT_DECLARED)
  }

  func testAndroidOnlyCallsRejectWithUnsupportedOnPlatform() {
    let harness = Harness()
    for operation in ["getAdapterState", "startDiscovery", "pair", "accept", "cancelAccept"] {
      let recorded = harness.call { harness.core.unsupported(operation, $0) }
      XCTAssertEqual(recorded.code, ErrorCode.UNSUPPORTED_ON_PLATFORM, operation)
      XCTAssertEqual(recorded.message, "\(operation)() is only available on Android")
    }
  }

  func testOnlyTheConnectScopeExists() {
    let harness = Harness()

    let connect = harness.call { harness.core.checkPermissions("connect", $0) }
    XCTAssertEqual(connect.map["granted"] as? Bool, true)
    XCTAssertEqual(connect.map["missing"] as? [String], [])
    XCTAssertEqual(harness.call { harness.core.checkPermissions("discovery", $0) }.code, ErrorCode.UNSUPPORTED_ON_PLATFORM)
    XCTAssertEqual(harness.call { harness.core.checkPermissions("server", $0) }.code, ErrorCode.UNSUPPORTED_ON_PLATFORM)
    XCTAssertEqual(harness.call { harness.core.checkPermissions("all", $0) }.code, ErrorCode.INVALID_ARGUMENT)
  }

  func testSetLogLevelChangesTheLevelAndInvalidateResetsIt() {
    let harness = Harness()
    harness.core.setLogLevel("debug")
    XCTAssertEqual(Log.level, "debug")
    harness.core.setLogLevel("verbose")
    XCTAssertEqual(Log.level, "debug")

    harness.core.invalidate()

    XCTAssertEqual(Log.level, Log.defaultLevel)
  }

  func testOpenSettingsResolvesWhenTheOSOpensThem() {
    let harness = Harness()
    XCTAssertTrue(harness.call { harness.core.openSettings($0) }.resolved)

    harness.settingsOpen = false
    XCTAssertEqual(harness.call { harness.core.openSettings($0) }.code, ErrorCode.UNKNOWN)
    XCTAssertEqual(harness.settingsCalls, 2)
  }
}
