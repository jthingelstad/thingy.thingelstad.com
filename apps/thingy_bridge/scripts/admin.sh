#!/bin/bash
set -e

LABEL="com.thingelstad.thingy-bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BRIDGE_DIR/../.." && pwd)"
LOG_DIR="$BRIDGE_DIR/logs"

resolve_venv() {
    if [ -n "${THINGY_BRIDGE_VENV:-}" ] && [ -x "$THINGY_BRIDGE_VENV/bin/python" ]; then
        echo "$THINGY_BRIDGE_VENV"
        return
    fi
    if [ -x "$REPO_ROOT/venv/bin/python" ]; then
        echo "$REPO_ROOT/venv"
        return
    fi
    if [ -x "$BRIDGE_DIR/venv/bin/python" ]; then
        echo "$BRIDGE_DIR/venv"
        return
    fi
    return 1
}

require_venv() {
    if ! VENV="$(resolve_venv)"; then
        echo "Error: no Python venv found." >&2
        echo "  Looked in: \$THINGY_BRIDGE_VENV, $REPO_ROOT/venv, $BRIDGE_DIR/venv" >&2
        echo "  Create one with:  python3 -m venv $REPO_ROOT/venv && $REPO_ROOT/venv/bin/pip install -r $BRIDGE_DIR/requirements.txt" >&2
        exit 1
    fi
    echo "$VENV"
}

status() {
    if launchctl list | grep -q "$LABEL"; then
        echo "thingy-bridge is running."
    else
        echo "thingy-bridge is stopped."
    fi
}

stop_bot() {
    echo "==> Stopping thingy-bridge..."
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    sleep 1
    status
}

start_bot() {
    if [ ! -f "$PLIST" ]; then
        echo "Error: plist not found at $PLIST"
        echo "Run '$0 install' first."
        exit 1
    fi
    echo "==> Starting thingy-bridge..."
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    sleep 3
    status
}

restart_bot() {
    stop_bot
    start_bot
}

install_bot() {
    VENV="$(require_venv)"
    mkdir -p "$LOG_DIR"
    echo "==> Installing launchd plist..."
    echo "    venv:    $VENV"
    echo "    cwd:     $REPO_ROOT"
    echo "    logs:    $LOG_DIR"
    mkdir -p "$(dirname "$PLIST")"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$VENV/bin/python</string>
        <string>-m</string>
        <string>apps.thingy_bridge.bot</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO_ROOT</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$VENV/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
        <key>PYTHONUNBUFFERED</key>
        <string>1</string>
    </dict>
    <key>RunAtLoad</key>
    <false/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>300</integer>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/bridge.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/bridge.err</string>
</dict>
</plist>
PLIST
    echo "Installed $PLIST"
}

upgrade_bot() {
    VENV="$(require_venv)"
    stop_bot

    echo "==> Pulling latest from origin..."
    (cd "$REPO_ROOT" && git pull origin main)

    echo "==> Updating dependencies..."
    "$VENV/bin/pip" install -q -r "$BRIDGE_DIR/requirements.txt"

    start_bot
}

backup_db() {
    VENV="$(require_venv)"
    echo "==> Backing up thingy_bridge.db..."
    "$VENV/bin/python" "$SCRIPT_DIR/backup_db.py"
}

tail_logs() {
    mkdir -p "$LOG_DIR"
    touch "$LOG_DIR/bridge.log" "$LOG_DIR/bridge.err"
    echo "==> Tailing $LOG_DIR/bridge.{log,err} (Ctrl-C to stop)..."
    tail -F "$LOG_DIR/bridge.log" "$LOG_DIR/bridge.err"
}

case "${1:-}" in
    stop)     stop_bot ;;
    start)    start_bot ;;
    restart)  restart_bot ;;
    upgrade)  upgrade_bot ;;
    install)  install_bot ;;
    status)   status ;;
    backup)   backup_db ;;
    tail)     tail_logs ;;
    *)
        echo "Usage: $0 {start|stop|restart|upgrade|install|status|backup|tail}"
        exit 1
        ;;
esac
