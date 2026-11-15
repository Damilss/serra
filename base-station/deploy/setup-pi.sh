#!/usr/bin/env bash
#
# File: base-station/deploy/setup-pi.sh
# Date: 2026-11-14
#
# One-time setup of the base-station Pi 5: installs and starts serra-base as a
# systemd service, so the decoder runs on boot and restarts if it crashes.
#
# Run it after the code is on the Pi and uv is installed (README "Pi setup",
# steps 1-3), while the Pi still has internet: it runs `uv sync` so the service
# can start offline later. Gadget mode is separate (`sudo rpi-usb-gadget on`).
#
# Safe to re-run: it re-syncs, re-renders the unit and restarts the service.
#
# --uninstall stops and disables the service and removes the unit. It keeps
# captures/ (recordings), .venv and your bluetooth group membership, so a later
# install picks up where this left off. Also safe to re-run.
#
# Usage:
#   sudo deploy/setup-pi.sh
#   sudo deploy/setup-pi.sh --uninstall
#   sudo DRY_RUN=1 deploy/setup-pi.sh [--uninstall]    # print what would run, change nothing

set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"
UNIT=serra-base.service
UNIT_DST="/etc/systemd/system/$UNIT"

notice() { echo "NOTICE: $*"; }
die() {
	echo "ERROR: $*" >&2
	exit 1
}

# Run a command, or only print it in dry-run mode.
run() {
	if [[ "$DRY_RUN" == 1 ]]; then
		echo "+ $*"
	else
		"$@"
	fi
}

# Stop and disable the service and remove its unit; leave everything else.
uninstall() {
	if [[ ! -f "$UNIT_DST" ]]; then
		notice "$UNIT is not installed; nothing to do"
		return
	fi
	run systemctl disable --now "$UNIT"
	run rm -f "$UNIT_DST"
	run systemctl daemon-reload
	notice "removed $UNIT. Kept captures/, .venv and the bluetooth group."
	echo "  reinstall:                 sudo $0"
	echo "  leave the bluetooth group: sudo gpasswd -d ${SUDO_USER:-<user>} bluetooth"
}

USAGE="usage: sudo $0 [--uninstall]"
ACTION=install
[[ $# -le 1 ]] || die "$USAGE"
case "${1:-}" in
"") ;;
--uninstall) ACTION=uninstall ;;
-h | --help)
	echo "$USAGE"
	exit 0
	;;
*) die "unknown option: $1 ($USAGE)" ;;
esac

[[ "$(id -u)" == 0 ]] || die "run with sudo: sudo $0${1:+ $1}"
[[ "$(uname -s)" == Linux ]] || die "this sets up the Pi (Linux with systemd); on a laptop just run: uv run serra-base"
command -v systemctl >/dev/null 2>&1 || die "systemctl not found; this needs systemd"

if [[ "$ACTION" == uninstall ]]; then
	uninstall
	exit 0
fi

# The service runs as the user who called sudo, from this checkout.
SVC_USER="${SUDO_USER:-}"
[[ -n "$SVC_USER" && "$SVC_USER" != root ]] || die "run with sudo from your normal user, not as root"
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$BASE_DIR/deploy/$UNIT"
[[ -f "$TEMPLATE" ]] || die "missing $TEMPLATE"

# uv is usually in the user's ~/.local/bin, which root's PATH doesn't have.
USER_HOME="$(getent passwd "$SVC_USER" | cut -d: -f6)"
UV=""
for candidate in "$USER_HOME/.local/bin/uv" "$USER_HOME/.cargo/bin/uv" "$(command -v uv || true)"; do
	if [[ -n "$candidate" && -x "$candidate" ]]; then
		UV="$candidate"
		break
	fi
done
[[ -n "$UV" ]] || die "uv not found for $SVC_USER; install it first: curl -LsSf https://astral.sh/uv/install.sh | sh"

notice "user $SVC_USER, checkout $BASE_DIR, uv $UV"

# Dependencies into .venv, as the user, from the lockfile.
run sudo -u "$SVC_USER" -H "$UV" sync --frozen --no-dev --project "$BASE_DIR"
run sudo -u "$SVC_USER" mkdir -p "$BASE_DIR/captures"

# Bluetooth scanning over D-Bus is allowed for the bluetooth group.
if getent group bluetooth >/dev/null; then
	run usermod -aG bluetooth "$SVC_USER"
else
	notice "no bluetooth group; is BlueZ installed? (sudo apt install bluez)"
fi

# Render the unit with this Pi's user and paths.
if [[ "$DRY_RUN" == 1 ]]; then
	echo "+ render $TEMPLATE -> $UNIT_DST (User=$SVC_USER, WorkingDirectory=$BASE_DIR)"
else
	sed -e "s|@USER@|$SVC_USER|g" -e "s|@BASE_DIR@|$BASE_DIR|g" "$TEMPLATE" >"$UNIT_DST"
	chmod 644 "$UNIT_DST"
fi

run systemctl daemon-reload
run systemctl enable "$UNIT"
run systemctl restart "$UNIT"

notice "installed. Check it with:"
echo "  systemctl status serra-base"
echo "  journalctl -u serra-base -f"
echo "  curl http://localhost:8080/health          # on the Pi"
echo "  curl http://10.12.194.1:8080/health        # from the laptop, in gadget mode"
