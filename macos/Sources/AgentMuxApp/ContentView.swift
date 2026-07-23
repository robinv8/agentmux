import SwiftUI
import AgentMuxKit

struct ContentView: View {
    @ObservedObject var model: AppModel
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case projectsRoot
        case task
    }

    var body: some View {
        NavigationSplitView {
            projectSidebar
        } detail: {
            detailPane
        }
        .navigationTitle("AgentMux")
        .onAppear {
            model.refreshProjects()
            // Defer focus so the window is key first.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                focusedField = .task
            }
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

            TextField("Projects root", text: $model.projectsRootPath)
                .textFieldStyle(.roundedBorder)
                .font(.caption)
                .focused($focusedField, equals: .projectsRoot)
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
                .onSubmit { model.refreshProjects() }

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
            .onChange(of: model.selectedProjectID) { _ in
                focusedField = .task
            }
        }
        .frame(minWidth: 220)
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

            // TextField(axis:) is more reliable for keyboard focus on macOS
            // than TextEditor inside NavigationSplitView.
            TextField(
                "Describe the task for this project…",
                text: $model.taskText,
                axis: .vertical
            )
            .lineLimit(3...10)
            .textFieldStyle(.plain)
            .font(.body)
            .padding(10)
            .frame(minHeight: 88, alignment: .topLeading)
            .background(Color.primary.opacity(0.04))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.secondary.opacity(0.35))
                    .allowsHitTesting(false)
            )
            .focused($focusedField, equals: .task)
            .disabled(model.isRunning)
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

                Text("⌘↩ to run")
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
            .background(Color.primary.opacity(0.04))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.secondary.opacity(0.25))
                    .allowsHitTesting(false)
            )
            .accessibilityIdentifier("agentmux.output.transcript")
        }
        .padding(16)
        .accessibilityIdentifier("agentmux.detail.pane")
    }
}
