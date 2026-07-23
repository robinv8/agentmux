import Foundation
import AgentMuxKit

@MainActor
final class AppModel: ObservableObject {
    @Published var projects: [ProjectEntry] = []
    @Published var selectedProjectID: String?
    @Published var taskText: String = ""
    @Published var transcript: String = ""
    @Published var isRunning: Bool = false
    @Published var lastStatus: String = "Idle"
    @Published var projectsRootPath: String
    @Published var errorBanner: String?

    private let runner: OneShotRunner

    init(runner: OneShotRunner = OneShotRunner()) {
        self.runner = runner
        self.projectsRootPath = ProjectDiscovery.defaultProjectsRoot().path
    }

    var selectedProject: ProjectEntry? {
        projects.first { $0.id == selectedProjectID }
    }

    func refreshProjects() {
        errorBanner = nil
        let root = URL(fileURLWithPath: projectsRootPath, isDirectory: true)
        do {
            projects = try ProjectDiscovery.discover(
                options: .init(projectsRoot: root)
            )
            if selectedProjectID == nil {
                selectedProjectID = projects.first?.id
            } else if !projects.contains(where: { $0.id == selectedProjectID }) {
                selectedProjectID = projects.first?.id
            }
            lastStatus = "Loaded \(projects.count) projects"
        } catch {
            projects = []
            errorBanner = error.localizedDescription
            lastStatus = "List failed"
        }
    }

    func runTask() {
        guard !isRunning else { return }
        guard let project = selectedProject else {
            errorBanner = "Select a project"
            return
        }
        let message = taskText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else {
            errorBanner = "Enter a task"
            return
        }
        guard let executable = AgentMuxExecutableLocator.locate() else {
            errorBanner = "Cannot find `am` / agentmux. Install AgentMux first."
            lastStatus = "Missing am"
            return
        }

        let root = URL(fileURLWithPath: projectsRootPath, isDirectory: true)
        let invocation: OneShotInvocation
        do {
            invocation = try OneShotInvocationBuilder.build(
                projectName: project.name,
                message: message,
                projectsRoot: root,
                agentMuxExecutable: executable
            )
        } catch {
            errorBanner = error.localizedDescription
            return
        }

        isRunning = true
        errorBanner = nil
        transcript = ""
        lastStatus = "Running \(project.name)…"

        Task {
            do {
                let result = try await runner.run(
                    invocation,
                    onStdout: { [weak self] chunk in
                        Task { @MainActor in
                            self?.transcript.append(chunk)
                        }
                    },
                    onStderr: { [weak self] chunk in
                        Task { @MainActor in
                            self?.transcript.append(chunk)
                        }
                    }
                )
                isRunning = false
                if result.succeeded {
                    lastStatus = "Succeeded (exit 0)"
                } else {
                    lastStatus = "Failed (exit \(result.exitCode))"
                }
            } catch {
                isRunning = false
                lastStatus = "Error"
                errorBanner = error.localizedDescription
                transcript.append("\n[error] \(error.localizedDescription)\n")
            }
        }
    }
}
