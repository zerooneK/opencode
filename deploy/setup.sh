#!/bin/bash
# ============================================
# OpenCode Deployment Setup Script
# ============================================
# This script installs systemd services for
# OpenCode backend and web UI.
#
# Usage:
#   chmod +x deploy/setup.sh
#   sudo ./deploy/setup.sh
# ============================================

set -e

# ------ CONFIGURATION (change these) ------

# The Linux username that will run the services
USER_NAME="${OPENCODE_USER:-$(logname)}"

# Project directory (where this repo lives)
PROJECT_DIR="${OPENCODE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

# Server IP (the IP your team uses to access this)
SERVER_IP="${OPENCODE_IP:-127.0.0.1}"

# Path to bun binary
BUN_PATH="${OPENCODE_BUN:-$(which bun 2>/dev/null || echo "/home/$USER_NAME/.bun/bin/bun")}"

# Workspaces directory (where user workspaces are stored)
WORKSPACES_DIR="${OPENCODE_WORKSPACES_DIR:-/home/$USER_NAME/workspaces}"

# ------------------------------------------

echo ""
echo "=== OpenCode Deployment Setup ==="
echo ""
echo "  User:          $USER_NAME"
echo "  Project dir:   $PROJECT_DIR"
echo "  Server IP:     $SERVER_IP"
echo "  Bun path:      $BUN_PATH"
echo "  Workspaces:    $WORKSPACES_DIR"
echo ""

# Check bun exists
if [ ! -f "$BUN_PATH" ]; then
    echo "ERROR: bun not found at $BUN_PATH"
    echo "Set OPENCODE_BUN to the correct path, e.g.:"
    echo "  OPENCODE_BUN=/usr/local/bin/bun sudo ./deploy/setup.sh"
    exit 1
fi

# Check project dir exists
if [ ! -f "$PROJECT_DIR/package.json" ]; then
    echo "ERROR: package.json not found in $PROJECT_DIR"
    echo "Set OPENCODE_DIR to the correct path, e.g.:"
    echo "  OPENCODE_DIR=/home/tiger/opencode sudo ./deploy/setup.sh"
    exit 1
fi

# Generate service files from templates
echo "Creating service files..."

for SERVICE in opencode-backend opencode-web; do
    TEMPLATE="$PROJECT_DIR/deploy/${SERVICE}.service"
    TARGET="/etc/systemd/system/${SERVICE}.service"

    if [ ! -f "$TEMPLATE" ]; then
        echo "ERROR: Template not found: $TEMPLATE"
        exit 1
    fi

    sed \
        -e "s|__USER__|$USER_NAME|g" \
        -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" \
        -e "s|__SERVER_IP__|$SERVER_IP|g" \
        -e "s|__BUN_PATH__|$BUN_PATH|g" \
        -e "s|__WORKSPACES_DIR__|$WORKSPACES_DIR|g" \
        "$TEMPLATE" > "$TARGET"

    echo "  Created: $TARGET"
done

# Create workspaces directory
echo ""
echo "Creating workspaces directory..."
mkdir -p "$WORKSPACES_DIR"
chown "$USER_NAME:$USER_NAME" "$WORKSPACES_DIR"
echo "  Created: $WORKSPACES_DIR"

# Reload systemd
echo ""
echo "Reloading systemd..."
systemctl daemon-reload

# Enable services (start on boot)
echo "Enabling services..."
systemctl enable opencode-backend opencode-web

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Commands you can use now:"
echo ""
echo "  Start both:    sudo systemctl start opencode-backend opencode-web"
echo "  Stop both:     sudo systemctl stop opencode-web opencode-backend"
echo "  Restart both:  sudo systemctl restart opencode-backend opencode-web"
echo "  Check status:  sudo systemctl status opencode-backend"
echo "                 sudo systemctl status opencode-web"
echo "  View logs:     journalctl -u opencode-backend -f"
echo "                 journalctl -u opencode-web -f"
echo ""
echo "Your team can access OpenCode at: http://$SERVER_IP:3927"
echo ""
