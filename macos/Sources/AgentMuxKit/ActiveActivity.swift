import Foundation

/// One row in the "活跃 Agents" rail — live work or live local sessions.
public struct ActiveActivity: Identifiable, Equatable, Sendable {
    public enum Status: String, Sendable {
        case running
        case done
        case idle
    }

    public enum Source: String, Sendable {
        /// Super Agent just dispatched a worker tool
        case superJob
        /// Detected local CLI process / session (grok, codex, …)
        case localSession
    }

    public let id: String
    public var title: String
    public var subtitle: String
    public var status: Status
    public var source: Source
    public var agentId: String
    public var project: String?
    public var detail: String?
    public var updatedAt: Date

    public init(
        id: String,
        title: String,
        subtitle: String,
        status: Status,
        source: Source,
        agentId: String,
        project: String? = nil,
        detail: String? = nil,
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.status = status
        self.source = source
        self.agentId = agentId
        self.project = project
        self.detail = detail
        self.updatedAt = updatedAt
    }
}

public enum ActiveActivityBuilder {
    /// Build activity rows from `am agents --json` style rows (running only).
    public static func fromLocalAgents(_ agents: [LocalAgentRow]) -> [ActiveActivity] {
        var out: [ActiveActivity] = []
        for agent in agents where agent.runningCount > 0 {
            let sessionNotes = agent.notes.filter { $0.hasPrefix("session:") }
            if !sessionNotes.isEmpty {
                for (i, note) in sessionNotes.enumerated() {
                    // session: /path (pid 123)
                    let project = Self.projectFromSessionNote(note)
                    out.append(
                        ActiveActivity(
                            id: "local-\(agent.agentId)-\(i)",
                            title: agent.name,
                            subtitle: project.map { "项目 · \($0)" } ?? "运行中",
                            status: .running,
                            source: .localSession,
                            agentId: agent.agentId,
                            project: project,
                            detail: note.replacingOccurrences(of: "session: ", with: "")
                        )
                    )
                }
            } else {
                out.append(
                    ActiveActivity(
                        id: "local-\(agent.agentId)",
                        title: agent.name,
                        subtitle: "\(agent.runningCount) 个进程在线",
                        status: .running,
                        source: .localSession,
                        agentId: agent.agentId,
                        detail: (agent.path ?? "") + " · 进程存活≠生成完毕（外部 TUI 仅能检测进程）"
                    )
                )
            }
        }
        return out
    }

    private static func projectFromSessionNote(_ note: String) -> String? {
        // session: /Users/.../Projects/foo (pid 1)
        guard let range = note.range(of: "Projects/") else {
            // take last path component before " (pid"
            if let pathPart = note.split(separator: " ").dropFirst().first {
                return URL(fileURLWithPath: String(pathPart)).lastPathComponent
            }
            return nil
        }
        let rest = note[range.upperBound...]
        let name = rest.split(separator: " ").first.map(String.init)
        return name
    }
}
