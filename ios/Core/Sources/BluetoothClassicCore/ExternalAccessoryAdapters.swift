#if canImport(ExternalAccessory)
  import ExternalAccessory
  import Foundation

  /// An `EAAccessory` as the core sees it.
  final class EAAccessoryAdapter: Accessory {
    let accessory: EAAccessory

    init(_ accessory: EAAccessory) {
      self.accessory = accessory
    }

    var connectionID: Int { accessory.connectionID }
    var name: String { accessory.name }
    var manufacturer: String { accessory.manufacturer }
    var modelNumber: String { accessory.modelNumber }
    var serialNumber: String { accessory.serialNumber }
    var firmwareRevision: String { accessory.firmwareRevision }
    var hardwareRevision: String { accessory.hardwareRevision }
    var protocolStrings: [String] { accessory.protocolStrings }
    var isConnected: Bool { accessory.isConnected }
  }

  /// `EAAccessoryManager`, its notifications and the accessory picker.
  final class EAManagerAdapter: AccessoryManaging {
    private var observers: [NSObjectProtocol] = []

    var connectedAccessories: [Accessory] {
      EAAccessoryManager.shared().connectedAccessories.map(EAAccessoryAdapter.init)
    }

    func startObserving(connected: @escaping (Accessory) -> Void, disconnected: @escaping (Accessory) -> Void) {
      guard observers.isEmpty else { return }
      EAAccessoryManager.shared().registerForLocalNotifications()
      let center = NotificationCenter.default
      observers = [
        center.addObserver(forName: .EAAccessoryDidConnect, object: nil, queue: nil) { note in
          if let accessory = note.userInfo?[EAAccessoryKey] as? EAAccessory {
            connected(EAAccessoryAdapter(accessory))
          }
        },
        center.addObserver(forName: .EAAccessoryDidDisconnect, object: nil, queue: nil) { note in
          if let accessory = note.userInfo?[EAAccessoryKey] as? EAAccessory {
            disconnected(EAAccessoryAdapter(accessory))
          }
        },
      ]
    }

    func stopObserving() {
      guard !observers.isEmpty else { return }
      observers.forEach(NotificationCenter.default.removeObserver)
      observers = []
      EAAccessoryManager.shared().unregisterForLocalNotifications()
    }

    func showPicker(nameFilter: String?, completion: @escaping (PickerOutcome) -> Void) {
      let predicate = nameFilter.map { NSPredicate(format: "SELF CONTAINS[c] %@", $0) }
      EAAccessoryManager.shared().showBluetoothAccessoryPicker(withNameFilter: predicate) { error in
        guard let error = error else {
          completion(.selected)
          return
        }
        guard let pickerError = error as? EABluetoothAccessoryPickerError else {
          completion(.failed(error))
          return
        }
        switch pickerError.code {
        case .alreadyConnected: completion(.alreadyConnected)
        case .resultCancelled: completion(.cancelled)
        case .resultNotFound: completion(.notFound)
        default: completion(.failed(error))
        }
      }
    }
  }

  /// Opens `EASession`s. The session's streams are scheduled on the thread that opens them.
  final class EASessionTransport: AccessoryTransport {
    func openSession(_ accessory: Accessory, protocolString: String) -> SessionStreams? {
      guard
        let adapter = accessory as? EAAccessoryAdapter,
        let session = EASession(accessory: adapter.accessory, forProtocol: protocolString),
        let input = session.inputStream,
        let output = session.outputStream
      else { return nil }
      return StreamPair(input: input, output: output, owner: session)
    }
  }
#endif
