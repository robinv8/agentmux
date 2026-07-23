import XCTest
@testable import AgentMuxKit

/// Fake process that never touches the real filesystem agent.
struct FakeProcessRunner: ProcessRunning {
    let exitCode: Int32
    let stdoutChunks: [String]
    let stderrChunks: [String]

    init(
        exitCode: Int32 = 0,
        stdoutChunks: [String] = ["hello-from-fake-agent\n"],
        stderrChunks: [String] = []
    ) {
        self.exitCode = exitCode
        self.stdoutChunks = stdoutChunks
        self.stderrChunks = stderrChunks
    }

    func run(
        executable: URL,
        arguments: [String],
        environment: [String: String],
        currentDirectory: URL?,
        onStdout: @escaping @Sendable (String) -> Void,
        onStderr: @escaping @Sendable (String) -> Void
    ) async throws -> Int32 {
        _ = executable
        _ = arguments
        _ = environment
        _ = currentDirectory
        for chunk in stdoutChunks { onStdout(chunk) }
        for chunk in stderrChunks { onStderr(chunk) }
        return exitCode
    }
}

final class OneShotRunnerTests: XCTestCase {
    func testRunnerCapturesStdoutAndSuccess() async throws {
        let fake = FakeProcessRunner(
            exitCode: 0,
            stdoutChunks: ["line-a\n", "line-b\n"],
            stderrChunks: ["note\n"]
        )
        let runner = OneShotRunner(processRunner: fake)
        let inv = OneShotInvocation(
            executable: URL(fileURLWithPath: "/usr/bin/true"),
            arguments: ["alpha", "do stuff"],
            environment: ["AGENTMUX_PROJECTS_ROOT": "/tmp/Projects"],
            currentDirectory: nil
        )

        var streamed = ""
        let result = try await runner.run(inv, onStdout: { streamed += $0 }, onStderr: { streamed += $0 })

        XCTAssertTrue(result.succeeded)
        XCTAssertEqual(result.exitCode, 0)
        XCTAssertTrue(result.stdout.contains("line-a"))
        XCTAssertTrue(result.stdout.contains("line-b"))
        XCTAssertTrue(result.stderr.contains("note"))
        XCTAssertTrue(streamed.contains("line-a"))
        XCTAssertTrue(streamed.contains("note"))
    }

    func testRunnerReportsFailureExitCode() async throws {
        let fake = FakeProcessRunner(exitCode: 7, stdoutChunks: ["partial\n"])
        let runner = OneShotRunner(processRunner: fake)
        let inv = OneShotInvocation(
            executable: URL(fileURLWithPath: "/usr/bin/false"),
            arguments: ["beta", "x"],
            environment: [:],
            currentDirectory: nil
        )
        let result = try await runner.run(inv)
        XCTAssertFalse(result.succeeded)
        XCTAssertEqual(result.exitCode, 7)
        XCTAssertTrue(result.stdout.contains("partial"))
    }
}
