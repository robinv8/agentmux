import Foundation

/// Fully specified process launch for `am <project> <message...>` one-shot.
public struct OneShotInvocation: Equatable, Sendable {
    public let executable: URL
    public let arguments: [String]
    public let environment: [String: String]
    public let currentDirectory: URL?

    public init(
        executable: URL,
        arguments: [String],
        environment: [String: String],
        currentDirectory: URL? = nil
    ) {
        self.executable = executable
        self.arguments = arguments
        self.environment = environment
        self.currentDirectory = currentDirectory
    }
}

public enum OneShotInvocationBuilder {
    /// Build argv/env for the AgentMux CLI one-shot path.
    /// Equivalent to: `am <projectName> <message...>`
    public static func build(
        projectName: String,
        message: String,
        projectsRoot: URL,
        agentMuxExecutable: URL,
        baseEnvironment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> OneShotInvocation {
        let trimmedProject = projectName.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedMessage = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedProject.isEmpty else {
            throw InvocationError.emptyProject
        }
        guard !trimmedMessage.isEmpty else {
            throw InvocationError.emptyMessage
        }

        var env = baseEnvironment
        env["AGENTMUX_PROJECTS_ROOT"] = projectsRoot.path

        // CLI: am <project> <message words...> — pass message as a single trailing arg when possible
        // to preserve spaces; the Node CLI joins rest with spaces.
        let arguments = [trimmedProject, trimmedMessage]

        return OneShotInvocation(
            executable: agentMuxExecutable,
            arguments: arguments,
            environment: env,
            currentDirectory: nil
        )
    }
}

public enum InvocationError: Error, Equatable, LocalizedError {
    case emptyProject
    case emptyMessage
    case executableNotFound

    public var errorDescription: String? {
        switch self {
        case .emptyProject: return "Project name is empty"
        case .emptyMessage: return "Task message is empty"
        case .executableNotFound: return "AgentMux executable (am) not found"
        }
    }
}

/// Resolves the `am` / `agentmux` binary on disk.
public enum AgentMuxExecutableLocator {
    public static func locate(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default,
        home: URL? = nil
    ) -> URL? {
        if let explicit = environment["AGENTMUX_BIN"], !explicit.isEmpty {
            let url = URL(fileURLWithPath: (explicit as NSString).expandingTildeInPath)
            if fileManager.isExecutableFile(atPath: url.path) || fileManager.fileExists(atPath: url.path) {
                return url
            }
        }

        let homeURL = home ?? fileManager.homeDirectoryForCurrentUser
        let candidates: [URL] = [
            homeURL.appendingPathComponent(".local/bin/am"),
            homeURL.appendingPathComponent(".local/bin/agentmux"),
            homeURL.appendingPathComponent(".agentmux/bin/agentmux.js"),
            homeURL.appendingPathComponent("Projects/agentmux/bin/agentmux.js"),
        ]

        for url in candidates {
            if fileManager.fileExists(atPath: url.path) {
                return url
            }
        }

        // Search PATH
        if let path = environment["PATH"] {
            for dir in path.split(separator: ":") {
                for name in ["am", "agentmux"] {
                    let url = URL(fileURLWithPath: String(dir)).appendingPathComponent(String(name))
                    if fileManager.fileExists(atPath: url.path) {
                        return url
                    }
                }
            }
        }
        return nil
    }

    /// Process executable + args when the entry is a JS file needing Bun.
    public static func processLaunch(for executable: URL) -> (executable: URL, prefixArgs: [String]) {
        if executable.pathExtension == "js" {
            let bun = resolveBun()
            return (bun, [executable.path])
        }
        return (executable, [])
    }

    private static func resolveBun() -> URL {
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser
        let candidates = [
            home.appendingPathComponent(".bun/bin/bun"),
            URL(fileURLWithPath: "/usr/local/bin/bun"),
            URL(fileURLWithPath: "/opt/homebrew/bin/bun"),
        ]
        for c in candidates where fm.fileExists(atPath: c.path) {
            return c
        }
        return URL(fileURLWithPath: "/usr/bin/env") // last resort; args must include "bun"
    }
}
