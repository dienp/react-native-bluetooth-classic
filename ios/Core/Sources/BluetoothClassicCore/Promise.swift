import Foundation

/// A promise that settles at most once. Every entry point wraps its resolve
/// and reject blocks in one, so a late or repeated callback is dropped.
final class Promise {
  typealias Resolve = (Any?) -> Void
  typealias Reject = (_ code: String, _ message: String, _ userInfo: [String: Any]) -> Void

  let operation: String
  private let lock = NSLock()
  private var settled = false
  private let onResolve: Resolve
  private let onReject: Reject

  init(_ operation: String, resolve: @escaping Resolve, reject: @escaping Reject) {
    self.operation = operation
    onResolve = resolve
    onReject = reject
  }

  var isSettled: Bool {
    lock.lock()
    defer { lock.unlock() }
    return settled
  }

  private func claim() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if settled { return false }
    settled = true
    return true
  }

  func resolve(_ value: Any? = nil) {
    guard claim() else { return }
    onResolve(value)
  }

  func reject(_ error: Error) {
    guard claim() else { return }
    let mapped = ErrorMapper.map(error)
    Log.debug("\(operation) rejected with \(mapped.code): \(mapped.message)")
    onReject(mapped.code, mapped.message, mapped.userInfo)
  }

  /// Drops the promise without settling it, for teardown: its JS runtime is gone.
  func abandon() {
    _ = claim()
  }
}

/// Runs `block` and turns anything it throws into a rejection of `promise`.
func guarded(_ promise: Promise, _ block: () throws -> Void) {
  do {
    try block()
  } catch {
    promise.reject(error)
  }
}
