// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AgentMuxMac",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .library(name: "AgentMuxKit", targets: ["AgentMuxKit"]),
        .executable(name: "AgentMuxApp", targets: ["AgentMuxApp"]),
    ],
    targets: [
        .target(
            name: "AgentMuxKit",
            path: "Sources/AgentMuxKit"
        ),
        .executableTarget(
            name: "AgentMuxApp",
            dependencies: ["AgentMuxKit"],
            path: "Sources/AgentMuxApp"
        ),
        .testTarget(
            name: "AgentMuxKitTests",
            dependencies: ["AgentMuxKit"],
            path: "Tests/AgentMuxKitTests"
        ),
    ]
)
