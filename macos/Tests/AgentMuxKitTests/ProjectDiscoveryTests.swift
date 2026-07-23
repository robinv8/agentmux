import XCTest
@testable import AgentMuxKit

final class ProjectDiscoveryTests: XCTestCase {
    func testDiscoversDirectChildDirectories() throws {
        let fixtures = try fixturesProjectsRoot()
        let projects = try ProjectDiscovery.discover(
            options: .init(projectsRoot: fixtures)
        )
        let names = Set(projects.map(\.name))
        XCTAssertTrue(names.contains("alpha"), "expected alpha in \(names)")
        XCTAssertTrue(names.contains("beta"), "expected beta in \(names)")
        for p in projects {
            XCTAssertTrue(p.cwd.path.hasPrefix(fixtures.path))
        }
    }

    func testSkipsHiddenAndFiles() throws {
        let temp = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentmux-disc-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temp) }

        try FileManager.default.createDirectory(
            at: temp.appendingPathComponent("visible", isDirectory: true),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: temp.appendingPathComponent(".hidden", isDirectory: true),
            withIntermediateDirectories: true
        )
        try "file".write(
            to: temp.appendingPathComponent("not-a-dir.txt"),
            atomically: true,
            encoding: .utf8
        )
        try FileManager.default.createDirectory(
            at: temp.appendingPathComponent("node_modules", isDirectory: true),
            withIntermediateDirectories: true
        )

        let projects = try ProjectDiscovery.discover(options: .init(projectsRoot: temp))
        let names = projects.map(\.name)
        XCTAssertEqual(names, ["visible"])
    }

    func testMissingRootThrows() {
        let missing = URL(fileURLWithPath: "/no/such/agentmux/projects-\(UUID().uuidString)")
        XCTAssertThrowsError(
            try ProjectDiscovery.discover(options: .init(projectsRoot: missing))
        )
    }

    private func fixturesProjectsRoot() throws -> URL {
        // Prefer package-relative Fixtures next to Tests
        let thisFile = URL(fileURLWithPath: #filePath)
        let candidates = [
            thisFile
                .deletingLastPathComponent() // AgentMuxKitTests
                .deletingLastPathComponent() // Tests
                .appendingPathComponent("Fixtures/Projects", isDirectory: true),
            thisFile
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("Fixtures/Projects", isDirectory: true),
            URL(fileURLWithPath: #filePath)
                .deletingLastPathComponent()
                .appendingPathComponent("Fixtures/Projects", isDirectory: true),
        ]
        for url in candidates {
            var isDir: ObjCBool = false
            if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue {
                return url
            }
        }
        // Create ephemeral fixture if package resources layout differs
        let temp = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentmux-fx-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: temp.appendingPathComponent("alpha", isDirectory: true),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: temp.appendingPathComponent("beta", isDirectory: true),
            withIntermediateDirectories: true
        )
        return temp
    }
}
