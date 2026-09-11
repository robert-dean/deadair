// swift-tools-version:6.0
// Everything the iOS app decides that does not need a device to decide it: where a station is,
// which mount to play, how far through the record it is, when to retry, when the lock screen
// changes, what a session is worth, and what each screen says. Foundation and the SDK only, so
// `swift test` runs it on the Mac with no simulator, which is the same rule `apps/android` keeps
// by holding its pure logic free of `android.*`. The app target holds the rest and no tests.
import PackageDescription

let package = Package(
    name: "DeadairCore",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "DeadairCore", targets: ["DeadairCore"]),
    ],
    dependencies: [
        .package(path: "../../../../packages/sdk-swift"),
    ],
    targets: [
        .target(name: "DeadairCore", dependencies: [.product(name: "DeadairSdk", package: "sdk-swift")]),
        .testTarget(name: "DeadairCoreTests", dependencies: ["DeadairCore"]),
    ]
)
