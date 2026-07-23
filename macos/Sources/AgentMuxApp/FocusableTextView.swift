import AppKit
import SwiftUI

/// AppKit-backed multiline editor. SwiftUI `TextField`/`TextEditor` often fail
/// to become first responder inside NavigationSplitView when the host is not a
/// proper .app bundle; NSTextView first-responder handling is reliable.
struct FocusableTextView: NSViewRepresentable {
    @Binding var text: String
    var isEditable: Bool = true
    var placeholder: String = ""
    var onSubmit: (() -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = false
        scroll.autohidesScrollers = true
        scroll.borderType = .bezelBorder
        scroll.drawsBackground = true

        let textView = NSTextView()
        textView.delegate = context.coordinator
        textView.isRichText = false
        textView.allowsUndo = true
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.font = NSFont.systemFont(ofSize: NSFont.systemFontSize)
        textView.textContainerInset = NSSize(width: 6, height: 8)
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.containerSize = NSSize(
            width: scroll.contentSize.width,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.string = text
        textView.isEditable = isEditable
        textView.isSelectable = true

        scroll.documentView = textView
        context.coordinator.textView = textView
        context.coordinator.placeholder = placeholder

        // Become first responder after the view is in a window.
        DispatchQueue.main.async {
            scroll.window?.makeFirstResponder(textView)
        }

        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let textView = scroll.documentView as? NSTextView else { return }
        context.coordinator.parent = self
        context.coordinator.placeholder = placeholder
        textView.isEditable = isEditable
        if textView.string != text {
            let selected = textView.selectedRanges
            textView.string = text
            textView.selectedRanges = selected
        }
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: FocusableTextView
        weak var textView: NSTextView?
        var placeholder: String = ""

        init(_ parent: FocusableTextView) {
            self.parent = parent
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            parent.text = textView.string
        }

        func textView(_ textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
            // ⌘↩ submits when provided.
            if commandSelector == #selector(NSResponder.insertNewline(_:)),
               NSEvent.modifierFlags.contains(.command)
            {
                parent.onSubmit?()
                return true
            }
            return false
        }
    }
}

/// Single-line AppKit field for the projects root path.
struct FocusableLineField: NSViewRepresentable {
    @Binding var text: String
    var placeholder: String = ""
    var onSubmit: (() -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> NSTextField {
        let field = NSTextField(string: text)
        field.placeholderString = placeholder
        field.isBordered = true
        field.isBezeled = true
        field.bezelStyle = .roundedBezel
        field.delegate = context.coordinator
        field.font = NSFont.systemFont(ofSize: NSFont.smallSystemFontSize)
        field.focusRingType = .default
        return field
    }

    func updateNSView(_ field: NSTextField, context: Context) {
        context.coordinator.parent = self
        if field.stringValue != text {
            field.stringValue = text
        }
        field.placeholderString = placeholder
    }

    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: FocusableLineField

        init(_ parent: FocusableLineField) {
            self.parent = parent
        }

        func controlTextDidChange(_ obj: Notification) {
            guard let field = obj.object as? NSTextField else { return }
            parent.text = field.stringValue
        }

        func control(
            _ control: NSControl,
            textView: NSTextView,
            doCommandBy commandSelector: Selector
        ) -> Bool {
            if commandSelector == #selector(NSResponder.insertNewline(_:)) {
                parent.onSubmit?()
                return true
            }
            return false
        }
    }
}
