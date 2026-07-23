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

    /// Streaming assistant bubble currently being built (merged on turn end).
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
        guard let executable = AgentMuxExecutableLocator.locate() else {
            errorBanner = "找不到 am / agentmux。请先安装 CLI（bun link 或 install.sh）。"
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
                status = "Super Agent ready — just talk"
                append(
                    .system,
                    "直接用自然语言说需求。我会选择项目并派工人（不必先选项目）。"
                )
            } catch {
                errorBanner = error.localizedDescription
                status = "Failed to start"
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
        append(.system, "对话已清空（Super Agent 进程仍保留上下文，需要完全重置请重启 App）。")
    }

    private func handleSessionLine(_ line: ChatLine) {
        switch line.kind {
        case .assistant:
            // Merge streaming chunks into one bubble
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
