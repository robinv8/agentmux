import SwiftUI
import AppKit
import AgentMuxKit

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            chatScroll
            Divider()
            composer
        }
        .onAppear { model.bootstrap() }
        .frame(minWidth: 720, minHeight: 520)
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("AgentMux Super Agent")
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
                    withAnimation {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
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
        case .tool: return "Worker / Tool"
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
            Text("对超级 Agent 说话（它会选项目并派工人）")
                .font(.caption)
                .foregroundStyle(.secondary)

            FocusableTextView(
                text: $model.draft,
                isEditable: !model.isBusy,
                placeholder: "例如：看下我有哪些项目 / mindmux-app 登录提交后没跳转…",
                onSubmit: { model.send() }
            )
            .frame(minHeight: 72, maxHeight: 120)
            .accessibilityIdentifier("agentmux.chat.input")

            HStack {
                Button(model.isBusy ? "工作中…" : "发送") {
                    model.send()
                }
                .keyboardShortcut(.return, modifiers: [.command])
                .disabled(model.isBusy || model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

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
