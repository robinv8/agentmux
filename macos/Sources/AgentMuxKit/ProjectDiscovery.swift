import Foundation

/// Discovers direct child directories under a Projects root.
/// Semantics mirror AgentMux CLI `discoverProjects` (non-hidden dirs, skip clutter names).
public enum ProjectDiscovery {
    public static let defaultSkipNames: Set<String> = [
        "node_modules",
        ".git",
        ".DS_Store",
        "tmp",
        "temp",
        "data",
        "local",
        "test",
        "test_2",
    ]

    public struct Options {
        public var projectsRoot: URL
        public var skipNames: Set<String>
        public var fileManager: FileManager

        public init(
            projectsRoot: URL,
            skipNames: Set<String> = ProjectDiscovery.defaultSkipNames,
            fileManager: FileManager = .default
        ) {
            self.projectsRoot = projectsRoot
            self.skipNames = skipNames
            self.fileManager = fileManager
        }
    }

    public static func discover(options: Options) throws -> [ProjectEntry] {
        let root = options.projectsRoot.standardizedFileURL
        var isDir: ObjCBool = false
        guard options.fileManager.fileExists(atPath: root.path, isDirectory: &isDir), isDir.boolValue else {
            throw DiscoveryError.rootMissing(root.path)
        }

        let names = try options.fileManager.contentsOfDirectory(atPath: root.path)
        var projects: [ProjectEntry] = []
        for name in names {
            if name.hasPrefix(".") { continue }
            if options.skipNames.contains(name) { continue }
            let child = root.appendingPathComponent(name, isDirectory: true)
            var childIsDir: ObjCBool = false
            guard options.fileManager.fileExists(atPath: child.path, isDirectory: &childIsDir),
                  childIsDir.boolValue
            else { continue }
            projects.append(ProjectEntry(name: name, cwd: child))
        }
        projects.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        return projects
    }

    public static func defaultProjectsRoot(home: URL? = nil) -> URL {
        let homeURL = home ?? FileManager.default.homeDirectoryForCurrentUser
        if let env = ProcessInfo.processInfo.environment["AGENTMUX_PROJECTS_ROOT"], !env.isEmpty {
            return URL(fileURLWithPath: (env as NSString).expandingTildeInPath, isDirectory: true)
        }
        return homeURL.appendingPathComponent("Projects", isDirectory: true)
    }
}

public enum DiscoveryError: Error, Equatable, LocalizedError {
    case rootMissing(String)

    public var errorDescription: String? {
        switch self {
        case .rootMissing(let path):
            return "Projects root does not exist or is not a directory: \(path)"
        }
    }
}
