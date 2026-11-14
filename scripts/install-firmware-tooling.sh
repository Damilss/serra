#!/usr/bin/env bash
#
# File: scripts/install-firmware-tooling.sh
# Author: Emilio Scott <milii76@outlook.com>
# Date: 2026-11-13
#
# Installs the tooling to build and flash the Pico 2 W firmware on the Pico SDK:
#   - arm-none-eabi-gcc   Arm GNU toolchain (compiler, linker, objdump, size)
#   - cmake, ninja        the Pico SDK's build system
#   - Pico SDK            pinned release, cloned with its submodules
#                         (cyw43-driver, btstack, lwip, mbedtls, tinyusb)
#   - picotool >= 2.0     loads images over USB (1.x does not support the RP2350)
#   - clang-format        C formatting (see CONTRIBUTING.md)
#   - host C/C++ compiler and python3: the SDK builds small host tools (pioasm)
#                         and generates BTstack GATT headers during the build
#
# The SDK goes to $PICO_SDK_PATH if set, otherwise ~/pico/pico-sdk. This script
# doesn't edit your shell profile: it prints the PICO_SDK_PATH line to add.
#
# Supported:
#   - Debian-based Linux with apt: Raspberry Pi OS on a Pi 5, Ubuntu, Debian
#   - macOS with Homebrew (installed if missing)
#
# Safe to re-run: tools that are already installed are skipped, and an existing
# SDK checkout is checked but never changed.
#
# Usage:
#   scripts/install-firmware-tooling.sh
#   DRY_RUN=1 scripts/install-firmware-tooling.sh    # print what would run, change nothing

set -euo pipefail

PICOTOOL_MIN_MAJOR=2
DRY_RUN="${DRY_RUN:-0}"

# Pico SDK release the firmware is built against. picotool and pico-examples
# use the same version number (pico-examples tags it as sdk-<version>).
PICO_SDK_VERSION=2.3.1
PICO_SDK_DIR="${PICO_SDK_PATH:-$HOME/pico/pico-sdk}"
PICO_SDK_SUBMODULES=(lib/btstack lib/cyw43-driver lib/lwip lib/mbedtls lib/tinyusb)

# Where picotool is built from source if no package is new enough (Linux only).
SRC_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/serra/tooling"

# ---- output helpers ----------------------------------------------------------

notice() { echo "NOTICE: $*"; }
warn() { echo "WARN: $*" >&2; }
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

have() { command -v "$1" >/dev/null 2>&1; }

# True if $1 is a directory with at least one entry. A submodule that was never
# initialised is an empty directory.
dir_not_empty() { [[ -d "$1" ]] && [[ -n "$(ls -A "$1" 2>/dev/null)" ]]; }

# Major version of the installed picotool ("picotool v2.3.1 (...)" -> 2), or 0.
picotool_major() {
	if ! have picotool; then
		echo 0
		return
	fi
	local out re='^picotool v([0-9]+)'
	out="$(picotool version 2>/dev/null || true)"
	# =~ is bash's built-in regex match; ( ) captures the major version
	# into BASH_REMATCH[1]. The regex lives in a variable so it works the
	# same on bash 3.2 (macOS) and bash 5 (Pi OS).
	if [[ "$out" =~ $re ]]; then
		echo "${BASH_REMATCH[1]}"
	else
		echo 0
	fi
}

picotool_ok() { [[ "$(picotool_major)" -ge "$PICOTOOL_MIN_MAJOR" ]]; }

# Release tag the SDK checkout is on, or "not on a release tag".
pico_sdk_tag() {
	git -C "$PICO_SDK_DIR" describe --tags --exact-match 2>/dev/null || echo "not on a release tag"
}

# ---- Pico SDK (both OSes) ----------------------------------------------------

