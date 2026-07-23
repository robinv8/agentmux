import SwiftUI
import AppKit

@main
struct AgentMuxApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup("AgentMux") {
            ContentView(model: model)
                .accessibilityIdentifier("agentmux.root")
                .onAppear {
                    // Second chance after SwiftUI creates the window.
                    NSApp.setActivationPolicy(.regular)
                    NSApp.activate(ignoringOtherApps: true)
                    DispatchQueue.main.async {
                        NSApp.windows.forEach { $0.makeKeyAndOrderFront(nil) }
                    }
                }
        }
        .defaultSize(width: 960, height: 640)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
    }
}
