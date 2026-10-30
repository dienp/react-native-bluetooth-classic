import Foundation

enum StreamSide {
  case input
  case output
}

/// What a session's streams report. Mirrors `Stream.Event`.
enum StreamEvent {
  case openCompleted(StreamSide)
  case hasBytesAvailable
  case hasSpaceAvailable
  case endEncountered(StreamSide)
  case errorOccurred(StreamSide, Error?)
}

protocol SessionStreamsDelegate: AnyObject {
  func streams(didReceive event: StreamEvent)
}

/// The input and output streams of one accessory session. Every call, and
/// every delegate callback, happens on the session's executor.
protocol SessionStreams: AnyObject {
  var delegate: SessionStreamsDelegate? { get set }

  /// Schedules both streams on the current run loop and opens them.
  func open()
  /// Closes both streams and removes them from the run loop. Idempotent.
  func close()

  var hasBytesAvailable: Bool { get }
  func read(_ buffer: UnsafeMutablePointer<UInt8>, maxLength: Int) -> Int
  var hasSpaceAvailable: Bool { get }
  func write(_ buffer: UnsafePointer<UInt8>, maxLength: Int) -> Int
  var streamError: Error? { get }
}

/// Opens accessory sessions. In the app it creates an `EASession`; tests use a fake.
protocol AccessoryTransport: AnyObject {
  /// The streams of a new session, or `nil` when the OS refuses to open one.
  func openSession(_ accessory: Accessory, protocolString: String) -> SessionStreams?
}

/// A Foundation stream pair, such as an `EASession`'s, scheduled on the run
/// loop of the thread that opens it. `owner` keeps the session alive until
/// the streams are closed.
final class StreamPair: NSObject, SessionStreams, StreamDelegate {
  weak var delegate: SessionStreamsDelegate?
  private let input: InputStream
  private let output: OutputStream
  private var owner: AnyObject?
  private var runLoop: RunLoop?

  init(input: InputStream, output: OutputStream, owner: AnyObject?) {
    self.input = input
    self.output = output
    self.owner = owner
  }

  func open() {
    let runLoop = RunLoop.current
    self.runLoop = runLoop
    for stream in [input as Stream, output as Stream] {
      stream.delegate = self
      stream.schedule(in: runLoop, forMode: .default)
      stream.open()
    }
  }

  func close() {
    guard let runLoop = runLoop else { return }
    self.runLoop = nil
    for stream in [input as Stream, output as Stream] {
      // The delegate is not retained by the stream, so drop it first.
      stream.delegate = nil
      stream.close()
      stream.remove(from: runLoop, forMode: .default)
    }
    owner = nil
  }

  var hasBytesAvailable: Bool { input.hasBytesAvailable }

  func read(_ buffer: UnsafeMutablePointer<UInt8>, maxLength: Int) -> Int {
    input.read(buffer, maxLength: maxLength)
  }

  var hasSpaceAvailable: Bool { output.hasSpaceAvailable }

  func write(_ buffer: UnsafePointer<UInt8>, maxLength: Int) -> Int {
    output.write(buffer, maxLength: maxLength)
  }

  var streamError: Error? { output.streamError ?? input.streamError }

  func stream(_ aStream: Stream, handle eventCode: Stream.Event) {
    let side: StreamSide = aStream === input ? .input : .output
    switch eventCode {
    case .openCompleted: delegate?.streams(didReceive: .openCompleted(side))
    case .hasBytesAvailable: delegate?.streams(didReceive: .hasBytesAvailable)
    case .hasSpaceAvailable: delegate?.streams(didReceive: .hasSpaceAvailable)
    case .endEncountered: delegate?.streams(didReceive: .endEncountered(side))
    case .errorOccurred: delegate?.streams(didReceive: .errorOccurred(side, aStream.streamError))
    default: break
    }
  }
}
