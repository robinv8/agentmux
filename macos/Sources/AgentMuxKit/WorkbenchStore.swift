import Foundation

public struct WorkbenchStation: Identifiable, Equatable, Sendable {
    public let id: String
    public let project: String?
    public let backend: String?
    public let task: String?
    public let status: String
    public let jobId: String?
    public let pendingQuestion: String?
    public let summary: String?
    public let error: String?
}

public struct WorkbenchSnapshot: Equatable, Sendable {
    public let id: String
    public let title: String
    public let stations: [WorkbenchStation]
}

public enum WorkbenchStore {
    public static func load(
        executable: URL,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) async throws -> WorkbenchSnapshot {
        let launch = AgentMuxExecutableLocator.processLaunch(for: executable)
        var args = launch.prefixArgs + ["workbench", "--json"]
        let exe = launch.executable
        if exe.path == "/usr/bin/env", executable.pathExtension == "js" {
            args = ["bun"] + launch.prefixArgs + ["workbench", "--json"]
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
            throw WorkbenchStoreError.failed(e.isEmpty ? "am workbench --json failed" : e)
        }
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw WorkbenchStoreError.failed("invalid workbench json")
        }
        let id = obj["id"] as? String ?? "wb"
        let title = obj["title"] as? String ?? "今日工作台"
        let rawStations = obj["stations"] as? [[String: Any]] ?? []
        let stations: [WorkbenchStation] = rawStations.compactMap { row in
            guard let sid = row["id"] as? String else { return nil }
            return WorkbenchStation(
                id: sid,
                project: row["project"] as? String,
                backend: row["backend"] as? String,
                task: row["task"] as? String,
                status: row["status"] as? String ?? "empty",
                jobId: row["jobId"] as? String,
                pendingQuestion: row["pendingQuestion"] as? String,
                summary: row["summary"] as? String,
                error: row["error"] as? String
            )
        }
        return WorkbenchSnapshot(id: id, title: title, stations: stations)
    }
}

public enum WorkbenchStoreError: Error, LocalizedError {
    case failed(String)
    public var errorDescription: String? {
        switch self {
        case .failed(let s): return s
        }
    }
}
