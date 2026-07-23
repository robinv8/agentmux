import SwiftUI
import AppKit
import AgentMuxKit

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        HSplitView {
            agentsSidebar
                .frame(minWidth: 240, idealWidth: 280, maxWidth: 340)
            chatColumn
                .frame(minWidth: 420)
        }
        .onAppear { model.bootstrap() }
        .frame(minWidth: 880, minHeight: 560)
    }

    // MARK: - Left: local agents

    private var agentsSidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("本机 Agents")
                    .font(.headline)
                Spacer()
                Button {
                    model.refreshLocalAgents()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .help("重新扫描本机 agent")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)

            Text(model.agentsStatus)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .padding(.bottom, 6)

            List {
                Section("可调度 Worker") {
                    ForEach(model.localAgents.filter(\.dispatchable)) { agent in
                        agentRow(agent, emphasize: true)
                    }
                }
                Section("已安装 / 运行中") {
                    ForEach(
                        model.localAgents.filter { $0.available && !$0.dispatchable }
                    ) { agent in
                        agentRow(agent, emphasize: false)
                    }
                }
                Section("未检测到") {
                    ForEach(model.localAgents.filter { !$0.available }) { agent in
                        agentRow(agent, emphasize: false)
                    }
                }
            }
            .listStyle(.sidebar)

            Text("WORKER=可被 Super Agent 派活（目前仅 Pi）")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .padding(10)
        }
        .background(Color.primary.opacity(0.02))
        .accessibilityIdentifier("agentmux.agents.sidebar")
    }

    private func agentRow(_ agent: LocalAgentRow, emphasize: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Circle()
                    .fill(statusColor(agent))
                    .frame(width: 8, height: 8)
                Text(agent.name)
                    .font(.body.weight(emphasize ? .semibold : .regular))
                Spacer()
                if agent.runningCount > 0 {
                    Text("×\(agent.runningCount)")
                        .font(.caption2.monospacedDigit())
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.orange.opacity(0.2))
                        .clipShape(Capsule())
                }
            }
            HStack(spacing: 6) {
                tag(agent.available ? "已安装" : "未找到", color: agent.available ? .green : .secondary)
                if agent.dispatchable {
                    tag("可调度", color: .accentColor)
                }
                if let v = agent.version, !v.isEmpty {
                    Text(String(v.prefix(28)))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
            }
            if let path = agent.path {
                Text(path)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            ForEach(agent.notes.prefix(2), id: \.self) { note in
                Text(note)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 4)
        .opacity(agent.available ? 1 : 0.55)
    }

    private func tag(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.medium))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }

    private func statusColor(_ agent: LocalAgentRow) -> Color {
        if agent.runningCount > 0 { return .orange }
        if agent.dispatchable { return .green }
        if agent.available { return .blue }
        return .gray.opacity(0.5)
    }

    // MARK: - Right: super agent chat

    private var chatColumn: some View {
        VStack(spacing: 0) {
            header
            Divider()
            chatScroll
            Divider()
            composer
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Super Agent")
                    .font(.headline)
                Text(model.status)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let err = model.errorBanner {
                Text(err)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(2)
            }
            Button("Clear") { model.clearChat() }
                .buttonStyle(.borderless)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var chatScroll: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(model.lines) { line in
                        chatBubble(line)
                            .id(line.id)
                    }
                }
                .padding(16)
            }
            .onChange(of: model.lines.count) { _ in
                if let last = model.lines.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
        .background(Color.primary.opacity(0.03))
        .accessibilityIdentifier("agentmux.chat.scroll")
    }

    private func chatBubble(_ line: ChatLine) -> some View {
        HStack {
            if line.kind == .user { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 4) {
                Text(label(for: line.kind))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(line.text)
                    .font(line.kind == .tool ? .system(.caption, design: .monospaced) : .body)
                    .textSelection(.enabled)
                    .frame(maxWidth: 560, alignment: .leading)
            }
            .padding(10)
            .background(bubbleColor(for: line.kind))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            if line.kind != .user { Spacer(minLength: 40) }
        }
    }

    private func label(for kind: ChatLine.Kind) -> String {
        switch kind {
        case .user: return "You"
        case .assistant: return "Super Agent"
        case .tool: return "Tool / Worker"
        case .system: return "System"
        case .error: return "Error"
        }
    }

    private func bubbleColor(for kind: ChatLine.Kind) -> Color {
        switch kind {
        case .user: return Color.accentColor.opacity(0.18)
        case .assistant: return Color.primary.opacity(0.06)
        case .tool: return Color.orange.opacity(0.12)
        case .system: return Color.secondary.opacity(0.1)
        case .error: return Color.red.opacity(0.12)
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("对超级 Agent 说话（它会看左侧 agents / 项目并派活）")
                .font(.caption)
                .foregroundStyle(.secondary)

            FocusableTextView(
                text: $model.draft,
                isEditable: !model.isBusy,
                placeholder: "例如：本机有哪些 agent？/ 用工人读 agentmux 的 package 版本…",
                onSubmit: { model.send() }
            )
            .frame(minHeight: 72, maxHeight: 120)
            .accessibilityIdentifier("agentmux.chat.input")

            HStack {
                Button(model.isBusy ? "工作中…" : "发送") {
                    model.send()
                }
                .keyboardShortcut(.return, modifiers: [.command])
                .disabled(
                    model.isBusy
                        || model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                )

                Spacer()
                Text("⌘↩ 发送")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(16)
        .accessibilityIdentifier("agentmux.chat.composer")
    }
}
