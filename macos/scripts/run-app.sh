#!/usr/bin/env bash
# Build and launch AgentMux as a real .app so macOS grants key-window / typing focus.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

swift build --product AgentMuxApp

BIN="$ROOT/.build/arm64-apple-macosx/debug/AgentMuxApp"
if [[ ! -x "$BIN" ]]; then
  # Universal / alternate triple
  BIN="$(ls -1 "$ROOT"/.build/*/debug/AgentMuxApp | head -1)"
fi
APP="$ROOT/.build/AgentMux.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/AgentMux"
chmod +x "$APP/Contents/MacOS/AgentMux"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>AgentMux</string>
  <key>CFBundleIdentifier</key>
  <string>com.robinv8.agentmux</string>
  <key>CFBundleName</key>
  <string>AgentMux</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST

# Replace any previous instance started from this bundle path
pkill -x AgentMux 2>/dev/null || true
sleep 0.2
open "$APP"
echo "Launched: $APP"
