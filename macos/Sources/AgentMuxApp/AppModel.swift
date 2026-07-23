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

    /// 可调度小弟（pi/claude/codex/grok/kimi）
    @Published var brothers: [WorkerBrother] = []
    /// 任务台账（进行中 / 刚完成）
    @Published var activeActivities: [ActiveActivity] = []
    @Published var activityStatus: String = ""
    @Published var brothersStatus: String = ""

    private var streamingAssistantID: UUID?
    private var session: SuperAgentSession?
    private var pollTask: Task<Void, Never>?
    private var knownJobStates: [String: String] = [:]

    init() {
        let root = ProjectDiscovery.defaultProjectsRoot()
        self.projectsRootPath = root.path
    }

    func bootstrap() {
        errorBanner = nil
        refreshRoster()
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
                status = "老大在线 · 指挥小弟干活"
                let ready = brothers.filter(\.available).map(\.backendId).joined(separator: ", ")
                append(
                    .system,
                    "我是 AgentMux 老大。左侧是小弟花名册 + 任务进度。\n可调度：\(ready.isEmpty ? "扫描中…" : ready)\n例：用 grok 读 agentmux 的 package 版本"
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
                await MainActor.run { self?.refreshRoster() }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    /// Refresh brothers + jobs ledger
    func refreshRoster() {
        guard let executable = AgentMuxExecutableLocator.locate() else {
            activityStatus = "无 am"
            brothersStatus = "无 am"
            return
        }
        Task {
            do {
                async let jobsTask = JobLedger.load(executable: executable)
                async let workersTask = WorkersScan.scan(executable: executable)

                let jobs = try await jobsTask
                let workers = try await workersTask

                brothers = workers
                let avail = workers.filter(\.available)
                brothersStatus = "小弟 \(avail.count)/\(workers.count) 在岗"

                for job in jobs {
                    let prev = knownJobStates[job.id]
                    if prev != job.status {
                        let backend = job.backend ?? "?"
                        if job.status == "done" {
                            append(
                                .system,
                                "✅ 小弟 \(backend) 完成 · \(job.project ?? "")：\((job.summary ?? "").prefix(100))"
                            )
                            status = "小弟 \(backend) 已完成"
                        } else if job.status == "failed" {
                            append(
                                .system,
                                "❌ 小弟 \(backend) 失败 · \(job.project ?? "")：\((job.error ?? "").prefix(100))"
                            )
                            status = "小弟 \(backend) 失败"
                        } else if job.status == "running", prev == nil || prev == "queued" {
                            append(
                                .system,
                                "⏳ 派小弟 \(backend) → \(job.project ?? "")"
                            )
                            status = "小弟 \(backend) 干活中…"
                        }
                        knownJobStates[job.id] = job.status
                    }
                }

                // Show recent jobs (running first, then recent done)
                let running = jobs.filter(\.isRunning)
                let recentDone = jobs.filter(\.isTerminal).prefix(8)
                var ordered = running + Array(recentDone)
                activeActivities = ActiveActivity.fromLedgerJobs(ordered)

                let r = running.count
                let d = jobs.filter { $0.status == "done" }.count
                let f = jobs.filter { $0.status == "failed" }.count
                activityStatus = r == 0 && d == 0 && f == 0
                    ? "暂无派发任务"
                    : "进行中 \(r) · 完成 \(d) · 失败 \(f)"
            } catch {
                activityStatus = "刷新失败"
                brothersStatus = "刷新失败"
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
        status = "老大在调度…"
        append(.user, text)
        streamingAssistantID = nil

        Task {
            do {
                _ = try await session.sendUser(text)
                isBusy = false
                status = "老大待命 · 可继续派活或问进度"
                streamingAssistantID = nil
                append(.system, "—— 本轮对话结束 ——")
                refreshRoster()
            } catch {
                isBusy = false
                status = "Error"
                errorBanner = error.localizedDescription
                append(.error, error.localizedDescription)
                streamingAssistantID = nil
                refreshRoster()
            }
        }
    }

    func clearChat() {
        lines.removeAll()
        append(.system, "对话已清空。小弟名册与任务台账仍在左侧。")
    }

    /// Quick chip: prefill a dispatch hint into the composer
    func suggestDispatch(backend: String) {
        if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            draft = "用 \(backend) "
        } else if !draft.contains(backend) {
            draft = "用 \(backend) " + draft
        }
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
            if line.meta["event"] == "tool_start" || line.meta["event"] == "tool_end" {
                refreshRoster()
            }
            if line.meta["event"] == "tool_end" {
                let ok = line.meta["toolOk"] != "0"
                let name = line.meta["toolName"] ?? "tool"
                let project = line.meta["project"] ?? ""
                append(
                    .system,
                    ok
                        ? "✅ 调度结束：\(name)\(project.isEmpty ? "" : " · \(project)")"
                        : "❌ 调度失败：\(name)"
                )
            }
        case .system, .error, .user:
            lines.append(line)
            if line.kind == .error {
                errorBanner = line.text
            }
            if line.meta["event"] == "turn_end" {
                refreshRoster()
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
