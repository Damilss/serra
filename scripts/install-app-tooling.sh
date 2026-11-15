#!/usr/bin/env bash
#
# File: scripts/install-app-tooling.sh
# Author: Emilio Scott
# Date: 2026-11-14
#
# Installs the tooling to develop, test and run the base station dashboard (app/):
#   - Node.js             the major line pinned in app/.nvmrc (npm comes with it)
#   - npm packages        from app/package-lock.json (npm ci), which also turns on
#                         the repo-wide git hooks in app/.husky
#   - Playwright Chromium the browser the E2E tests run in
#   - gitleaks >= 8.19    secret scanner the pre-commit and pre-push hooks run
#                         (8.19 added the `gitleaks git` command the hooks use)
#   - Docker              runs the local Supabase database
#   - Supabase CLI        pinned version, cached so `npx supabase@...` works offline
#
# Set SKIP_DOCKER=1 to leave out Docker (UI-only work: the dashboard runs on its
# mock feed without a database).
#
# Supported:
#   - Debian-based Linux with apt: Ubuntu, Debian, Raspberry Pi OS
#   - macOS with Homebrew (installed if missing)
# Windows: follow the quick start in app/README.md (winget).
#
# Safe to re-run: tools that are already installed are skipped, and npm packages
# are only reinstalled when app/package-lock.json has changed.
#
# Usage:
#   scripts/install-app-tooling.sh
#   DRY_RUN=1 scripts/install-app-tooling.sh       # print what would run, change nothing
#   SKIP_DOCKER=1 scripts/install-app-tooling.sh   # no Docker / Supabase

set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"
SKIP_DOCKER="${SKIP_DOCKER:-0}"

# gitleaks release installed on Linux (apt's is too old for `gitleaks git`).
GITLEAKS_VERSION=8.30.1
GITLEAKS_MIN_MAJOR=8
GITLEAKS_MIN_MINOR=19

# Must match the version in app/supabase/README.md.
SUPABASE_CLI_VERSION=3.1.0

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/app"

# Node.js major line the app is developed and tested on. app/.nvmrc is the one
# place it's pinned (nvm and fnm read it too); main() fills this in.
NODE_MAJOR=

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

# Same as run, from inside app/.
run_in_app() {
	if [[ "$DRY_RUN" == 1 ]]; then
		echo "+ (cd app && $*)"
	else
		(cd "$APP_DIR" && "$@")
	fi
}

have() { command -v "$1" >/dev/null 2>&1; }

# True if version "$1.$2" is at least "$3.$4".
version_at_least() {
	[[ "$1" -gt "$3" ]] || { [[ "$1" -eq "$3" ]] && [[ "$2" -ge "$4" ]]; }
}

# "major minor" of the installed Node.js ("v24.10.0" -> "24 10"), or "0 0".
node_version() {
	local out re='^v([0-9]+)\.([0-9]+)'
	out="$(node --version 2>/dev/null || true)"
	# The regex lives in a variable so it works the same on bash 3.2 (macOS)
	# and bash 5 (Linux).
	if [[ "$out" =~ $re ]]; then
		echo "${BASH_REMATCH[1]} ${BASH_REMATCH[2]}"
	else
		echo "0 0"
	fi
}

# Major line pinned in app/.nvmrc ("26" or "v26.13.1" -> "26"). Fails if the
# file is missing or doesn't start with a version.
pinned_node_major() {
	local pin re='^v?([0-9]+)'
	[[ -f "$APP_DIR/.nvmrc" ]] || return 1
	read -r pin <"$APP_DIR/.nvmrc" || [[ -n "$pin" ]] || return 1
	[[ "$pin" =~ $re ]] || return 1
	echo "${BASH_REMATCH[1]}"
}

# True if the node on PATH is the major line pinned in app/.nvmrc.
node_ok() {
	local major minor
	read -r major minor <<<"$(node_version)"
	[[ "$major" == "$NODE_MAJOR" ]]
}

