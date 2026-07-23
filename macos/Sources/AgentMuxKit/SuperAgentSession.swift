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

    public init(id: UUID = UUID(), kind: Kind, text: String) {
        self.id = id
        self.kind = kind
        self.text = text
    }
}

/// Drives `am super --rpc` (JSONL) for Super Agent chat.
public actor SuperAgentSession {
    private var process: Process?
    private var stdinHandle: FileHandle?
    private var stdoutSource: DispatchSourceRead?
    private var buffer = Data()
    private var readyContinuation: CheckedContinuation<Void, Error>?
    private var turnContinuation: CheckedContinuation<String, Error>?
    private var accumulatedAssistant = ""
    private let onEvent: @Sendable (ChatLine) -> Void

    private let executable: URL
    private let projectsRoot: URL
    private let environment: [String: String]

    public init(
        executable: URL,
        projectsRoot: URL,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        onEvent: @escaping @Sendable (ChatLine) -> Void
    ) {
        self.executable = executable
        self.projectsRoot = projectsRoot
        self.environment = environment
        self.onEvent = onEvent
    }

    public func start() async throws {
        if process != nil { return }

        let launch = AgentMuxExecutableLocator.processLaunch(for: executable)
        var args = launch.prefixArgs + ["super", "--rpc"]
        let exe = launch.executable
        if exe.path == "/usr/bin/env", executable.pathExtension == "js" {
            args = ["bun"] + launch.prefixArgs + ["super", "--rpc"]
        }

        let proc = Process()
        proc.executableURL = exe
        proc.arguments = args
        var env = environment
        env["AGENTMUX_PROJECTS_ROOT"] = projectsRoot.path
        if env["KIMI_API_KEY"] == nil, let token = env["ANTHROPIC_AUTH_TOKEN"] {
            env["KIMI_API_KEY"] = token
        }
        proc.environment = env

        let inPipe = Pipe()
        let outPipe = Pipe()
        let errPipe = Pipe()
        proc.standardInput = inPipe
        proc.standardOutput = outPipe
        proc.standardError = errPipe

        try proc.run()
        process = proc
        stdinHandle = inPipe.fileHandleForWriting

        let handle = outPipe.fileHandleForReading
        let source = DispatchSource.makeReadSource(
            fileDescriptor: handle.fileDescriptor,
            queue: DispatchQueue.global(qos: .userInitiated)
        )
        source.setEventHandler { [weak self] in
            let data = handle.availableData
            if data.isEmpty { return }
            Task { await self?.consume(data: data) }
        }
        source.resume()
        stdoutSource = source

        errPipe.fileHandleForReading.readabilityHandler = { [onEvent] h in
            let data = h.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8), !text.isEmpty else { return }
            // keep stderr quiet unless debugging — surface as system note
            if text.lowercased().contains("error") {
                onEvent(ChatLine(kind: .system, text: text.trimmingCharacters(in: .whitespacesAndNewlines)))
            }
        }

        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            readyContinuation = cont
            // timeout if ready never arrives
            Task {
                try await Task.sleep(nanoseconds: 8_000_000_000)
                if let c = self.readyContinuation {
                    self.readyContinuation = nil
                    c.resume(throwing: SuperSessionError.notReady)
                }
            }
        }
    }

    public func sendUser(_ text: String) async throws -> String {
        try await start()
        accumulatedAssistant = ""
        let payload = try JSONSerialization.data(
            withJSONObject: ["type": "user", "text": text],
            options: []
        )
        guard let stdinHandle else { throw SuperSessionError.notReady }
        stdinHandle.write(payload)
        stdinHandle.write(Data([0x0A]))

        return try await withCheckedThrowingContinuation { cont in
            turnContinuation = cont
        }
    }

    public func shutdown() {
        if let stdinHandle {
            if let data = try? JSONSerialization.data(withJSONObject: ["type": "shutdown"]) {
                try? stdinHandle.write(contentsOf: data)
                try? stdinHandle.write(contentsOf: Data([0x0A]))
            }
        }
        stdoutSource?.cancel()
        process?.terminate()
        process = nil
        stdinHandle = nil
    }

    private func consume(data: Data) {
        buffer.append(data)
        while let range = buffer.range(of: Data([0x0A])) {
            let lineData = buffer.subdata(in: buffer.startIndex..<range.lowerBound)
            buffer.removeSubrange(buffer.startIndex..<range.upperBound)
            guard !lineData.isEmpty,
                  let line = String(data: lineData, encoding: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                  let type = obj["type"] as? String
            else { continue }
            handleEvent(type: type, obj: obj)
        }
    }

    private func handleEvent(type: String, obj: [String: Any]) {
        switch type {
        case "ready":
            if let c = readyContinuation {
                readyContinuation = nil
                c.resume()
            }
            let root = obj["projectsRoot"] as? String ?? ""
            onEvent(ChatLine(kind: .system, text: "Super Agent ready · \(root)"))
        case "assistant_text":
            let text = obj["text"] as? String ?? ""
            accumulatedAssistant += text
            onEvent(ChatLine(kind: .assistant, text: text))
        case "tool_start":
            let name = obj["toolName"] as? String ?? "tool"
            let input = obj["toolInput"] as? [String: Any]
            let detail: String
            if let input, let data = try? JSONSerialization.data(withJSONObject: input),
               let s = String(data: data, encoding: .utf8)
            {
                detail = s
            } else {
                detail = ""
            }
            onEvent(ChatLine(kind: .tool, text: "→ \(name) \(detail)"))
        case "tool_end":
            let name = obj["toolName"] as? String ?? "tool"
            let result = (obj["toolResult"] as? String ?? "").prefix(280)
            onEvent(ChatLine(kind: .tool, text: "✓ \(name): \(result)"))
        case "turn_end":
            let text = obj["assistantText"] as? String ?? accumulatedAssistant
            if let c = turnContinuation {
                turnContinuation = nil
                c.resume(returning: text)
            }
        case "error":
            let err = obj["error"] as? String ?? "unknown error"
            onEvent(ChatLine(kind: .error, text: err))
            if let c = turnContinuation {
                turnContinuation = nil
                c.resume(throwing: SuperSessionError.remote(err))
            }
            if let c = readyContinuation {
                readyContinuation = nil
                c.resume(throwing: SuperSessionError.remote(err))
            }
        default:
            break
        }
    }
}

public enum SuperSessionError: Error, LocalizedError {
    case notReady
    case remote(String)

    public var errorDescription: String? {
        switch self {
        case .notReady: return "Super Agent process is not ready"
        case .remote(let s): return s
        }
    }
}
