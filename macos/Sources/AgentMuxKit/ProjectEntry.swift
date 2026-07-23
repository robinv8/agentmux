import Foundation

/// One project root discovered under the Projects directory.
public struct ProjectEntry: Equatable, Identifiable, Sendable {
    public var id: String { name }
    /// Directory basename — same stable id as the CLI.
    public let name: String
    public let cwd: URL

    public init(name: String, cwd: URL) {
        self.name = name
        self.cwd = cwd
    }
}
