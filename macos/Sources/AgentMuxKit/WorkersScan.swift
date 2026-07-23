import Foundation

/// Headless worker backends Super Agent can dispatch (`am workers --json`).
public struct WorkerBrother: Identifiable, Equatable, Sendable {
    public var id: String { backendId }
    public let backendId: String
    public let name: String
    public let available: Bool
    public let path: String?

    public init(backendId: String, name: String, available: Bool, path: String?) {
        self.backendId = backendId
        self.name = name
        self.available = available
        self.path = path
    }
}

public enum WorkersScan {
    public static func scan(
        executable: URL,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) async throws -> [WorkerBrother] {
        let launch = AgentMuxExecutableLocator.processLaunch(for: executable)
        var args = launch.prefixArgs + ["workers", "--json"]
        let exe = launch.executable
        if exe.path == "/usr/bin/env", executable.pathExtension == "js" {
            args = ["bun"] + launch.prefixArgs + ["workers", "--json"]
        }

        let proc = Process()
        proc.executableURL = exe
        proc.arguments = args
        proc.environment = environment
        let out = Pipe()
        let err = Pipe()
        proc.standardOutput = out
        proc.standardError = err
        try proc.run()
        proc.waitUntilExit()
        let data = out.fileHandleForReading.readDataToEndOfFile()
        if proc.terminationStatus != 0 {
            let e = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            throw WorkersScanError.failed(e.isEmpty ? "am workers --json failed" : e)
        }
        guard let arr = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw WorkersScanError.failed("invalid workers json")
        }
        return arr.compactMap { row in
            guard let id = row["id"] as? String else { return nil }
            let name = (row["name"] as? String) ?? id
            return WorkerBrother(
                backendId: id,
                name: name,
                available: row["available"] as? Bool ?? false,
                path: row["path"] as? String
            )
        }
    }
}

public enum WorkersScanError: Error, LocalizedError {
    case failed(String)
    public var errorDescription: String? {
        switch self {
        case .failed(let s): return s
        }
    }
}
