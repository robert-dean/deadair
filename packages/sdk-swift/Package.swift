// swift-tools-version:5.9
// Created once by @contractkit/plugin-swift and owned here from then on: it is never regenerated,
// which is why `scaffold` is off in `apps/api/contractkit.config.json`.
//
// The floors are the iOS app's and the Mac that runs its tests, rather than the scaffold's older
// ones, because nothing else consumes this package. macOS is here so `swift build` and
// `swift test` can compile the SDK on the host without a simulator, which is the fast gate CI runs
// first.
import PackageDescription

let package = Package(
    name: "DeadairSdk",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "DeadairSdk", targets: ["DeadairSdk"]),
    ],
    targets: [
        .target(name: "DeadairSdk"),
    ]
)
