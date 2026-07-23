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

    @Published var brothers: [WorkerBrother] = []
    @Published var stations: [WorkbenchStation] = []
    @Published var workbenchTitle: String = "今日工作台"
    @Published var railStatus: String = ""

    private var streamingAssistantID: UUID?
    private var session: SuperAgentSession?
    private var pollTask: Task<Void, Never>?
    private var knownStationStatuses: [String: String] = [:]

    init() {
        let root = ProjectDiscovery.defaultProjectsRoot()
        self.projectsRootPath = root.path
    }

    func bootstrap() {
        errorBanner = nil
        refreshWorkbench()
        startPolling()

        guard let executable = AgentMuxExecutableLocator.locate() else {
            errorBanner = "找不到 am / agentmux。"
            status = "Missing am"
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
        status = "Connecting…"

        Task {
            do {
                try await session.start()
                status = "今日工位 · 跟老大说话"
                append(
                    .system,
                    """
                    早晨开工流程：
                    1) 说「今天做 A B C」
                    2) 指定小弟（或让我推荐）
                    3) 分别说各项目任务
                    4) 说「开干」并行启动
                    5) 有疑问/审批会标「等你」——在对话里回答
                    """
                )
            } catch {
                errorBanner = error.localizedDescription
                status = "Failed"
            }
        }
    }

    func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await MainActor.run { self?.refreshWorkbench() }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    func refreshWorkbench() {
        guard let executable = AgentMuxExecutableLocator.locate() else { return }
        Task {
            do {
                async let wbTask = WorkbenchStore.load(executable: executable)
                async let workersTask = WorkersScan.scan(executable: executable)
                let wb = try await wbTask
                let workers = try await workersTask

                brothers = workers
                workbenchTitle = wb.title
                stations = wb.stations

                for st in wb.stations {
                    let prev = knownStationStatuses[st.id]
                    if prev != st.status {
                        if st.status == "waiting_user", let q = st.pendingQuestion {
                            append(
                                .system,
                                "⏳ \(st.project ?? "?") 等你：\(q)"
                            )
                            status = "有工位等你回答"
                        } else if st.status == "done" {
                            append(
                                .system,
                                "✅ \(st.project ?? "?") 完成 · \((st.summary ?? "").prefix(80))"
                            )
                        } else if st.status == "failed" {
                            append(
                                .system,
                                "❌ \(st.project ?? "?") 失败 · \((st.error ?? "").prefix(80))"
                            )
                        } else if st.status == "running" {
                            append(
                                .system,
                                "🚀 \(st.project ?? "?") · \(st.backend ?? "?") 开工"
                            )
                        }
                        knownStationStatuses[st.id] = st.status
                    }
                }

                let running = wb.stations.filter { $0.status == "running" }.count
                let waiting = wb.stations.filter { $0.status == "waiting_user" }.count
                let done = wb.stations.filter { $0.status == "done" }.count
                let ready = wb.stations.filter { $0.status == "ready" }.count
                railStatus =
                    "工位 \(wb.stations.count) · 就绪 \(ready) · 跑 \(running) · 等你 \(waiting) · 完成 \(done)"
            } catch {
                railStatus = "刷新失败"
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
        status = "老大处理中…"
        append(.user, text)
        streamingAssistantID = nil

        Task {
            do {
                _ = try await session.sendUser(text)
                isBusy = false
                status = "待命 · 可继续布置/开干/回答审批"
                streamingAssistantID = nil
                refreshWorkbench()
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
        append(.system, "对话已清空。今日工位仍在左侧。")
    }

    func focusStation(_ station: WorkbenchStation) {
        guard let p = station.project else { return }
        if station.status == "waiting_user", let q = station.pendingQuestion {
            draft = "关于 \(p)：\(q)\n我的回答："
        } else {
            draft = "关于 \(p)："
        }
    }

    func suggestBackend(_ backend: String) {
        if draft.isEmpty {
            draft = "用 \(backend) "
        } else {
            draft += " 用 \(backend) "
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
                refreshWorkbench()
            }
        case .system, .error, .user:
            lines.append(line)
            if line.kind == .error { errorBanner = line.text }
            if line.meta["event"] == "turn_end" { refreshWorkbench() }
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
