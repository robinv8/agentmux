import SwiftUI
import AppKit
import AgentMuxKit

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        HSplitView {
            projectSidebar
                .frame(minWidth: 220, idealWidth: 260, maxWidth: 360)
            detailPane
                .frame(minWidth: 420)
        }
        .onAppear {
            model.refreshProjects()
            NSApp.activate(ignoringOtherApps: true)
        }
        .frame(minWidth: 780, minHeight: 480)
    }

    private var projectSidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Projects")
                    .font(.headline)
                Spacer()
                Button {
                    model.refreshProjects()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .help("Refresh project list")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            FocusableLineField(
                text: $model.projectsRootPath,
                placeholder: "Projects root path",
                onSubmit: { model.refreshProjects() }
            )
            .frame(height: 28)
            .padding(.horizontal, 12)
            .padding(.bottom, 8)

            List(selection: $model.selectedProjectID) {
                ForEach(model.projects) { project in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(project.name)
                            .font(.body.weight(.medium))
                        Text(project.cwd.path)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .tag(Optional(project.id))
                    .contentShape(Rectangle())
                }
            }
            .listStyle(.sidebar)
        }
    }

    private var detailPane: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let banner = model.errorBanner {
                Text(banner)
                    .foregroundStyle(.red)
                    .font(.callout)
            }

            HStack {
                Text(model.selectedProject.map { "Task → \($0.name)" } ?? "Select a project")
                    .font(.title3.weight(.semibold))
                Spacer()
                Text(model.lastStatus)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text("Task")
                .font(.caption)
                .foregroundStyle(.secondary)

            FocusableTextView(
                text: $model.taskText,
                isEditable: !model.isRunning,
                placeholder: "Describe the task for this project…",
                onSubmit: { model.runTask() }
            )
            .frame(minHeight: 100, maxHeight: 160)
            .accessibilityIdentifier("agentmux.task.input")

            HStack {
                Button(model.isRunning ? "Running…" : "Run one-shot") {
                    model.runTask()
                }
                .keyboardShortcut(.return, modifiers: [.command])
                .disabled(model.isRunning || model.selectedProject == nil)

                Button("Clear output") {
                    model.transcript = ""
                }
                .disabled(model.transcript.isEmpty)

                Spacer()

                Text("⌘↩ to run · click task area to type")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Text("Output")
                .font(.headline)

            ScrollView {
                Text(
                    model.transcript.isEmpty
                        ? "Transcript appears here as the agent runs…"
                        : model.transcript
                )
                .font(.system(.body, design: .monospaced))
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
                .foregroundStyle(model.transcript.isEmpty ? .secondary : .primary)
            }
            .padding(8)
            .frame(maxHeight: .infinity)
            .background(Color.primary.opacity(0.04))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .accessibilityIdentifier("agentmux.output.transcript")
        }
        .padding(16)
        .accessibilityIdentifier("agentmux.detail.pane")
    }
}
