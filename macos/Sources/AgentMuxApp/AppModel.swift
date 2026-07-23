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
    @Published var localAgents: [LocalAgentRow] = []
    @Published var agentsStatus: String = ""

    private var streamingAssistantID: UUID?
    private var session: SuperAgentSession?
    private let projectsRoot: URL

    init() {
        let root = ProjectDiscovery.defaultProjectsRoot()
        self.projectsRoot = root
        self.projectsRootPath = root.path
    }

    func bootstrap() {
        errorBanner = nil
        refreshLocalAgents()
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
                    "直接自然语言对话。左侧是本机 agent；我只会把活派给「可调度」的 worker（目前是 Pi）。"
                )
            } catch {
                errorBanner = error.localizedDescription
                status = "Failed to start"
            }
        }
    }

    func refreshLocalAgents() {
        agentsStatus = "扫描中…"
        guard let executable = AgentMuxExecutableLocator.locate() else {
            localAgents = []
            agentsStatus = "无 am"
            return
        }
        Task {
            do {
                let rows = try await LocalAgentScan.scan(executable: executable)
                localAgents = rows
                let avail = rows.filter(\.available).count
                let running = rows.reduce(0) { $0 + $1.runningCount }
                let workers = rows.filter(\.dispatchable).count
                agentsStatus = "可用 \(avail) · 进程 \(running) · 可调度 \(workers)"
            } catch {
                agentsStatus = "扫描失败"
                errorBanner = error.localizedDescription
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
        status = "Thinking / dispatching…"
        append(.user, text)
        streamingAssistantID = nil

        Task {
            do {
                _ = try await session.sendUser(text)
                isBusy = false
                status = "Ready"
                streamingAssistantID = nil
                // refresh agent process counts after a turn
                refreshLocalAgents()
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
        append(.system, "对话已清空。")
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
        case .tool, .system, .error, .user:
            lines.append(line)
            if line.kind == .error {
                errorBanner = line.text
            }
        }
    }

    private func append(_ kind: ChatLine.Kind, _ text: String) {
        lines.append(ChatLine(kind: kind, text: text))
    }

    deinit {
        let s = session
        Task { await s?.shutdown() }
    }
}
