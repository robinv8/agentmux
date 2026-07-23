import SwiftUI
import AppKit
import AgentMuxKit

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        HSplitView {
            activeAgentsRail
                .frame(minWidth: 260, idealWidth: 300, maxWidth: 360)
            chatColumn
                .frame(minWidth: 440)
        }
        .onAppear { model.bootstrap() }
        .frame(minWidth: 900, minHeight: 580)
    }

    // MARK: - Left: active agents only (not project list)

    private var activeAgentsRail: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("活跃 Agents")
                    .font(.headline)
                Spacer()
                Button {
                    model.refreshActiveAgents()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .help("刷新活跃列表")
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 4)

            Text(model.activityStatus)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 14)
                .padding(.bottom, 8)

            if model.activeActivities.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "waveform.path.ecg")
                        .font(.system(size: 28))
                        .foregroundStyle(.tertiary)
                    Text("暂无活跃 agent")
                        .font(.subheadline.weight(.medium))
                    Text("在中间对话里派活，或等本机 Grok/Codex/Kimi 启动后会出现在这里。\n也可以问：「现在有哪些在跑？」")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 12)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(model.activeActivities) { activity in
                            activityCard(activity)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 12)
                }
            }

            Divider()
            Text("中间对话可问进度 · 左侧只显示进行中的 agent/任务")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .padding(10)
        }
        .background(Color.primary.opacity(0.025))
        .accessibilityIdentifier("agentmux.active.rail")
    }

    private func activityCard(_ a: ActiveActivity) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Circle()
                    .fill(dotColor(a.status))
                    .frame(width: 9, height: 9)
                Text(a.title)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(statusLabel(a.status))
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(dotColor(a.status))
            }

            Text(a.subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)

            if let detail = a.detail, !detail.isEmpty {
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }

            HStack(spacing: 6) {
                chip(a.source == .superJob ? "Super 派发" : "本机会话")
                if let p = a.project {
                    chip(p)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.primary.opacity(0.06))
        )
    }

    private func chip(_ text: String) -> some View {
        Text(text)
            .font(.caption2)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(Color.accentColor.opacity(0.12))
            .clipShape(Capsule())
    }

    private func dotColor(_ s: ActiveActivity.Status) -> Color {
        switch s {
        case .running: return .orange
        case .done: return .green
        case .idle: return .secondary
        }
    }

    private func statusLabel(_ s: ActiveActivity.Status) -> String {
        switch s {
        case .running: return "进行中"
        case .done: return "完成"
        case .idle: return "空闲"
        }
    }

    // MARK: - Center: Super Agent dialog

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
                Text("对话")
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
            if line.kind == .user { Spacer(minLength: 48) }
            VStack(alignment: .leading, spacing: 4) {
                Text(label(for: line.kind))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(line.text)
                    .font(line.kind == .tool ? .system(.caption, design: .monospaced) : .body)
                    .textSelection(.enabled)
                    .frame(maxWidth: 580, alignment: .leading)
            }
            .padding(10)
            .background(bubbleColor(for: line.kind))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            if line.kind != .user { Spacer(minLength: 48) }
        }
    }

    private func label(for kind: ChatLine.Kind) -> String {
        switch kind {
        case .user: return "You"
        case .assistant: return "Super Agent"
        case .tool: return "调度"
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
            Text("跟 Super Agent 说话 · 可问「现在进度怎么样 / 谁在跑」")
                .font(.caption)
                .foregroundStyle(.secondary)

            FocusableTextView(
                text: $model.draft,
                isEditable: !model.isBusy,
                placeholder: "例如：现在有哪些 agent 在跑？帮 mindmux-app 看登录…",
                onSubmit: { model.send() }
            )
            .frame(minHeight: 72, maxHeight: 120)
            .accessibilityIdentifier("agentmux.chat.input")

            HStack {
                Button(model.isBusy ? "处理中…" : "发送") {
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
