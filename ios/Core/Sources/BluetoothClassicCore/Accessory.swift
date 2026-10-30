import Foundation

/// An accessory connected to the OS. In the app it wraps an `EAAccessory`.
protocol Accessory: AnyObject {
  /// The OS connection identifier; it changes every time the accessory reconnects.
  var connectionID: Int { get }
  var name: String { get }
  var manufacturer: String { get }
  var modelNumber: String { get }
  var serialNumber: String { get }
  var firmwareRevision: String { get }
  var hardwareRevision: String { get }
  var protocolStrings: [String] { get }
  var isConnected: Bool { get }
}

extension Accessory {
  var id: String { String(connectionID) }

  /// The accessory as JS sees it.
  func toMap() -> [String: Any] {
    [
      "id": id,
      "name": name,
      "manufacturer": manufacturer,
      "modelNumber": modelNumber,
      "serialNumber": serialNumber,
      "firmwareRevision": firmwareRevision,
      "hardwareRevision": hardwareRevision,
      "protocolStrings": protocolStrings,
    ]
  }
}

/// How the system accessory picker ended.
enum PickerOutcome {
  case selected
  case alreadyConnected
  case cancelled
  case notFound
  case failed(Error)
}

/// The OS accessory manager. In the app it wraps `EAAccessoryManager`.
protocol AccessoryManaging: AnyObject {
  var connectedAccessories: [Accessory] { get }

  /// Starts delivering connect and disconnect notifications, on any thread.
  func startObserving(connected: @escaping (Accessory) -> Void, disconnected: @escaping (Accessory) -> Void)
  func stopObserving()

  /// Shows the system Bluetooth accessory picker. Call on the main thread.
  func showPicker(nameFilter: String?, completion: @escaping (PickerOutcome) -> Void)
}
