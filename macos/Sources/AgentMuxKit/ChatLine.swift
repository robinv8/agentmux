import Foundation

public struct ChatLine: Identifiable, Equatable, Sendable {
    public enum Kind: String, Sendable {
        case user
        case assistant
        case tool
        case system
        case error
    }

    public let id: UUID
    public var kind: Kind
    public var text: String
    /// Structured fields from Super Agent JSONL (tool lifecycle, etc.)
    public var meta: [String: String]

    public init(
        id: UUID = UUID(),
        kind: Kind,
        text: String,
        meta: [String: String] = [:]
    ) {
        self.id = id
        self.kind = kind
        self.text = text
        self.meta = meta
    }
}
