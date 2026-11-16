#!/usr/bin/env bash
# Install WakeUp like a regular app:  npm run dist && bash scripts/install.sh
# Uninstall:                          bash scripts/install.sh --uninstall
# Installs the unpacked build to ~/.local/lib/wakeup (starts ~4x faster than an AppImage, which mounts itself on every launch).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIB="$HOME/.local/lib/wakeup"
BIN="$LIB/wakeup"
OLD_APPIMAGE="$HOME/Applications/WakeUp.AppImage"
APPS="$HOME/.local/share/applications"
DESKTOP="$APPS/wakeup.desktop"
ICONS="$HOME/.local/share/icons/hicolor"
SIZES="16 24 32 48 64 128 256 512"

favorites() { gsettings get org.gnome.shell favorite-apps 2>/dev/null || echo "@as []"; }
set_favorites() { gsettings set org.gnome.shell favorite-apps "$1" 2>/dev/null || true; }
drop_fav() { sed "s/, '$1'//; s/'$1', //; s/'$1'//"; }
running() { pgrep -f "^$LIB/wakeup" >/dev/null || pgrep -f "/tmp/\.mount_WakeU" >/dev/null || pgrep -f "/tmp/\.mount_WorkH" >/dev/null; }

# Ask a running WakeUp to quit (it saves its layout first), then wait for it.
stop_app() {
  [ -x "$BIN" ] && "$BIN" --quit >/dev/null 2>&1 || true
  pkill -TERM -f "/tmp/\.mount_WakeU" 2>/dev/null || true   # the old AppImage
  pkill -TERM -f "/tmp/\.mount_WorkH" 2>/dev/null || true   # the older Work Hub AppImage
  for _ in $(seq 1 40); do running || return 0; sleep 0.25; done
  echo "WakeUp didn't quit; stopping it."; pkill -KILL -f "^$LIB/wakeup" 2>/dev/null || true
}

# Remove what older installs left behind (sign-ins stay in ~/.config/WakeUp).
remove_legacy() {
  rm -f "$OLD_APPIMAGE" "$HOME/Applications/WorkHub.AppImage" "$APPS/workhub.desktop"
  for s in $SIZES; do rm -f "$ICONS/${s}x${s}/apps/workhub.png"; done
}

if [ "${1:-}" = "--uninstall" ]; then
  stop_app
  remove_legacy
  rm -rf "$LIB"
  rm -f "$DESKTOP" "$HOME/.config/autostart/wakeup.desktop"
  for s in $SIZES; do rm -f "$ICONS/${s}x${s}/apps/wakeup.png"; done
  set_favorites "$(favorites | drop_fav wakeup.desktop)"
  update-desktop-database "$APPS" 2>/dev/null || true
  echo "WakeUp removed (your sign-ins stay in ~/.config/WakeUp)."
  exit 0
fi

SRC="$ROOT/dist/linux-unpacked"
[ -x "$SRC/wakeup" ] || { echo "No build found. Run: npm run dist"; exit 1; }

WAS_RUNNING=0; running && WAS_RUNNING=1
stop_app

# Swap in the new build in one step, so a failed copy never leaves a half-installed app.
mkdir -p "$(dirname "$LIB")"
rm -rf "$LIB.new"; cp -a "$SRC" "$LIB.new"
rm -rf "$LIB.old"; [ -d "$LIB" ] && mv "$LIB" "$LIB.old"
mv "$LIB.new" "$LIB"; rm -rf "$LIB.old"

for s in $SIZES; do
  install -Dm644 "$ROOT/build/icons/${s}x${s}.png" "$ICONS/${s}x${s}/apps/wakeup.png"
done
gtk-update-icon-cache -f -t "$ICONS" >/dev/null 2>&1 || true

# The app writes its own launcher (with a dock right-click entry per app) and keeps it current.
"$BIN" --install-desktop

# Dock: take over an old Work Hub pin in place, or pin once.
FAV="$(favorites)"
if [[ "$FAV" == *"workhub.desktop"* && "$FAV" != *"wakeup.desktop"* ]]; then
  set_favorites "${FAV//workhub.desktop/wakeup.desktop}"
elif [[ "$FAV" == *"[]"* ]]; then
  set_favorites "['wakeup.desktop']"
elif [[ "$FAV" != *"wakeup.desktop"* ]]; then
  set_favorites "${FAV%]*}, 'wakeup.desktop']"
fi
FAV="$(favorites)"; [[ "$FAV" == *"workhub.desktop"* ]] && set_favorites "$(echo "$FAV" | drop_fav workhub.desktop)"

remove_legacy
update-desktop-database "$APPS" 2>/dev/null || true
echo "Installed: $BIN  (in app grid, search and dock; right-click the dock icon to open one app)"
if [ "$WAS_RUNNING" = 1 ]; then setsid -f "$BIN" >/dev/null 2>&1 || true; echo "Restarted WakeUp."; fi
