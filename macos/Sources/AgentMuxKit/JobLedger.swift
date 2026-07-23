import Foundation

/// On-disk Super Agent jobs (`~/.agentmux/jobs/*.json`) — source of truth for completion.
public struct LedgerJob: Identifiable, Equatable, Sendable {
    public let id: String
    public let status: String
    public let kind: String
    public let project: String?
    public let message: String?
    public let summary: String?
    public let error: String?
    public let updatedAt: String?
    public let finishedAt: String?
    public let toolName: String?

    /// Backend extracted from toolName `run_in_project:grok` or summary `[grok]`
    public var backend: String? {
        if let toolName, toolName.contains(":") {
            return String(toolName.split(separator: ":").last ?? "")
        }
        if let summary, summary.hasPrefix("["),
           let end = summary.firstIndex(of: "]")
        {
            return String(summary[summary.index(after: summary.startIndex)..<end])
        }
        return nil
    }

    public var isTerminal: Bool {
        status == "done" || status == "failed"
    }

    public var isRunning: Bool {
        status == "running" || status == "queued"
    }
}

public enum JobLedger {
    public static func load(
        executable: URL,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) async throws -> [LedgerJob] {
        let launch = AgentMuxExecutableLocator.processLaunch(for: executable)
        var args = launch.prefixArgs + ["jobs", "--json"]
        let exe = launch.executable
        if exe.path == "/usr/bin/env", executable.pathExtension == "js" {
            args = ["bun"] + launch.prefixArgs + ["jobs", "--json"]
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
            throw JobLedgerError.failed(e.isEmpty ? "am jobs --json failed" : e)
        }
        guard let arr = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw JobLedgerError.failed("invalid jobs json")
        }
        return arr.compactMap { row in
            guard let id = row["id"] as? String,
                  let status = row["status"] as? String
            else { return nil }
            return LedgerJob(
                id: id,
                status: status,
                kind: row["kind"] as? String ?? "other",
                project: row["project"] as? String,
                message: row["message"] as? String,
                summary: row["summary"] as? String,
                error: row["error"] as? String,
                updatedAt: row["updatedAt"] as? String,
                finishedAt: row["finishedAt"] as? String,
                toolName: row["toolName"] as? String
            )
        }
    }
}

public enum JobLedgerError: Error, LocalizedError {
    case failed(String)
    public var errorDescription: String? {
        switch self {
        case .failed(let s): return s
        }
    }
}

public extension ActiveActivity {
    static func fromLedgerJobs(_ jobs: [LedgerJob]) -> [ActiveActivity] {
        jobs.prefix(30).map { job in
            let status: ActiveActivity.Status
            switch job.status {
            case "done": status = .done
            case "failed": status = .done
            case "running", "queued": status = .running
            default: status = .idle
            }
            let backend = job.backend ?? "worker"
            let title = backend.uppercased()
            let subtitle: String
            if job.status == "failed" {
                subtitle = job.project.map { "小弟 \(backend) · \($0) · 失败" } ?? "失败"
            } else if job.status == "done" {
                subtitle = job.project.map { "小弟 \(backend) · \($0) · 已完成" } ?? "已完成"
            } else {
                subtitle = job.project.map { "小弟 \(backend) · \($0) · 进行中" } ?? "进行中"
            }
            return ActiveActivity(
                id: "job-\(job.id)",
                title: title,
                subtitle: subtitle,
                status: status,
                source: .superJob,
                agentId: backend,
                project: job.project,
                detail: job.summary ?? job.error ?? job.message,
                updatedAt: ISO8601DateFormatter().date(from: job.updatedAt ?? "") ?? Date()
            )
        }
    }
}
