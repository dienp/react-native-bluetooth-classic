import Foundation

/// The accessories the app may use: those connected to the OS that support
/// at least one protocol declared in Info.plist.
final class AccessoryRegistry {
  private let manager: AccessoryManaging
  let declaredProtocols: [String]

  init(manager: AccessoryManaging, declaredProtocols: [String]) {
    self.manager = manager
    self.declaredProtocols = declaredProtocols
  }

  func isRelevant(_ accessory: Accessory) -> Bool {
    accessory.protocolStrings.contains(where: declaredProtocols.contains)
  }

  /// Connected accessories with a declared protocol, in OS order.
  func connectedAccessories() -> [Accessory] {
    manager.connectedAccessories.filter(isRelevant)
  }

  /// Any connected accessory with this id, declared protocol or not.
  func accessory(id: String) -> Accessory? {
    guard let connectionID = Int(id) else { return nil }
    return manager.connectedAccessories.first { $0.connectionID == connectionID && $0.isConnected }
  }

  /// Reports every connect and disconnect: `relevant` says whether JS hears about it.
  func start(
    connected: @escaping (Accessory, _ relevant: Bool) -> Void,
    disconnected: @escaping (Accessory, _ relevant: Bool) -> Void
  ) {
    manager.startObserving(
      connected: { [weak self] accessory in
        guard let self = self else { return }
        connected(accessory, self.isRelevant(accessory))
      },
      disconnected: { [weak self] accessory in
        guard let self = self else { return }
        disconnected(accessory, self.isRelevant(accessory))
      }
    )
  }

  func stop() {
    manager.stopObserving()
  }
}
