import Foundation

public struct LocalAgentRow: Identifiable, Equatable, Sendable {
    public var id: String { agentId }
    public let agentId: String
    public let name: String
    public let available: Bool
    public let runningCount: Int
    public let dispatchable: Bool
    public let path: String?
    public let version: String?
    public let notes: [String]

    public init(
        agentId: String,
        name: String,
        available: Bool,
        runningCount: Int,
        dispatchable: Bool,
        path: String?,
        version: String?,
        notes: [String]
    ) {
        self.agentId = agentId
        self.name = name
        self.available = available
        self.runningCount = runningCount
        self.dispatchable = dispatchable
        self.path = path
        self.version = version
        self.notes = notes
    }
}

/// Runs `am agents` and parses a simple table-ish JSON dump.
/// We ask CLI for JSON via a small node one-liner isn't available — instead
/// spawn: `am agents` and also support `bun …/agentmux.js agents --json` if we add it.
public enum LocalAgentScan {
    public static func scan(
        executable: URL,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) async throws -> [LocalAgentRow] {
        // Prefer JSON mode for reliable parsing
        let launch = AgentMuxExecutableLocator.processLaunch(for: executable)
        var args = launch.prefixArgs + ["agents", "--json"]
        let exe = launch.executable
        if exe.path == "/usr/bin/env", executable.pathExtension == "js" {
            args = ["bun"] + launch.prefixArgs + ["agents", "--json"]
        }

        let proc = Process()
        proc.executableURL = exe
        proc.arguments = args
        var env = environment
        if env["KIMI_API_KEY"] == nil, let t = env["ANTHROPIC_AUTH_TOKEN"] {
            env["KIMI_API_KEY"] = t
        }
        proc.environment = env
        let out = Pipe()
        let err = Pipe()
        proc.standardOutput = out
        proc.standardError = err
        try proc.run()
        proc.waitUntilExit()
        let data = out.fileHandleForReading.readDataToEndOfFile()
        if proc.terminationStatus != 0 {
            let e = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            // fallback: parse plain table is hard — throw
            throw LocalAgentScanError.failed(e.isEmpty ? "am agents --json failed" : e)
        }
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw LocalAgentScanError.failed("invalid agents json")
        }
        return obj.compactMap { row in
            guard let id = row["id"] as? String, let name = row["name"] as? String else { return nil }
            return LocalAgentRow(
                agentId: id,
                name: name,
                available: row["available"] as? Bool ?? false,
                runningCount: row["runningCount"] as? Int ?? 0,
                dispatchable: row["dispatchable"] as? Bool ?? false,
                path: row["path"] as? String,
                version: row["version"] as? String,
                notes: row["notes"] as? [String] ?? []
            )
        }
    }
}

public enum LocalAgentScanError: Error, LocalizedError {
    case failed(String)
    public var errorDescription: String? {
        switch self {
        case .failed(let s): return s
        }
    }
}
