// swift-tools-version:5.9
// The platform-neutral Swift core of the iOS module, as a package so XCTest
// can run it without an app: `swift test` here. CocoaPods compiles the same
// sources into the pod (see the podspec) and skips this file and Tests/.
import PackageDescription

let package = Package(
  name: "BluetoothClassicCore",
  platforms: [.iOS(.v15), .macOS(.v12)],
  products: [.library(name: "BluetoothClassicCore", targets: ["BluetoothClassicCore"])],
  targets: [
    .target(name: "BluetoothClassicCore"),
    .testTarget(name: "BluetoothClassicCoreTests", dependencies: ["BluetoothClassicCore"]),
  ]
)
