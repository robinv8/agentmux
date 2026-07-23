import XCTest
@testable import AgentMuxKit

final class OneShotInvocationTests: XCTestCase {
    func testBuildsAmStyleArgumentsAndProjectsRootEnv() throws {
        let root = URL(fileURLWithPath: "/Users/me/Projects", isDirectory: true)
        let exe = URL(fileURLWithPath: "/Users/me/.local/bin/am")
        let inv = try OneShotInvocationBuilder.build(
            projectName: "md-converter",
            message: "summarize README",
            projectsRoot: root,
            agentMuxExecutable: exe,
            baseEnvironment: ["PATH": "/usr/bin", "KEEP": "1"]
        )

        XCTAssertEqual(inv.executable, exe)
        XCTAssertEqual(inv.arguments, ["md-converter", "summarize README"])
        XCTAssertEqual(inv.environment["AGENTMUX_PROJECTS_ROOT"], root.path)
        XCTAssertEqual(inv.environment["KEEP"], "1")
    }

    func testRejectsEmptyProjectOrMessage() {
        let root = URL(fileURLWithPath: "/p", isDirectory: true)
        let exe = URL(fileURLWithPath: "/bin/am")
        XCTAssertThrowsError(
            try OneShotInvocationBuilder.build(
                projectName: "  ",
                message: "x",
                projectsRoot: root,
                agentMuxExecutable: exe,
                baseEnvironment: [:]
            )
        )
        XCTAssertThrowsError(
            try OneShotInvocationBuilder.build(
                projectName: "alpha",
                message: "   ",
                projectsRoot: root,
                agentMuxExecutable: exe,
                baseEnvironment: [:]
            )
        )
    }

    func testJsExecutableUsesBunPrefix() {
        let js = URL(fileURLWithPath: "/Users/me/Projects/agentmux/bin/agentmux.js")
        let launch = AgentMuxExecutableLocator.processLaunch(for: js)
        XCTAssertFalse(launch.prefixArgs.isEmpty)
        XCTAssertEqual(launch.prefixArgs.last, js.path)
    }
}
