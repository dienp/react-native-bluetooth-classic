#if canImport(UIKit) && canImport(ExternalAccessory)
  import Foundation
  import UIKit

  /// The Objective-C face of the Swift core, called by `RNBluetoothClassic.mm`.
  /// Each method settles its promise exactly once and never throws; after
  /// `invalidate()` nothing is settled or emitted.
  @objc(RNBCCore)
  public final class RNBCCore: NSObject {
    public typealias Resolve = (Any?) -> Void
    public typealias Reject = (String, String, [String: Any]) -> Void

    private let ioThread: RunLoopThread
    private let core: ModuleCore
    private var observers: [NSObjectProtocol] = []

    /// `emit` receives the event name (such as `onData`) and its body, on any thread.
    @objc public init(emit: @escaping (String, [String: Any]) -> Void) {
      ioThread = RunLoopThread(name: "RNBluetoothClassic-io")
      core = ModuleCore(
        environment: ModuleEnvironment(
          osVersion: RNBCCore.osVersion(),
          declaredProtocols: Capabilities.declaredProtocols(in: Bundle.main.infoDictionary),
          accessoryManager: EAManagerAdapter(),
          transport: EASessionTransport(),
          executor: ioThread,
          onMain: { block in
            if Thread.isMainThread { block() } else { DispatchQueue.main.async(execute: block) }
          },
          openSettings: { completion in
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
              completion(false)
              return
            }
            UIApplication.shared.open(url, options: [:], completionHandler: completion)
          }
        ),
        emit: emit
      )
      super.init()
      // Accessory notifications are delivered on the main thread.
      DispatchQueue.main.async { [weak self] in self?.core.start() }
      observers.append(
        NotificationCenter.default.addObserver(
          forName: UIApplication.didBecomeActiveNotification,
          object: nil,
          queue: nil
        ) { [weak self] _ in self?.core.appDidBecomeActive() }
      )
    }

    /// Like `UIDevice.systemVersion`, without touching UIKit off the main thread.
    private static func osVersion() -> String {
      let version = ProcessInfo.processInfo.operatingSystemVersion
      return version.patchVersion == 0
        ? "\(version.majorVersion).\(version.minorVersion)"
        : "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
    }

    private func promise(_ operation: String, _ resolve: @escaping Resolve, _ reject: @escaping Reject) -> Promise {
      Promise(operation, resolve: resolve, reject: reject)
    }

    @objc public func invalidate() {
      observers.forEach(NotificationCenter.default.removeObserver)
      observers = []
      core.invalidate()
      // After the shutdown the invalidation queued on it.
      ioThread.stop()
    }

    @objc public func capabilities() -> [String: Any] {
      core.capabilities()
    }

    @objc(setLogLevel:)
    public func setLogLevel(_ level: String) {
      core.setLogLevel(level)
    }

    @objc(unsupported:resolve:reject:)
    public func unsupported(_ operation: String, resolve: @escaping Resolve, reject: @escaping Reject) {
      core.unsupported(operation, promise(operation, resolve, reject))
    }

    @objc(checkPermissions:resolve:reject:)
    public func checkPermissions(_ scope: String, resolve: @escaping Resolve, reject: @escaping Reject) {
      core.checkPermissions(scope, promise("checkPermissions", resolve, reject))
    }

    @objc(getConnectedAccessoriesWithResolve:reject:)
    public func getConnectedAccessories(resolve: @escaping Resolve, reject: @escaping Reject) {
      core.getConnectedAccessories(promise("getConnectedAccessories", resolve, reject))
    }

    @objc(showAccessoryPicker:resolve:reject:)
    public func showAccessoryPicker(_ nameFilter: String?, resolve: @escaping Resolve, reject: @escaping Reject) {
      core.showAccessoryPicker(nameFilter: nameFilter, promise("showAccessoryPicker", resolve, reject))
    }

    @objc(openSettingsWithResolve:reject:)
    public func openSettings(resolve: @escaping Resolve, reject: @escaping Reject) {
      core.openSettings(promise("openSettings", resolve, reject))
    }

    @objc(connect:deviceId:protocolString:timeoutMs:resolve:reject:)
    public func connect(
      _ operationId: String,
      deviceId: String,
      protocolString: String?,
      timeoutMs: Double,
      resolve: @escaping Resolve,
      reject: @escaping Reject
    ) {
      core.connect(
        operationId: operationId,
        deviceId: deviceId,
        protocolString: protocolString,
        timeoutMs: timeoutMs,
        promise("connect", resolve, reject)
      )
    }

    @objc(cancelOperation:resolve:reject:)
    public func cancelOperation(_ operationId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
      core.cancelOperation(operationId, promise("cancelOperation", resolve, reject))
    }

    @objc(getConnectionsWithResolve:reject:)
    public func getConnections(resolve: @escaping Resolve, reject: @escaping Reject) {
      core.getConnections(promise("getConnections", resolve, reject))
    }

    @objc(write:data:timeoutMs:resolve:reject:)
    public func write(
      _ connectionId: String,
      data: String,
      timeoutMs: Double,
      resolve: @escaping Resolve,
      reject: @escaping Reject
    ) {
      core.write(connectionId: connectionId, base64: data, timeoutMs: timeoutMs, promise("write", resolve, reject))
    }

    @objc(disconnect:timeoutMs:resolve:reject:)
    public func disconnect(
      _ connectionId: String,
      timeoutMs: Double,
      resolve: @escaping Resolve,
      reject: @escaping Reject
    ) {
      core.disconnect(connectionId: connectionId, timeoutMs: timeoutMs, promise("disconnect", resolve, reject))
    }

    @objc(closeWithError:code:message:resolve:reject:)
    public func closeWithError(
      _ connectionId: String,
      code: String,
      message: String,
      resolve: @escaping Resolve,
      reject: @escaping Reject
    ) {
      core.closeWithError(
        connectionId: connectionId,
        code: code,
        message: message,
        promise("closeWithError", resolve, reject)
      )
    }
  }
#endif
