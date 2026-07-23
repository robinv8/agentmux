import AppKit

/// SPM-built SwiftUI executables are not .app bundles; without an explicit
/// activation policy the process stays a background/accessory app and never
/// receives keyboard focus.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)

        // Bring every open window forward and make the first one key.
        for window in NSApp.windows {
            window.makeKeyAndOrderFront(nil)
            window.collectionBehavior.insert(.moveToActiveSpace)
        }
        if let window = NSApp.windows.first {
            window.makeKeyAndOrderFront(nil)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