# Dies when the node on PATH comes from a version manager (nvm, fnm, volta...)
# rather than the system package manager under $1, since installing Node there
# wouldn't change which node runs.
die_if_node_is_managed_elsewhere() {
	local path
	have node || return 0
	path="$(command -v node)"
	[[ "$path" == "$1"/* ]] && return 0
	die "Node.js $(node --version) at $path isn't the pinned $NODE_MAJOR (app/.nvmrc) and isn't from the system package manager: run 'fnm use' or 'nvm install' in app/, then re-run"
}

# "major minor" of the installed gitleaks ("8.30.1" or "v8.30.1" -> "8 30"), or "0 0".
gitleaks_version() {
	local out re='^v?([0-9]+)\.([0-9]+)'
	out="$(gitleaks version 2>/dev/null || true)"
	if [[ "$out" =~ $re ]]; then
		echo "${BASH_REMATCH[1]} ${BASH_REMATCH[2]}"
	else
		echo "0 0"
	fi
}

gitleaks_ok() {
	local major minor
	read -r major minor <<<"$(gitleaks_version)"
	version_at_least "$major" "$minor" "$GITLEAKS_MIN_MAJOR" "$GITLEAKS_MIN_MINOR"
}

# Install directories of the browser builds the pinned Playwright runs Chromium
# with (Chromium, its headless shell, ffmpeg), one per line. `playwright install
# --dry-run` reports them without downloading, honours PLAYWRIGHT_BROWSERS_PATH,
# and names the exact revisions this Playwright version expects. Fails if the
# app's Playwright isn't installed yet.
playwright_chromium_dirs() {
	local line re='^[[:space:]]*Install location:[[:space:]]*(.+)$'
	while IFS= read -r line; do
		[[ "$line" =~ $re ]] && echo "${BASH_REMATCH[1]}"
	done < <(cd "$APP_DIR" && npx --no-install playwright install --dry-run chromium 2>/dev/null)
}

# True if every build the pinned Playwright needs for Chromium is fully
# installed. Playwright writes INSTALLATION_COMPLETE once a download finishes,
# so other projects' revisions or half-finished downloads don't count.
playwright_chromium_ok() {
	local dir found=0
	while IFS= read -r dir; do
		[[ -n "$dir" ]] || continue
		found=1
		[[ -f "$dir/INSTALLATION_COMPLETE" ]] || return 1
	done < <(playwright_chromium_dirs)
	[[ "$found" == 1 ]]
}

# ---- app setup (both OSes) ---------------------------------------------------

# npm ci when node_modules is missing or older than the lockfile. npm writes
# node_modules/.package-lock.json on every install, so its age says when the
# packages were last installed.
install_npm_packages() {
	local lock="$APP_DIR/package-lock.json" installed="$APP_DIR/node_modules/.package-lock.json"
	if [[ -f "$installed" ]] && [[ ! "$lock" -nt "$installed" ]]; then
		notice "npm packages are up to date with app/package-lock.json"
	else
		notice "installing npm packages from app/package-lock.json"
		run_in_app npm ci
	fi

	# npm ci runs the "prepare" script, which points git at app/.husky. Run it
	# again if the packages were already there but the hooks aren't on.
	if [[ "$(git -C "$REPO_ROOT" config core.hooksPath || true)" != app/.husky ]]; then
		notice "turning on the repo's git hooks (app/.husky)"
		run_in_app npm run prepare
	fi
}

install_playwright_chromium() {
	if playwright_chromium_ok; then
		notice "Playwright Chromium found in $(dirname "$(playwright_chromium_dirs | head -n 1)")"
		return
	fi
	notice "installing Playwright Chromium for the E2E tests"
	if [[ "$(uname -s)" == Linux ]]; then
		# --with-deps also installs the system libraries Chromium needs (uses sudo apt).
		run_in_app npx --no-install playwright install --with-deps chromium
	else
		run_in_app npx --no-install playwright install chromium
	fi
}

# Download the pinned Supabase CLI into the npx cache, so it runs offline later.
cache_supabase_cli() {
	[[ "$SKIP_DOCKER" == 1 ]] && return
	notice "caching Supabase CLI $SUPABASE_CLI_VERSION"
	run_in_app npx --yes "supabase@$SUPABASE_CLI_VERSION" --version
}

install_app() {
	install_npm_packages
	install_playwright_chromium
	cache_supabase_cli
}

# ---- Linux (apt) -------------------------------------------------------------

apt_install() {
	run sudo apt-get install -y "$@"
}

# Node.js from NodeSource: Debian and Ubuntu's own nodejs package is older than
# the pinned line, and NodeSource has one apt repository per major line.
install_node_linux() {
	if node_ok; then
		notice "Node.js $(node --version) is installed"
		return
	fi
	die_if_node_is_managed_elsewhere /usr/bin
	have node && warn "Node.js $(node --version) is installed, but app/.nvmrc pins Node.js $NODE_MAJOR"

	notice "installing Node.js $NODE_MAJOR from NodeSource"
	apt_install ca-certificates curl
	if [[ "$DRY_RUN" == 1 ]]; then
		echo "+ curl -fsSL https://deb.nodesource.com/setup_$NODE_MAJOR.x | sudo -E bash -"
	else
		curl -fsSL "https://deb.nodesource.com/setup_$NODE_MAJOR.x" | sudo -E bash - ||
			die "adding the NodeSource repository failed"
	fi
	apt_install nodejs
	hash -r
}

# gitleaks from its GitHub release, checked against the release's checksums.
install_gitleaks_linux() {
	if gitleaks_ok; then
		notice "gitleaks $(gitleaks version) is installed"
		return
	fi
	have gitleaks && warn "gitleaks $(gitleaks version) is too old (need >= $GITLEAKS_MIN_MAJOR.$GITLEAKS_MIN_MINOR)"

	local arch
	case "$(uname -m)" in
	x86_64) arch=x64 ;;
	aarch64 | arm64) arch=arm64 ;;
	armv7l) arch=armv7 ;;
	*) die "no gitleaks release for $(uname -m); install it by hand: https://github.com/gitleaks/gitleaks/releases" ;;
	esac

	local base="https://github.com/gitleaks/gitleaks/releases/download/v$GITLEAKS_VERSION"
	local tarball="gitleaks_${GITLEAKS_VERSION}_linux_${arch}.tar.gz"
	local sums="gitleaks_${GITLEAKS_VERSION}_checksums.txt"
	notice "installing gitleaks $GITLEAKS_VERSION into /usr/local/bin"
	if [[ "$DRY_RUN" == 1 ]]; then
		echo "+ curl -fsSLO $base/$tarball"
		echo "+ curl -fsSLO $base/$sums"
		echo "+ sha256sum -c (for $tarball)"
		echo "+ sudo install -m 755 gitleaks /usr/local/bin/gitleaks"
		return
	fi

	local tmp
	tmp="$(mktemp -d)"
	(
		cd "$tmp"
		curl -fsSLO "$base/$tarball"
		curl -fsSLO "$base/$sums"
		grep " $tarball\$" "$sums" | sha256sum -c - >/dev/null ||
			die "gitleaks download doesn't match its checksum"
		tar -xzf "$tarball" gitleaks
		sudo install -m 755 gitleaks /usr/local/bin/gitleaks
	)
	rm -rf "$tmp"
	hash -r
}

install_docker_linux() {
	[[ "$SKIP_DOCKER" == 1 ]] && return
	if have docker; then
		notice "Docker is installed"
	else
		notice "installing Docker (Debian's docker.io package)"
		apt_install docker.io
		run sudo systemctl enable --now docker
	fi

	# Without the docker group every docker (and supabase) command needs sudo.
	if ! id -nG | grep -qw docker; then
		warn "$USER is not in the docker group, so Supabase can't reach Docker without sudo."
		warn "fix: sudo usermod -aG docker $USER   (then log out and back in)"
	fi
}

install_linux() {
	have apt-get || die "this script only supports apt-based Linux (Ubuntu, Debian, Raspberry Pi OS)"

	notice "updating apt package lists"
	run sudo apt-get update

	have git || apt_install git
	have curl || apt_install curl
	install_node_linux
	install_gitleaks_linux
	install_docker_linux
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

# Homebrew formula that provides Node.js $NODE_MAJOR. "node@<major>" is an alias
# of "node" while that line is the newest release, and its own keg-only formula
# once a newer line takes over "node". Fails if Homebrew has no such line.
node_formula_macos() {
	local info re='^==> ([^:]+):'
	info="$(brew info --formula "node@$NODE_MAJOR" 2>/dev/null)" || return 1
	[[ "$info" =~ $re ]] || return 1
	echo "${BASH_REMATCH[1]}"
}

# Node.js from Homebrew. A keg-only node@<major> isn't on PATH until it's
# linked, and Homebrew's "node" has to be unlinked first to make room.
install_node_macos() {
	local prefix formula
	prefix="$(brew --prefix 2>/dev/null || echo /opt/homebrew)"
	die_if_node_is_managed_elsewhere "$prefix"
	have node && warn "Node.js $(node --version) is installed, but app/.nvmrc pins Node.js $NODE_MAJOR"
	formula="$(node_formula_macos)" || die "Homebrew has no Node.js $NODE_MAJOR (node@$NODE_MAJOR); check app/.nvmrc"

	notice "installing Node.js $NODE_MAJOR (Homebrew $formula)"
	if [[ "$formula" == node ]]; then
		if brew list --formula node >/dev/null 2>&1; then
			run brew upgrade node
		else
			run brew install node
		fi
	else
		run brew install "$formula"
		if brew list --formula node >/dev/null 2>&1; then
			run brew unlink node
		fi
		run brew link --overwrite --force "$formula"
	fi
	hash -r
}

install_macos() {
	if have brew; then
		notice "Homebrew is installed"
	else
		install_homebrew
	fi

	# The Xcode command line tools provide git.
	if ! xcode-select -p >/dev/null 2>&1; then
		notice "Xcode command line tools missing: installing (a dialog will open)"
		run xcode-select --install || true
		die "re-run this script once the Xcode command line tools finish installing"
	fi

	if node_ok; then
		notice "Node.js $(node --version) is installed"
	else
		install_node_macos
	fi

	if gitleaks_ok; then
		notice "gitleaks $(gitleaks version) is installed"
	elif have gitleaks; then
		run brew upgrade gitleaks
	else
		run brew install gitleaks
	fi

	if [[ "$SKIP_DOCKER" != 1 ]]; then
		if have docker || [[ -d /Applications/Docker.app ]]; then
			notice "Docker is installed"
		else
			notice "installing Docker Desktop"
			run brew install --cask docker-desktop
		fi
	fi
}

# ---- main --------------------------------------------------------------------

main() {
	local os
	os="$(uname -s)"
	notice "kernel: $os"
	NODE_MAJOR="$(pinned_node_major)" || die "app/.nvmrc is missing or doesn't name a Node.js version"
	notice "Node.js $NODE_MAJOR pinned in app/.nvmrc"
	[[ "$DRY_RUN" == 1 ]] && notice "dry run: nothing will be installed"
	[[ "$SKIP_DOCKER" == 1 ]] && notice "SKIP_DOCKER=1: leaving out Docker and the Supabase CLI"

	case "$os" in
	Linux) install_linux ;;
	Darwin) install_macos ;;
	*) die "unsupported OS '$os': must be macOS or apt-based Linux (Windows: see app/README.md)" ;;
	esac

	if [[ "$DRY_RUN" != 1 ]]; then
		node_ok || die "Node.js $NODE_MAJOR (app/.nvmrc) is required, found $(node --version 2>/dev/null || echo none); open a new terminal and re-run"
	fi
	install_app

	[[ "$DRY_RUN" == 1 ]] && return

	# Verify everything the dashboard, its checks and the git hooks need.
	echo
	notice "installed tools:"
	local missing=0 tool tools=(git node npm gitleaks)
	[[ "$SKIP_DOCKER" == 1 ]] || tools+=(docker)
	for tool in "${tools[@]}"; do
		if have "$tool"; then
			printf '  %-18s %s\n' "$tool" "$(command -v "$tool")"
		else
			printf '  %-18s MISSING\n' "$tool"
			missing=1
		fi
	done
	if [[ -d "$APP_DIR/node_modules" ]]; then
		printf '  %-18s %s\n' node_modules "$APP_DIR/node_modules"
	else
		printf '  %-18s MISSING: cd app && npm ci\n' node_modules
		missing=1
	fi
	if playwright_chromium_ok; then
		printf '  %-18s %s\n' chromium "$(playwright_chromium_dirs | head -n 1)"
	else
		printf '  %-18s MISSING: cd app && npx playwright install chromium\n' chromium
		missing=1
	fi
	local hooks
	hooks="$(git -C "$REPO_ROOT" config core.hooksPath || true)"
	if [[ "$hooks" == app/.husky ]]; then
		printf '  %-18s %s\n' git-hooks "$hooks"
	else
		printf '  %-18s OFF: cd app && npm run prepare\n' git-hooks
		missing=1
	fi

	echo
	echo "  node $(node --version), npm $(npm --version)"
	have gitleaks && echo "  gitleaks $(gitleaks version)"
	if [[ "$SKIP_DOCKER" != 1 ]] && have docker; then
		echo "  $(docker --version)"
	fi

	gitleaks_ok || die "gitleaks >= $GITLEAKS_MIN_MAJOR.$GITLEAKS_MIN_MINOR is required by the git hooks"
	[[ "$missing" == 0 ]] || die "some tools are missing, see above"

	if [[ "$SKIP_DOCKER" != 1 ]] && ! docker info >/dev/null 2>&1; then
		echo
		warn "Docker is installed but not running. Start Docker Desktop (macOS) or the docker"
		warn "service (Linux) before running Supabase."
	fi

	echo
	notice "done. Next, from app/:"
	notice "  npm run dev                              # dashboard at http://localhost:3000"
	notice "  npm run check                            # lint, typecheck, format, E2E"
	if [[ "$SKIP_DOCKER" != 1 ]]; then
		notice "  npx supabase@$SUPABASE_CLI_VERSION start               # first run pulls ~2 GB of images: do it with internet"
	fi
}

main "$@"
