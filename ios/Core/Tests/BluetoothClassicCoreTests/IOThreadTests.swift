#if canImport(ObjectiveC)
  import Foundation
  import XCTest
  @testable import BluetoothClassicCore

  /// 7.5: real Foundation streams on the I/O thread's run loop.
  final class IOThreadTests: XCTestCase {
    /// Records each stream event and the thread it arrived on.
    private final class Recorder: SessionStreamsDelegate {
      let thread: RunLoopThread
      var events: [String] = []
      var offThread = 0
      let opened = XCTestExpectation(description: "both streams open")
      let readable = XCTestExpectation(description: "bytes available")
      private var openCount = 0

      init(_ thread: RunLoopThread) { self.thread = thread }

      func streams(didReceive event: StreamEvent) {
        if !thread.isCurrent { offThread += 1 }
        switch event {
        case .openCompleted:
          events.append("open")
          openCount += 1
          if openCount == 2 { opened.fulfill() }
        case .hasBytesAvailable:
          events.append("bytes")
          readable.fulfill()
        case .hasSpaceAvailable: events.append("space")
        case .endEncountered: events.append("end")
        case .errorOccurred: events.append("error")
        }
      }
    }

    func testEveryStreamCallbackAndBlockRunsOnTheIOThread() {
      let thread = RunLoopThread(name: "test-io")
      defer { thread.stop() }
      var input: InputStream?
      var output: OutputStream?
      // The accessory end of a loopback: what the session writes comes back to it.
      Stream.getBoundStreams(withBufferSize: 1024, inputStream: &input, outputStream: &output)
      let streams = StreamPair(input: input!, output: output!, owner: nil)
      let recorder = Recorder(thread)

      let scheduled = expectation(description: "open ran on the I/O thread")
      thread.async {
        XCTAssertTrue(thread.isCurrent)
        streams.delegate = recorder
        streams.open()
        scheduled.fulfill()
      }
      wait(for: [scheduled, recorder.opened], timeout: 5)

      let wrote = expectation(description: "write ran")
      thread.async {
        let bytes: [UInt8] = [0x1B, 0x40]
        XCTAssertEqual(streams.write(bytes, maxLength: bytes.count), 2)
        wrote.fulfill()
      }
      wait(for: [wrote, recorder.readable], timeout: 5)

      let read = expectation(description: "read ran")
      thread.async {
        var buffer = [UInt8](repeating: 0, count: 8)
        XCTAssertEqual(streams.read(&buffer, maxLength: buffer.count), 2)
        XCTAssertEqual(Array(buffer.prefix(2)), [0x1B, 0x40])
        streams.close()
        read.fulfill()
      }
      wait(for: [read], timeout: 5)

      let fired = expectation(description: "timer fired")
      _ = thread.schedule(after: 0.01) {
        XCTAssertTrue(thread.isCurrent)
        fired.fulfill()
      }
      let cancelled = thread.schedule(after: 0.02) { XCTFail("a cancelled timer fired") }
      cancelled.cancel()
      wait(for: [fired], timeout: 5)
      Thread.sleep(forTimeInterval: 0.05)

      XCTAssertEqual(recorder.offThread, 0)
      XCTAssertTrue(recorder.events.contains("open"))
      XCTAssertTrue(recorder.events.contains("bytes"))
    }
  }
#endif
