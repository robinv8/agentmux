#!/usr/bin/env bash
# One-line install for AgentMux (bundles Pi coding agent as a dependency).
#
#   curl -fsSL https://raw.githubusercontent.com/robinv8/agentmux/main/scripts/install.sh | bash
#
# Env:
#   AGENTMUX_HOME   install directory (default: ~/.agentmux)
#   AGENTMUX_REPO   git URL (default: https://github.com/robinv8/agentmux.git)
#   AGENTMUX_REF    git ref/branch (default: main)
set -euo pipefail

HOME_DIR="${HOME:-$(eval echo ~)}"
INSTALL_DIR="${AGENTMUX_HOME:-$HOME_DIR/.agentmux}"
REPO_URL="${AGENTMUX_REPO:-https://github.com/robinv8/agentmux.git}"
REPO_REF="${AGENTMUX_REF:-main}"
BIN_DIR="${AGENTMUX_BIN_DIR:-$HOME_DIR/.local/bin}"

info() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

ensure_bun() {
  if command -v bun >/dev/null 2>&1; then
    return 0
  fi
  info "Bun not found — installing Bun (https://bun.sh)"
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${BUN_INSTALL:-$HOME_DIR/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
  command -v bun >/dev/null 2>&1 || die "Bun install finished but bun is not on PATH. Open a new shell and re-run."
}

ensure_git() {
  command -v git >/dev/null 2>&1 || die "git is required"
}

checkout() {
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Updating AgentMux in $INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$REPO_REF"
    git -C "$INSTALL_DIR" checkout -q FETCH_HEAD
  else
    info "Cloning AgentMux → $INSTALL_DIR"
    rm -rf "$INSTALL_DIR"
    git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$INSTALL_DIR" \
      || git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    if [[ "$REPO_REF" != "main" && "$REPO_REF" != "master" ]]; then
      git -C "$INSTALL_DIR" checkout -q "$REPO_REF" 2>/dev/null || true
    fi
  fi
}

install_deps() {
  info "Installing dependencies (includes @earendil-works/pi-coding-agent)"
  cd "$INSTALL_DIR"
  # Prefer npm for registry integrity reliability; fall back to bun.
  if command -v npm >/dev/null 2>&1; then
    npm install --ignore-scripts
  else
    bun install --ignore-scripts || bun install --force --ignore-scripts
  fi

  if [[ ! -f "$INSTALL_DIR/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" ]]; then
    die "Pi coding agent did not install under node_modules. Check network and re-run."
  fi
}

link_bins() {
  mkdir -p "$BIN_DIR"
  chmod +x "$INSTALL_DIR/bin/agentmux.js"
  ln -sfn "$INSTALL_DIR/bin/agentmux.js" "$BIN_DIR/agentmux"
  ln -sfn "$INSTALL_DIR/bin/agentmux.js" "$BIN_DIR/am"
  info "Linked am + agentmux → $BIN_DIR"
}

ensure_path_hint() {
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
      info "Add to your shell profile if needed:"
      echo "  export PATH=\"$BIN_DIR:\$PATH\""
      export PATH="$BIN_DIR:$PATH"
      ;;
  esac
  # bun must remain on PATH for the shebang
  if ! command -v bun >/dev/null 2>&1; then
    export BUN_INSTALL="${BUN_INSTALL:-$HOME_DIR/.bun}"
    export PATH="$BUN_INSTALL/bin:$PATH"
  fi
}

verify() {
  ensure_path_hint
  command -v am >/dev/null 2>&1 || die "am not on PATH after install"
  info "Verifying bundled Pi resolution"
  bun -e "
    import { resolvePiBinary } from './src/pi-path.ts';
    const p = resolvePiBinary({ envPiBin: '' });
    if (p === 'pi') {
      console.error('warn: bundled Pi not resolved, will rely on PATH');
      process.exit(0);
    }
    console.log('Pi binary:', p);
  " --cwd "$INSTALL_DIR" 2>/dev/null \
    || bun "$INSTALL_DIR/bin/agentmux.js" --help >/dev/null

  info "Installed AgentMux. Try:"
  echo "  am list"
  echo "  am <project> <message>"
  am --help | head -n 4 || true
}

ensure_git
ensure_bun
checkout
install_deps
link_bins
verify
