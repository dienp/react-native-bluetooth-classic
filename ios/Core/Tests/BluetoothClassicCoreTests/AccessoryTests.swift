import Foundation
import XCTest
@testable import BluetoothClassicCore

/// 7.3 and 7.4: connected accessories, their events, and the picker.
final class AccessoryTests: XCTestCase {
  func testConnectedAccessoriesAreFilteredByDeclaredProtocols() {
    let harness = Harness()
    harness.addAccessory(1, protocols: ["com.other"], name: "Speaker")
    harness.addAccessory(2, protocols: ["com.other", Harness.control], name: "Printer")

    let accessories = harness.call { harness.core.getConnectedAccessories($0) }.value as! [[String: Any]]

    XCTAssertEqual(accessories.count, 1)
    let printer = accessories[0]
    XCTAssertEqual(printer["id"] as? String, "2")
    XCTAssertEqual(printer["name"] as? String, "Printer")
    XCTAssertEqual(printer["manufacturer"] as? String, "Acme")
    XCTAssertEqual(printer["modelNumber"] as? String, "M-1")
    XCTAssertEqual(printer["serialNumber"] as? String, "SN-42")
    XCTAssertEqual(printer["firmwareRevision"] as? String, "1.0.0")
    XCTAssertEqual(printer["hardwareRevision"] as? String, "A")
    XCTAssertEqual(printer["protocolStrings"] as? [String], ["com.other", Harness.control])
  }

  func testConnectAndDisconnectEventsFireOnlyForAccessoriesWithADeclaredProtocol() {
    let harness = Harness()
    let printer = FakeAccessory(5, protocols: [Harness.serial])
    let speaker = FakeAccessory(6, protocols: ["com.other"])

    harness.manager.connect(printer)
    harness.manager.connect(speaker)
    harness.manager.disconnect(printer)
    harness.manager.disconnect(speaker)

    let connected = harness.named("onAccessoryConnected")
    let disconnected = harness.named("onAccessoryDisconnected")
    XCTAssertEqual(connected.map { ($0["accessory"] as! [String: Any])["id"] as! String }, ["5"])
    XCTAssertEqual(disconnected.map { ($0["accessory"] as! [String: Any])["id"] as! String }, ["5"])
    XCTAssertEqual(connected[0]["timestamp"] as? Double, 1_700_000_000_000)
  }

  func testAReconnectedAccessoryHasANewId() {
    let harness = Harness()
    let first = FakeAccessory(10, protocols: [Harness.serial])
    harness.manager.connect(first)
    harness.manager.disconnect(first)
    harness.manager.connect(FakeAccessory(11, protocols: [Harness.serial]))

    let ids = (harness.call { harness.core.getConnectedAccessories($0) }.value as! [[String: Any]]).map { $0["id"] as! String }
    XCTAssertEqual(ids, ["11"])
  }

  func testThePickerResolvesWhenAnAccessoryIsSelectedOrAlreadyConnected() {
    let harness = Harness()

    XCTAssertTrue(harness.call { harness.core.showAccessoryPicker(nameFilter: "Print", $0) }.resolved)
    harness.manager.pickerOutcome = .alreadyConnected
    XCTAssertTrue(harness.call { harness.core.showAccessoryPicker(nameFilter: nil, $0) }.resolved)
    XCTAssertEqual(harness.manager.pickerFilters, ["Print", nil])
  }

  func testPickerFailuresMapToTheirCodes() {
    let harness = Harness()
    let cases: [(PickerOutcome, String)] = [
      (.cancelled, ErrorCode.USER_REJECTED),
      (.notFound, ErrorCode.DEVICE_NOT_FOUND),
      (.failed(NSError(domain: "EABluetoothAccessoryPickerErrorDomain", code: 3)), ErrorCode.UNKNOWN),
    ]
    for (outcome, code) in cases {
      harness.manager.pickerOutcome = outcome
      let recorded = harness.call { harness.core.showAccessoryPicker(nameFilter: nil, $0) }
      XCTAssertEqual(recorded.code, code)
      XCTAssertEqual(recorded.count, 1)
    }
    harness.manager.pickerOutcome = .failed(NSError(domain: "EABluetoothAccessoryPickerErrorDomain", code: 3))
    let failed = harness.call { harness.core.showAccessoryPicker(nameFilter: nil, $0) }
    XCTAssertEqual(failed.userInfo["nativeCode"] as? String, "EABluetoothAccessoryPickerErrorDomain:3")
  }
}