install_pico_sdk() {
	if [[ -d "$PICO_SDK_DIR/.git" ]]; then
		# Someone's existing checkout: report, don't touch.
		local tag
		tag="$(pico_sdk_tag)"
		notice "Pico SDK found at $PICO_SDK_DIR ($tag)"
		if [[ "$tag" != "$PICO_SDK_VERSION" ]]; then
			warn "the firmware is pinned to Pico SDK $PICO_SDK_VERSION. To switch this checkout:"
			warn "  git -C \"$PICO_SDK_DIR\" fetch --depth 1 origin tag $PICO_SDK_VERSION"
			warn "  git -C \"$PICO_SDK_DIR\" checkout $PICO_SDK_VERSION"
			warn "  git -C \"$PICO_SDK_DIR\" submodule update --init"
		fi
		return
	fi
	[[ -e "$PICO_SDK_DIR" ]] && die "$PICO_SDK_DIR exists but isn't a git checkout; move it or set PICO_SDK_PATH"

	notice "cloning Pico SDK $PICO_SDK_VERSION into $PICO_SDK_DIR"
	run mkdir -p "$(dirname "$PICO_SDK_DIR")"
	run git clone --depth 1 --branch "$PICO_SDK_VERSION" \
		https://github.com/raspberrypi/pico-sdk.git "$PICO_SDK_DIR"
	# Without the submodules the radio driver and Bluetooth stack folders are
	# empty and BLE builds fail.
	notice "fetching Pico SDK submodules (this takes a few minutes)"
	run git -C "$PICO_SDK_DIR" submodule update --init
}

# Print the SDK's path, tag and submodule state. Returns 1 if anything is missing.
check_pico_sdk() {
	if [[ ! -f "$PICO_SDK_DIR/pico_sdk_init.cmake" ]]; then
		printf '  %-18s MISSING (%s)\n' pico-sdk "$PICO_SDK_DIR"
		return 1
	fi
	printf '  %-18s %s (%s)\n' pico-sdk "$PICO_SDK_DIR" "$(pico_sdk_tag)"

	local rc=0 sub
	for sub in "${PICO_SDK_SUBMODULES[@]}"; do
		if dir_not_empty "$PICO_SDK_DIR/$sub"; then
			printf '    %-16s ok\n' "$sub"
		else
			printf '    %-16s EMPTY: git -C "%s" submodule update --init\n' "$sub" "$PICO_SDK_DIR"
			rc=1
		fi
	done
	return "$rc"
}

# ---- Linux (apt) -------------------------------------------------------------

apt_install() {
	run sudo apt-get install -y "$@"
}

# Version apt would install for a package, from the "Candidate: 2.1.1-1" line
# of `apt-cache policy`. Prints nothing if there is no such line.
apt_candidate() {
	local key value
	apt-cache policy "$1" 2>/dev/null | while read -r key value; do
		if [[ "$key" == "Candidate:" ]]; then
			echo "$value"
		fi
	done
}

