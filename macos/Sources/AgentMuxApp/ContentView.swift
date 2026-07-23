import SwiftUI
import AgentMuxKit

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        NavigationSplitView {
            projectSidebar
        } detail: {
            detailPane
        }
        .navigationTitle("AgentMux")
        .onAppear { model.refreshProjects() }
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
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
                .onSubmit { model.refreshProjects() }

            List(model.projects, selection: $model.selectedProjectID) { project in
                VStack(alignment: .leading, spacing: 2) {
                    Text(project.name)
                        .font(.body.weight(.medium))
                    Text(project.cwd.path)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .tag(project.id)
            }
            .listStyle(.sidebar)
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

            TextEditor(text: $model.taskText)
                .font(.body)
                .frame(minHeight: 72, maxHeight: 120)
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color.secondary.opacity(0.3))
                )
                .disabled(model.isRunning)

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
            }

            Text("Output")
                .font(.headline)

            ScrollView {
                Text(model.transcript.isEmpty ? "Transcript appears here as the agent runs…" : model.transcript)
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
            )
            // Accessibility / structural markers for verification
            .accessibilityIdentifier("agentmux.output.transcript")
        }
        .padding(16)
        .accessibilityIdentifier("agentmux.detail.pane")
    }
}
