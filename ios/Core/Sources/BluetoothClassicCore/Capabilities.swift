import Foundation

/// Builds the `getCapabilities()` result for iOS.
enum Capabilities {
  static let protocolsKey = "UISupportedExternalAccessoryProtocols"

  static func ios(osVersion: String, declaredProtocols: [String]) -> [String: Any] {
    [
      "platform": "ios",
      "osVersion": osVersion,
      "discovery": false,
      "pairing": false,
      "server": false,
      "adapterState": false,
      "requestEnable": false,
      "bondLossEvents": false,
      "accessoryPicker": true,
      "declaredProtocols": declaredProtocols,
    ]
  }

  /// The protocols declared in Info.plist, in order. A missing or malformed
  /// key means none, never a crash.
  static func declaredProtocols(in info: [String: Any]?) -> [String] {
    guard let entries = info?[protocolsKey] as? [Any] else { return [] }
    var seen = Set<String>()
    return entries.compactMap { $0 as? String }.filter { !$0.isEmpty && seen.insert($0).inserted }
  }
}