# Build picotool from source into /usr/local. Its build needs headers from the
# Pico SDK, so this uses the pinned SDK (install_pico_sdk runs first).
build_picotool_from_source() {
	notice "building picotool $PICO_SDK_VERSION from source in $SRC_DIR"
	apt_install build-essential cmake git pkg-config libusb-1.0-0-dev

	run mkdir -p "$SRC_DIR"

	local repo="$SRC_DIR/picotool"
	if [[ -d "$repo/.git" ]]; then
		notice "picotool already cloned, switching to $PICO_SDK_VERSION"
		run git -C "$repo" fetch --depth 1 origin tag "$PICO_SDK_VERSION"
		run git -C "$repo" checkout "$PICO_SDK_VERSION"
	else
		run git clone --depth 1 --branch "$PICO_SDK_VERSION" \
			https://github.com/raspberrypi/picotool.git "$repo"
	fi

	run cmake -S "$repo" -B "$repo/build" \
		-DPICO_SDK_PATH="$PICO_SDK_DIR" -DCMAKE_BUILD_TYPE=Release
	run cmake --build "$repo/build" -j"$(nproc)"
	run sudo cmake --install "$repo/build"
	hash -r

	# udev rules let picotool reach the board without sudo.
	local rules
	for rules in "$repo"/udev/*.rules; do
		[[ -e "$rules" ]] || continue
		notice "installing udev rule $(basename "$rules")"
		run sudo install -m 644 "$rules" /etc/udev/rules.d/
	done
	run sudo udevadm control --reload-rules
	run sudo udevadm trigger
}

install_picotool_linux() {
	if picotool_ok; then
		notice "picotool $(picotool_major).x is installed"
		return
	fi
	if have picotool; then
		warn "picotool $(picotool_major).x is too old for the RP2350 (need >= $PICOTOOL_MIN_MAJOR.0)"
	fi

	# Use the distro package if it's new enough (Raspberry Pi OS may ship 2.x).
	local candidate
	candidate="$(apt_candidate picotool || true)"
	if [[ "$candidate" =~ ^([0-9]+) ]] && [[ "${BASH_REMATCH[1]}" -ge "$PICOTOOL_MIN_MAJOR" ]]; then
		notice "installing picotool $candidate from apt"
		apt_install picotool
	else
		notice "apt picotool is '${candidate:-none}', too old or missing"
		build_picotool_from_source
	fi
}

install_linux() {
	have apt-get || die "this script only supports apt-based Linux (Raspberry Pi OS, Debian, Ubuntu)"

	notice "updating apt package lists"
	run sudo apt-get update

	have git || apt_install git
	# Host gcc/g++ for the SDK's build-time tools.
	have g++ || apt_install build-essential
	have python3 || apt_install python3
	have cmake || apt_install cmake
	have ninja || apt_install ninja-build
	# newlib: the C library the SDK links against on the Arm side.
	have arm-none-eabi-gcc || apt_install gcc-arm-none-eabi libnewlib-arm-none-eabi libstdc++-arm-none-eabi-newlib
	have clang-format || apt_install clang-format
	install_pico_sdk
	install_picotool_linux

	# The picotool udev rules grant access to the plugdev group.
	if ! id -nG | grep -qw plugdev; then
		warn "$USER is not in the plugdev group, so picotool may need sudo."
		warn "fix: sudo usermod -aG plugdev $USER   (then log out and back in)"
	fi
}

# ---- macOS (Homebrew) --------------------------------------------------------

install_homebrew() {
	notice "installing Homebrew (official installer, will ask for your password)"
	if [[ "$DRY_RUN" == 1 ]]; then
		echo "+ /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
		return
	fi
	/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" ||
		die "Homebrew install failed"

	# Put brew on PATH for the rest of this script.
	local prefix
	for prefix in /opt/homebrew /usr/local; do
		if [[ -x "$prefix/bin/brew" ]]; then
			eval "$("$prefix/bin/brew" shellenv)"
			break
		fi
	done
	have brew || die "Homebrew installed but brew is not on PATH; open a new terminal and re-run"
}

install_macos() {
	if have brew; then
		notice "Homebrew is installed"
	else
		install_homebrew
	fi

	# The Xcode command line tools provide git, python3 and the host compiler
	# the SDK uses for its build-time tools.
	if ! xcode-select -p >/dev/null 2>&1; then
		notice "Xcode command line tools missing: installing (a dialog will open)"
		run xcode-select --install || true
		die "re-run this script once the Xcode command line tools finish installing"
	fi

	have cmake || run brew install cmake
	have ninja || run brew install ninja

	# Official Arm GNU toolchain (the plain brew formula lacks some pieces).
	have arm-none-eabi-gcc || run brew install --cask gcc-arm-embedded

	if picotool_ok; then
		notice "picotool $(picotool_major).x is installed"
	elif have picotool; then
		run brew upgrade picotool
	else
		run brew install picotool
	fi

	have clang-format || run brew install clang-format
	install_pico_sdk
}

# ---- main --------------------------------------------------------------------

main() {
	local os
	os="$(uname -s)"
	notice "kernel: $os"
	[[ "$DRY_RUN" == 1 ]] && notice "dry run: nothing will be installed"

	case "$os" in
	Linux) install_linux ;;
	Darwin) install_macos ;;
	*) die "unsupported OS '$os': must be macOS or apt-based Linux" ;;
	esac

	[[ "$DRY_RUN" == 1 ]] && return

	# Verify everything the firmware build and flash steps need.
	echo
	notice "installed tools:"
	local missing=0 tool
	for tool in git python3 cmake ninja arm-none-eabi-gcc picotool clang-format; do
		if have "$tool"; then
			printf '  %-18s %s\n' "$tool" "$(command -v "$tool")"
		else
			printf '  %-18s MISSING\n' "$tool"
			missing=1
		fi
	done
	check_pico_sdk || missing=1

	echo
	if have arm-none-eabi-gcc; then
		echo "  $(arm-none-eabi-gcc --version | head -n 1)"
	fi
	if have picotool; then
		echo "  $(picotool version | head -n 1)"
	fi

	picotool_ok || die "picotool >= $PICOTOOL_MIN_MAJOR.0 is required for the RP2350"
	[[ "$missing" == 0 ]] || die "some tools are missing, see above"

	if [[ "${PICO_SDK_PATH:-}" != "$PICO_SDK_DIR" ]]; then
		echo
		warn "PICO_SDK_PATH isn't set. Add this to your shell profile (~/.bashrc or ~/.zshrc):"
		warn "  export PICO_SDK_PATH=\"$PICO_SDK_DIR\""
	fi

	echo
	notice "done. Smoke-test the SDK with pico-examples (see firmware/README.md)."
}

main "$@"
