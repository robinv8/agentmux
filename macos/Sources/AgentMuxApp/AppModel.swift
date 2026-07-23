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

    /// Left rail: only active work / live agent sessions
    @Published var activeActivities: [ActiveActivity] = []
    @Published var activityStatus: String = ""

    private var streamingAssistantID: UUID?
    private var session: SuperAgentSession?
    private var pollTask: Task<Void, Never>?
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
                    "左侧是「正在跑的 agent / 任务」。中间跟我对话即可——可以问进度、让我派活。"
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
                try? await Task.sleep(nanoseconds: 4_000_000_000)
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
                let locals = ActiveActivityBuilder.fromLocalAgents(rows)
                localSnapshot = locals
                mergeActivities()
                let n = activeActivities.filter { $0.status == .running }.count
                activityStatus = n == 0 ? "暂无活跃任务" : "活跃 \(n)"
            } catch {
                // keep previous list; soft-fail polling
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
                isBusy = false
                status = "Ready — 可问进度或继续派活"
                streamingAssistantID = nil
                // drop finished super jobs after a beat
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
                    self?.superJobs = self?.superJobs.filter { $0.value.status == .running } ?? [:]
                    self?.mergeActivities()
                }
                refreshActiveAgents()
            } catch {
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
        append(.system, "对话已清空。左侧活跃列表仍会继续刷新。")
    }

    // MARK: - Events

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
            updateSuperJob(fromToolLine: line.text)
        case .system, .error, .user:
            lines.append(line)
            if line.kind == .error {
                errorBanner = line.text
            }
        }
    }

    /// Parse tool bubble text like: `→ run_in_project {"project":"x","message":"…"}`
    private func updateSuperJob(fromToolLine text: String) {
        if text.hasPrefix("→ ") {
            let body = String(text.dropFirst(2))
            let name = body.split(separator: " ", maxSplits: 1).first.map(String.init) ?? body
            var project: String?
            var message: String?
            if let jsonStart = body.firstIndex(of: "{"),
               let data = String(body[jsonStart...]).data(using: .utf8),
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            {
                project = obj["project"] as? String
                message = obj["message"] as? String
            }
            let id = "super-\(name)-\(project ?? UUID().uuidString)"
            let title: String
            if name == "run_in_project" {
                title = "Pi Worker"
            } else if name == "list_projects" {
                title = "扫描项目"
            } else if name == "list_local_agents" {
                title = "扫描本机 Agents"
            } else {
                title = name
            }
            superJobs[id] = ActiveActivity(
                id: id,
                title: title,
                subtitle: project.map { "项目 · \($0)" } ?? "Super Agent tool",
                status: .running,
                source: .superJob,
                agentId: name == "run_in_project" ? "pi" : "agentmux",
                project: project,
                detail: message.map { String($0.prefix(120)) } ?? text
            )
            mergeActivities()
            return
        }

        if text.hasPrefix("✓ ") {
            // mark matching running super jobs done
            let body = String(text.dropFirst(2))
            let name = body.split(separator: ":", maxSplits: 1).first?
                .trimmingCharacters(in: .whitespaces) ?? ""
            for (key, job) in superJobs where job.status == .running {
                if key.contains(name) || job.title.lowercased().contains(name.lowercased())
                    || (name == "run_in_project" && job.agentId == "pi")
                    || (name == "list_projects" && job.title.contains("扫描项目"))
                    || (name == "list_local_agents" && job.title.contains("Agents"))
                {
                    var done = job
                    done.status = .done
                    done.subtitle = "完成"
                    done.detail = String(body.prefix(160))
                    done.updatedAt = Date()
                    superJobs[key] = done
                }
            }
            // also match by tool name prefix in id
            for (key, job) in superJobs where job.status == .running && key.contains(name) {
                var done = job
                done.status = .done
                done.subtitle = "完成"
                superJobs[key] = done
            }
            mergeActivities()
        }
    }

    private func mergeActivities() {
        // Prefer running super jobs first, then local sessions, then recently done super jobs
        var merged: [ActiveActivity] = []
        let superRunning = superJobs.values.filter { $0.status == .running }
            .sorted { $0.updatedAt > $1.updatedAt }
        let superDone = superJobs.values.filter { $0.status == .done }
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(5)
        merged.append(contentsOf: superRunning)
        merged.append(contentsOf: localSnapshot)
        merged.append(contentsOf: superDone)
        // de-dupe by id
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
