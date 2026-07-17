#!/bin/bash
set -e

LABEL="com.thingelstad.thingy-bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BRIDGE_DIR/../.." && pwd)"
LOG_DIR="$BRIDGE_DIR/logs"
VENV="$REPO_ROOT/.venv"

require_environment() {
    if [ ! -x "$VENV/bin/python" ]; then
        echo "Error: locked uv environment not found at $VENV." >&2
        echo "  Create it with: (cd $REPO_ROOT && uv sync --locked --no-dev)" >&2
        exit 1
    fi
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
    require_environment
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
    stop_bot

    echo "==> Pulling latest from origin..."
    (cd "$REPO_ROOT" && git pull --ff-only origin main)

    echo "==> Updating dependencies..."
    (cd "$REPO_ROOT" && uv sync --locked --no-dev)

    start_bot
}

backup_db() {
    require_environment
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
