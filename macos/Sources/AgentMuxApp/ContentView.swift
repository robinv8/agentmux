import SwiftUI
import AppKit
import AgentMuxKit

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        HSplitView {
            workbenchRail
                .frame(minWidth: 300, idealWidth: 340, maxWidth: 400)
            chatColumn
                .frame(minWidth: 440)
        }
        .onAppear { model.bootstrap() }
        .frame(minWidth: 980, minHeight: 620)
    }

    // MARK: - Left: today's stations

    private var workbenchRail: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.workbenchTitle)
                        .font(.headline)
                    Text(model.railStatus)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button { model.refreshWorkbench() } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
            }
            .padding(14)

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if model.stations.isEmpty {
                        emptyStations
                    } else {
                        ForEach(model.stations) { st in
                            stationCard(st)
                        }
                    }

                    brothersStrip
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 12)
            }

            Divider()
            Text("工位=今日项目 · 点卡片聚焦对话 · 审批会显示「等你」")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .padding(10)
        }
        .background(Color.primary.opacity(0.025))
    }

    private var emptyStations: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("还没有今日工位")
                .font(.subheadline.weight(.semibold))
            Text("对老大说：\n「今天要同时处理 agentmux 和 md-converter」")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func stationCard(_ st: WorkbenchStation) -> some View {
        Button {
            model.focusStation(st)
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Circle()
                        .fill(statusColor(st.status))
                        .frame(width: 10, height: 10)
                    Text(st.project ?? "未命名")
                        .font(.headline)
                    Spacer()
                    Text(statusText(st.status))
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(statusColor(st.status))
                }

                HStack(spacing: 6) {
                    chip(st.backend.map { "小弟 \($0)" } ?? "未指定小弟")
                    if st.status == "ready" { chip("就绪") }
                    if st.status == "waiting_user" { chip("等你") }
                }

                if let task = st.task, !task.isEmpty {
                    Text(task)
                        .font(.caption)
                        .foregroundStyle(.primary.opacity(0.85))
                        .lineLimit(4)
                        .multilineTextAlignment(.leading)
                } else {
                    Text("尚未布置任务")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }

                if let q = st.pendingQuestion, st.status == "waiting_user" {
                    Text("❓ \(q)")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.orange)
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.orange.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }

                if let summary = st.summary, st.status == "done" {
                    Text(summary)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }
                if let err = st.error, st.status == "failed" {
                    Text(err)
                        .font(.caption2)
                        .foregroundStyle(.red)
                        .lineLimit(3)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.05))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(statusColor(st.status).opacity(0.35), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private var brothersStrip: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("可指挥的小弟")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            FlowBrothers(brothers: model.brothers.filter(\.available)) { b in
                model.suggestBackend(b.backendId)
            }
        }
        .padding(.top, 4)
    }

    private func chip(_ text: String) -> some View {
        Text(text)
            .font(.caption2)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(Color.accentColor.opacity(0.12))
            .clipShape(Capsule())
    }

    private func statusColor(_ s: String) -> Color {
        switch s {
        case "running": return .orange
        case "waiting_user": return .purple
        case "done": return .green
        case "failed": return .red
        case "ready": return .blue
        default: return .secondary
        }
    }

    private func statusText(_ s: String) -> String {
        switch s {
        case "running": return "进行中"
        case "waiting_user": return "等你"
        case "done": return "完成"
        case "failed": return "失败"
        case "ready": return "就绪"
        case "empty": return "待布置"
        default: return s
        }
    }

    // MARK: - Chat

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
                Text(err).font(.caption).foregroundStyle(.red).lineLimit(2)
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
                        chatBubble(line).id(line.id)
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
        case .assistant: return "老大"
        case .tool: return "调度"
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
            Text("布置工位 / 开干 / 回答审批")
                .font(.caption)
                .foregroundStyle(.secondary)

            FocusableTextView(
                text: $model.draft,
                isEditable: !model.isBusy,
                placeholder: "今天做 agentmux 和 md-converter… / 开干 / 关于 xxx：可以改",
                onSubmit: { model.send() }
            )
            .frame(minHeight: 80, maxHeight: 140)

            HStack {
                Button(model.isBusy ? "处理中…" : "发送") { model.send() }
                    .keyboardShortcut(.return, modifiers: [.command])
                    .disabled(
                        model.isBusy
                            || model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    )
                Spacer()
                Text("⌘↩")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(16)
    }
}

/// Simple horizontal wrap of brother chips
struct FlowBrothers: View {
    let brothers: [WorkerBrother]
    let onTap: (WorkerBrother) -> Void

    var body: some View {
        // Lazy: single row scroll is enough for 5 backends
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(brothers) { b in
                    Button(b.backendId) { onTap(b) }
                        .buttonStyle(.bordered)
                        .controlSize(.mini)
                }
            }
        }
    }
}
