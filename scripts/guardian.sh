#!/bin/bash
# nunect Guardian Service Management Script
# Usage: ./guardian.sh [start|stop|restart|status]

set -e

# =============================================================================
# Load Environment
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env"
PID_FILE="$PROJECT_ROOT/.guardian.pid"
LOG_DIR="$PROJECT_ROOT/logs"

# Check for .env file
if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: .env file not found at $ENV_FILE"
    echo "Copy .env.template to .env and customize:"
    echo "  cp .env.template .env"
    exit 1
fi

# Source .env (export all variables)
set -a
source "$ENV_FILE"
set +a

# =============================================================================
# Configuration
# =============================================================================

# NATS connection URL - use native NATS protocol on port 4222
export NATS_URL="nats://localhost:${NATS_PORT:-4222}"

# =============================================================================
# Helper Functions
# =============================================================================

is_running() {
    local pid_file=$1
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# =============================================================================
# Start Guardian
# =============================================================================

cmd_start() {
    if is_running "$PID_FILE"; then
        echo "Guardian is already running (PID: $(cat $PID_FILE))"
        return 0
    fi
    
    # Check if guardian binary exists
    GUARDIAN_BIN="$PROJECT_ROOT/guardian"
    
    # If not built, build it
    if [ ! -f "$GUARDIAN_BIN" ]; then
        echo "Building guardian..."
        cd "$PROJECT_ROOT"
        go build -o guardian ./cmd/guardian/main.go
        echo "Build complete."
    fi
    
    if [ ! -f "$GUARDIAN_BIN" ]; then
        echo "ERROR: Guardian binary not found and could not be built"
        exit 1
    fi
    
    # Create log directory
    mkdir -p "$LOG_DIR"
    
    echo "Starting nunect Guardian..."
    echo "  NATS URL: $NATS_URL"
    echo "  User: ${NATS_SYS_USER:-admin}"
    echo "  Profile: $PROJECT_ROOT/connector-profile.yaml"
    
    # Start guardian from project root so it finds connector-profile.yaml
    cd "$PROJECT_ROOT"
    nohup "$GUARDIAN_BIN" >> "$LOG_DIR/guardian.log" 2>&1 &
    echo $! > "$PID_FILE"
    
    # Wait a moment and check if started
    sleep 1
    if is_running "$PID_FILE"; then
        echo "Guardian started (PID: $(cat $PID_FILE))"
        echo "View logs: tail -f $LOG_DIR/guardian.log"
    else
        echo "ERROR: Guardian failed to start"
        rm -f "$PID_FILE"
        exit 1
    fi
}

# =============================================================================
# Stop Guardian
# =============================================================================

cmd_stop() {
    if is_running "$PID_FILE"; then
        local pid=$(cat "$PID_FILE")
        echo "Stopping Guardian (PID: $pid)..."
        kill "$pid" 2>/dev/null || true
        rm -f "$PID_FILE"
        echo "Guardian stopped"
    else
        echo "Guardian is not running"
        rm -f "$PID_FILE"
    fi
}

# =============================================================================
# Restart Guardian
# =============================================================================

cmd_restart() {
    cmd_stop
    sleep 1
    cmd_start
}

# =============================================================================
# Status Check
# =============================================================================

cmd_status() {
    echo "=== nunect Guardian Status ==="
    echo ""
    
    if is_running "$PID_FILE"; then
        local pid=$(cat "$PID_FILE")
        echo "Guardian: RUNNING (PID: $pid)"
        echo "  Config: $PROJECT_ROOT/connector-profile.yaml"
        echo "  NATS:   $NATS_URL"
        echo "  User:   ${NATS_SYS_USER:-admin}"
        echo "  Logs:   $LOG_DIR/guardian.log"
    else
        echo "Guardian: STOPPED"
        echo ""
        echo "To start: ./scripts/guardian.sh start"
    fi
}

# =============================================================================
# Build Guardian
# =============================================================================

cmd_build() {
    echo "Building guardian..."
    cd "$PROJECT_ROOT"
    go build -o guardian ./cmd/guardian/main.go
    echo "Build complete: $PROJECT_ROOT/guardian"
}

# =============================================================================
# Main Command Dispatch
# =============================================================================

COMMAND=${1:-status}

case "$COMMAND" in
    start)
        cmd_start
        ;;
    stop)
        cmd_stop
        ;;
    restart)
        cmd_restart
        ;;
    status)
        cmd_status
        ;;
    build)
        cmd_build
        ;;
    *)
        echo "Usage: $0 [start|stop|restart|status|build]"
        echo ""
        echo "Commands:"
        echo "  start    Start Guardian service"
        echo "  stop     Stop Guardian service"
        echo "  restart  Restart Guardian service"
        echo "  status   Show Guardian status"
        echo "  build    Build Guardian binary"
        exit 1
        ;;
esac
