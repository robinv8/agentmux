import Foundation
import AgentMuxKit

@MainActor
final class AppModel: ObservableObject {
    @Published var lines: [ChatLine] = []
    @Published var draft: String = ""
    @Published var isBusy: Bool = false
    @Published var status: String = "Starting…"
    @Published var projectsRootPath: String
    @Published var errorBanner: String?

    @Published var activeActivities: [ActiveActivity] = []
    @Published var activityStatus: String = ""

    private var streamingAssistantID: UUID?
    private var session: SuperAgentSession?
    private var pollTask: Task<Void, Never>?
    private var knownJobStates: [String: String] = [:] // id -> status for completion toasts

    init() {
        let root = ProjectDiscovery.defaultProjectsRoot()
        self.projectsRootPath = root.path
    }

    func bootstrap() {
        errorBanner = nil
        refreshActiveAgents()
        startPolling()

        guard let executable = AgentMuxExecutableLocator.locate() else {
            errorBanner = "找不到 am / agentmux。请先安装 CLI。"
            status = "Missing am"
            append(.system, "Install AgentMux CLI, then reopen this app.")
            return
        }

        let root = URL(fileURLWithPath: projectsRootPath, isDirectory: true)
        let session = SuperAgentSession(
            executable: executable,
            projectsRoot: root,
            onEvent: { [weak self] line in
                Task { @MainActor in
                    self?.handleSessionLine(line)
                }
            }
        )
        self.session = session
        status = "Connecting Super Agent…"

        Task {
            do {
                try await session.start()
                status = "Super Agent ready"
                append(
                    .system,
                    "任务完成状态以左侧「任务台账」为准（磁盘 jobs）。可问：做完了吗？"
                )
            } catch {
                errorBanner = error.localizedDescription
                status = "Failed to start"
            }
        }
    }

    func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await MainActor.run { self?.refreshActiveAgents() }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    /// Poll job ledger + local agent processes. Jobs file is completion source of truth.
    func refreshActiveAgents() {
        guard let executable = AgentMuxExecutableLocator.locate() else {
            activityStatus = "无 am"
            return
        }
        Task {
            do {
                async let jobsTask = JobLedger.load(executable: executable)
                async let agentsTask = LocalAgentScan.scan(executable: executable)

                let jobs = try await jobsTask
                let agents = try await agentsTask

                // Completion notifications when status flips to done/failed
                for job in jobs {
                    let prev = knownJobStates[job.id]
                    if prev != job.status {
                        if job.status == "done" {
                            append(
                                .system,
                                "✅ 任务完成 · \(job.project ?? job.kind)：\((job.summary ?? "").prefix(120))"
                            )
                            status = "任务已完成"
                        } else if job.status == "failed" {
                            append(
                                .system,
                                "❌ 任务失败 · \(job.project ?? job.kind)：\((job.error ?? "").prefix(120))"
                            )
                            status = "任务失败"
                        } else if job.status == "running", prev == nil || prev == "queued" {
                            append(
                                .system,
                                "⏳ 任务开始 · \(job.project ?? job.kind)"
                            )
                        }
                        knownJobStates[job.id] = job.status
                    }
                }

                let fromJobs = ActiveActivity.fromLedgerJobs(jobs)
                let fromLocal = ActiveActivityBuilder.fromLocalAgents(agents)
                    .filter { $0.status == .running }

                // Prefer ledger jobs; append local TUI sessions
                var merged = fromJobs
                merged.append(contentsOf: fromLocal)
                var seen = Set<String>()
                activeActivities = merged.filter { seen.insert($0.id).inserted }

                let running = jobs.filter(\.isRunning).count
                let done = jobs.filter { $0.status == "done" }.count
                let failed = jobs.filter { $0.status == "failed" }.count
                if running == 0 && done == 0 && failed == 0 && fromLocal.isEmpty {
                    activityStatus = "暂无活跃任务"
                } else {
                    activityStatus =
                        "进行中 \(running + fromLocal.count) · 完成 \(done) · 失败 \(failed)"
                }
            } catch {
                activityStatus = "刷新失败"
            }
        }
    }

    func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isBusy else { return }
        guard let session else {
            errorBanner = "Super Agent 未启动"
            return
        }

        draft = ""
        isBusy = true
        status = "Super Agent 处理中…"
        append(.user, text)
        streamingAssistantID = nil

        Task {
            do {
                _ = try await session.sendUser(text)
                isBusy = false
                status = "本轮对话结束（任务状态见左侧）"
                streamingAssistantID = nil
                append(.system, "—— Super Agent 本轮回答结束 ——")
                // Immediate ledger refresh after turn
                refreshActiveAgents()
            } catch {
                isBusy = false
                status = "Error"
                errorBanner = error.localizedDescription
                append(.error, error.localizedDescription)
                streamingAssistantID = nil
                refreshActiveAgents()
            }
        }
    }

    func clearChat() {
        lines.removeAll()
        append(.system, "对话已清空。任务台账仍在左侧。")
    }

    private func handleSessionLine(_ line: ChatLine) {
        switch line.kind {
        case .assistant:
            if let id = streamingAssistantID,
               let idx = lines.firstIndex(where: { $0.id == id })
            {
                lines[idx].text += line.text
            } else {
                let id = UUID()
                streamingAssistantID = id
                lines.append(ChatLine(id: id, kind: .assistant, text: line.text))
            }
        case .tool:
            lines.append(line)
            // Kick a ledger refresh on tool boundaries
            if line.meta["event"] == "tool_start" || line.meta["event"] == "tool_end" {
                refreshActiveAgents()
            }
            if line.meta["event"] == "tool_end" {
                let ok = line.meta["toolOk"] != "0"
                let name = line.meta["toolName"] ?? "tool"
                let project = line.meta["project"] ?? ""
                let label = project.isEmpty ? name : "\(name) · \(project)"
                append(
                    .system,
                    ok ? "✅ 工具结束：\(label)" : "❌ 工具失败：\(label)"
                )
            }
        case .system, .error, .user:
            lines.append(line)
            if line.kind == .error {
                errorBanner = line.text
            }
            if line.meta["event"] == "turn_end" {
                refreshActiveAgents()
            }
        }
    }

    private func append(_ kind: ChatLine.Kind, _ text: String) {
        lines.append(ChatLine(kind: kind, text: text))
    }

    deinit {
        pollTask?.cancel()
        let s = session
        Task { await s?.shutdown() }
    }
}
