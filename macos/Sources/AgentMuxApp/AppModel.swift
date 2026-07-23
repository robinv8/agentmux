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
    /// Super-dispatched jobs keyed by toolCallId (reliable complete detection)
    private var superJobs: [String: ActiveActivity] = [:]
    private var localSnapshot: [ActiveActivity] = []

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
                    "左侧=活跃任务（开始/完成会更新）。可问「做完了吗 / 谁在跑」。"
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
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    func refreshActiveAgents() {
        guard let executable = AgentMuxExecutableLocator.locate() else {
            activityStatus = "无 am"
            return
        }
        Task {
            do {
                let rows = try await LocalAgentScan.scan(executable: executable)
                localSnapshot = ActiveActivityBuilder.fromLocalAgents(rows)
                mergeActivities()
                let running = activeActivities.filter { $0.status == .running }.count
                let done = activeActivities.filter { $0.status == .done }.count
                if running == 0 && done == 0 {
                    activityStatus = "暂无活跃任务"
                } else {
                    activityStatus = "进行中 \(running)" + (done > 0 ? " · 刚完成 \(done)" : "")
                }
            } catch {
                activityStatus = "扫描失败"
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
                // Safety net: any leftover running super jobs → done when turn ends
                finalizeOpenSuperJobs(reason: "本轮对话结束")
                isBusy = false
                status = "Ready"
                streamingAssistantID = nil
                schedulePruneDoneJobs()
                refreshActiveAgents()
            } catch {
                finalizeOpenSuperJobs(reason: "本轮失败")
                isBusy = false
                status = "Error"
                errorBanner = error.localizedDescription
                append(.error, error.localizedDescription)
                streamingAssistantID = nil
            }
        }
    }

    func clearChat() {
        lines.removeAll()
        append(.system, "对话已清空。活跃任务列表仍会刷新。")
    }

    // MARK: - Session events (structured tool lifecycle)

    private func handleSessionLine(_ line: ChatLine) {
        let event = line.meta["event"]

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
            if event == "tool_start" {
                beginSuperJob(from: line)
            } else if event == "tool_end" {
                completeSuperJob(from: line)
            }

        case .system:
            lines.append(line)
            if event == "turn_end" {
                finalizeOpenSuperJobs(reason: "本轮结束")
            }

        case .error:
            lines.append(line)
            errorBanner = line.text
            finalizeOpenSuperJobs(reason: "出错")

        case .user:
            lines.append(line)
        }
    }

    private func beginSuperJob(from line: ChatLine) {
        let callId = line.meta["toolCallId"].flatMap { $0.isEmpty ? nil : $0 } ?? UUID().uuidString
        let name = line.meta["toolName"] ?? "tool"
        let project = line.meta["project"]
        let message = line.meta["message"]

        let title: String
        let agentId: String
        switch name {
        case "run_in_project":
            title = "Pi Worker"
            agentId = "pi"
        case "list_projects":
            title = "扫描项目"
            agentId = "agentmux"
        case "list_local_agents":
            title = "扫描本机 Agents"
            agentId = "agentmux"
        default:
            title = name
            agentId = "agentmux"
        }

        superJobs[callId] = ActiveActivity(
            id: "super-\(callId)",
            title: title,
            subtitle: project.map { "项目 · \($0) · 进行中" } ?? "进行中",
            status: .running,
            source: .superJob,
            agentId: agentId,
            project: project,
            detail: message ?? line.text,
            updatedAt: Date()
        )
        mergeActivities()
        status = "Worker 执行中…"
    }

    private func completeSuperJob(from line: ChatLine) {
        let callId = line.meta["toolCallId"] ?? ""
        let ok = line.meta["toolOk"] != "0"
        let result = line.meta["toolResult"] ?? line.text
        let name = line.meta["toolName"] ?? ""

        func markDone(_ key: String, _ job: ActiveActivity) {
            var done = job
            done.status = .done
            done.subtitle = ok
                ? (job.project.map { "项目 · \($0) · 已完成" } ?? "已完成")
                : (job.project.map { "项目 · \($0) · 失败" } ?? "失败")
            done.detail = String(result.prefix(200))
            done.updatedAt = Date()
            superJobs[key] = done
        }

        if !callId.isEmpty, let job = superJobs[callId] {
            markDone(callId, job)
        } else {
            // Fallback: match by tool name among running jobs
            for (key, job) in superJobs where job.status == .running {
                if key.contains(name) || job.title.lowercased().contains(name.lowercased())
                    || (name == "run_in_project" && job.agentId == "pi")
                {
                    markDone(key, job)
                }
            }
        }

        mergeActivities()
        let stillRunning = superJobs.values.contains { $0.status == .running }
        status = stillRunning ? "还有任务进行中…" : "Worker 已完成"
        schedulePruneDoneJobs()
    }

    private func finalizeOpenSuperJobs(reason: String) {
        for (key, job) in superJobs where job.status == .running {
            var done = job
            done.status = .done
            done.subtitle = reason
            done.updatedAt = Date()
            superJobs[key] = done
        }
        mergeActivities()
        schedulePruneDoneJobs()
    }

    private func schedulePruneDoneJobs() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            guard let self else { return }
            let cutoff = Date().addingTimeInterval(-8)
            self.superJobs = self.superJobs.filter { _, job in
                job.status == .running || job.updatedAt > cutoff
            }
            self.mergeActivities()
        }
    }

    private func mergeActivities() {
        var merged: [ActiveActivity] = []
        let superRunning = superJobs.values.filter { $0.status == .running }
            .sorted { $0.updatedAt > $1.updatedAt }
        let superDone = superJobs.values.filter { $0.status == .done }
            .sorted { $0.updatedAt > $1.updatedAt }
        merged.append(contentsOf: superRunning)
        merged.append(contentsOf: localSnapshot)
        merged.append(contentsOf: superDone)
        var seen = Set<String>()
        activeActivities = merged.filter { seen.insert($0.id).inserted }
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
