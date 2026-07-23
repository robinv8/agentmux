import SwiftUI
import AppKit
import AgentMuxKit

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        HSplitView {
            bossRail
                .frame(minWidth: 280, idealWidth: 320, maxWidth: 380)
            chatColumn
                .frame(minWidth: 440)
        }
        .onAppear { model.bootstrap() }
        .frame(minWidth: 960, minHeight: 600)
    }

    // MARK: - Left: 老大视角 — 小弟花名册 + 任务

    private var bossRail: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("AgentMux 老大")
                        .font(.headline)
                    Text(model.brothersStatus)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    model.refreshRoster()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .help("刷新小弟与任务")
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 8)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    brothersSection
                    tasksSection
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 12)
            }

            Divider()
            Text("点小弟可填「用 xxx」· 任务以 jobs 台账为准")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .padding(10)
        }
        .background(Color.primary.opacity(0.025))
        .accessibilityIdentifier("agentmux.boss.rail")
    }

    private var brothersSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("小弟（可指挥）")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            if model.brothers.isEmpty {
                Text("扫描中…")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            } else {
                ForEach(model.brothers) { b in
                    brotherCard(b)
                }
            }
        }
    }

    private func brotherCard(_ b: WorkerBrother) -> some View {
        Button {
            guard b.available else { return }
            model.suggestDispatch(backend: b.backendId)
        } label: {
            HStack(spacing: 10) {
                ZStack {
                    Circle()
                        .fill(b.available ? Color.green.opacity(0.2) : Color.gray.opacity(0.15))
                        .frame(width: 32, height: 32)
                    Text(String(b.backendId.prefix(1)).uppercased())
                        .font(.caption.weight(.bold))
                        .foregroundStyle(b.available ? .green : .secondary)
                }

                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(b.backendId)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                        if b.available {
                            Text("在岗")
                                .font(.caption2.weight(.medium))
                                .foregroundStyle(.green)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 1)
                                .background(Color.green.opacity(0.12))
                                .clipShape(Capsule())
                        } else {
                            Text("未安装")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Text(b.name)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    if let path = b.path {
                        Text(path)
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                Spacer(minLength: 0)
                if b.available {
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(10)
            .background(Color.primary.opacity(b.available ? 0.05 : 0.02))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .opacity(b.available ? 1 : 0.55)
        }
        .buttonStyle(.plain)
        .disabled(!b.available)
        .help(b.available ? "点击：在输入框填入「用 \(b.backendId)」" : "本机未检测到")
    }

    private var tasksSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("任务进度")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text(model.activityStatus)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            if model.activeActivities.isEmpty {
                Text("还没有派活。对老大说：用 grok 读 agentmux 的 package 版本")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.03))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            } else {
                ForEach(model.activeActivities) { a in
                    taskCard(a)
                }
            }
        }
    }

    private func taskCard(_ a: ActiveActivity) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Circle()
                    .fill(dotColor(a))
                    .frame(width: 9, height: 9)
                Text(a.title)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(statusLabel(a))
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(dotColor(a))
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
                chip("小弟 \(a.agentId)")
                if let p = a.project { chip(p) }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(dotColor(a).opacity(0.25), lineWidth: 1)
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

    private func dotColor(_ a: ActiveActivity) -> Color {
        if a.subtitle.contains("失败") { return .red }
        switch a.status {
        case .running: return .orange
        case .done: return .green
        case .idle: return .secondary
        }
    }

    private func statusLabel(_ a: ActiveActivity) -> String {
        if a.subtitle.contains("失败") { return "失败" }
        switch a.status {
        case .running: return "进行中"
        case .done: return "完成"
        case .idle: return "空闲"
        }
    }

    // MARK: - Center chat

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
                Text("对话 · 只跟老大说")
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
        case .assistant: return "老大 Super Agent"
        case .tool: return "调度小弟"
        case .system: return "系统"
        case .error: return "错误"
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
            Text("指挥老大 · 例：用 codex 在 agentmux 总结 README / 做完了吗？")
                .font(.caption)
                .foregroundStyle(.secondary)

            // Quick brother chips
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(model.brothers.filter(\.available)) { b in
                        Button("用 \(b.backendId)") {
                            model.suggestDispatch(backend: b.backendId)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
            }

            FocusableTextView(
                text: $model.draft,
                isEditable: !model.isBusy,
                placeholder: "对老大说话…",
                onSubmit: { model.send() }
            )
            .frame(minHeight: 72, maxHeight: 120)
            .accessibilityIdentifier("agentmux.chat.input")

            HStack {
                Button(model.isBusy ? "调度中…" : "发送") {
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
