require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "dynlabs-react-native-bluetooth-classic"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/dienp/react-native-bluetooth-classic.git", :tag => "v#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift,cpp}"
  # ios/Core is also a Swift package for XCTest; its manifest and tests are not part of the pod.
  s.exclude_files = ["ios/Core/Package.swift", "ios/Core/Tests/**/*", "ios/Core/.build/**/*"]
  s.private_header_files = "ios/**/*.h"
  # Generates the Swift header that RNBluetoothClassic.mm imports.
  s.pod_target_xcconfig = { "DEFINES_MODULE" => "YES" }
  s.frameworks   = "ExternalAccessory"
  s.swift_version = "5.9"

  install_modules_dependencies(s)
end
