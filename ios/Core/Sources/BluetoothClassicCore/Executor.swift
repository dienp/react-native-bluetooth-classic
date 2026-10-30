import Foundation

protocol Cancellable {
  func cancel()
}

/// Where session state lives. Every session and the connection manager are
/// confined to one executor: in the app, the I/O thread whose run loop the
/// streams are scheduled on; in tests, a queue the test drains by hand.
protocol Executor: AnyObject {
  func async(_ block: @escaping () -> Void)
  func schedule(after seconds: TimeInterval, _ block: @escaping () -> Void) -> Cancellable
}

#if canImport(ObjectiveC)
  /// A dedicated thread with its own run loop. Streams are scheduled on that
  /// run loop, so their callbacks, and every block passed to `async`, run on
  /// this one thread.
  final class RunLoopThread: NSObject, Executor {
    private final class Block: NSObject {
      let run: () -> Void
      init(_ run: @escaping () -> Void) { self.run = run }
    }

    private final class TimerHandle: Cancellable {
      weak var owner: RunLoopThread?
      let timer: Timer
      init(owner: RunLoopThread, timer: Timer) {
        self.owner = owner
        self.timer = timer
      }

      // A timer must be invalidated on the thread it was scheduled on.
      func cancel() {
        let timer = self.timer
        owner?.async { timer.invalidate() }
      }
    }

    private var thread: Thread!
    private let started = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var stopped = false

    init(name: String) {
      super.init()
      thread = Thread { [unowned self] in self.main() }
      thread.name = name
      thread.qualityOfService = .userInitiated
      thread.start()
      started.wait()
    }

    var isCurrent: Bool { Thread.current === thread }

    private func main() {
      // A port keeps the run loop alive while nothing else is scheduled.
      RunLoop.current.add(Port(), forMode: .default)
      started.signal()
      while !isStopped {
        _ = RunLoop.current.run(mode: .default, before: .distantFuture)
      }
    }

    private var isStopped: Bool {
      lock.lock()
      defer { lock.unlock() }
      return stopped
    }

    func async(_ block: @escaping () -> Void) {
      perform(#selector(run(_:)), on: thread, with: Block(block), waitUntilDone: false)
    }

    func schedule(after seconds: TimeInterval, _ block: @escaping () -> Void) -> Cancellable {
      let timer = Timer(timeInterval: seconds, repeats: false) { _ in block() }
      async { RunLoop.current.add(timer, forMode: .default) }
      return TimerHandle(owner: self, timer: timer)
    }

    /// Lets the thread exit once the blocks already queued have run.
    func stop() {
      async { [weak self] in
        guard let self = self else { return }
        self.lock.lock()
        self.stopped = true
        self.lock.unlock()
        CFRunLoopStop(CFRunLoopGetCurrent())
      }
    }

    @objc private func run(_ block: Any) {
      (block as? Block)?.run()
    }
  }
#endif
