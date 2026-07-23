import SwiftUI

@main
struct AgentMuxApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup("AgentMux") {
            ContentView(model: model)
                .accessibilityIdentifier("agentmux.root")
        }
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
    }
}
