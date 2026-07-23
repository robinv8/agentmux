import Foundation

public struct OneShotRunResult: Equatable, Sendable {
    public let exitCode: Int32
    public let stdout: String
    public let stderr: String
    public var succeeded: Bool { exitCode == 0 }

    public init(exitCode: Int32, stdout: String, stderr: String) {
        self.exitCode = exitCode
        self.stdout = stdout
        self.stderr = stderr
    }
}

/// Abstraction over process launch so unit tests inject a fake runner.
public protocol ProcessRunning: Sendable {
    func run(
        executable: URL,
        arguments: [String],
        environment: [String: String],
        currentDirectory: URL?,
        onStdout: @escaping @Sendable (String) -> Void,
        onStderr: @escaping @Sendable (String) -> Void
    ) async throws -> Int32
}

/// Real Foundation.Process implementation.
public struct FoundationProcessRunner: ProcessRunning {
    public init() {}

    public func run(
        executable: URL,
        arguments: [String],
        environment: [String: String],
        currentDirectory: URL?,
        onStdout: @escaping @Sendable (String) -> Void,
        onStderr: @escaping @Sendable (String) -> Void
    ) async throws -> Int32 {
        try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            process.executableURL = executable
            process.arguments = arguments
            process.environment = environment
            if let currentDirectory {
                process.currentDirectoryURL = currentDirectory
            }

            let outPipe = Pipe()
            let errPipe = Pipe()
            process.standardOutput = outPipe
            process.standardError = errPipe

            outPipe.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
                onStdout(text)
            }
            errPipe.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
                onStderr(text)
            }

            process.terminationHandler = { proc in
                outPipe.fileHandleForReading.readabilityHandler = nil
                errPipe.fileHandleForReading.readabilityHandler = nil
                // Drain remaining
                let restOut = outPipe.fileHandleForReading.readDataToEndOfFile()
                if !restOut.isEmpty, let text = String(data: restOut, encoding: .utf8) {
                    onStdout(text)
                }
                let restErr = errPipe.fileHandleForReading.readDataToEndOfFile()
                if !restErr.isEmpty, let text = String(data: restErr, encoding: .utf8) {
                    onStderr(text)
                }
                continuation.resume(returning: proc.terminationStatus)
            }

            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }
}

public struct OneShotRunner: Sendable {
    private let processRunner: any ProcessRunning

    public init(processRunner: any ProcessRunning = FoundationProcessRunner()) {
        self.processRunner = processRunner
    }

    public func run(
        _ invocation: OneShotInvocation,
        onStdout: @escaping @Sendable (String) -> Void = { _ in },
        onStderr: @escaping @Sendable (String) -> Void = { _ in }
    ) async throws -> OneShotRunResult {
        let launch = AgentMuxExecutableLocator.processLaunch(for: invocation.executable)
        var args = launch.prefixArgs + invocation.arguments
        let executable = launch.executable

        // If we fell back to /usr/bin/env for bun, prefix with "bun"
        if executable.path == "/usr/bin/env", invocation.executable.pathExtension == "js" {
            args = ["bun"] + launch.prefixArgs + invocation.arguments
        }

        final class Box: @unchecked Sendable {
            var stdout = ""
            var stderr = ""
            let lock = NSLock()
        }
        let box = Box()

        let code = try await processRunner.run(
            executable: executable,
            arguments: args,
            environment: invocation.environment,
            currentDirectory: invocation.currentDirectory,
            onStdout: { chunk in
                box.lock.lock(); box.stdout += chunk; box.lock.unlock()
                onStdout(chunk)
            },
            onStderr: { chunk in
                box.lock.lock(); box.stderr += chunk; box.lock.unlock()
                onStderr(chunk)
            }
        )

        return OneShotRunResult(exitCode: code, stdout: box.stdout, stderr: box.stderr)
    }
}
