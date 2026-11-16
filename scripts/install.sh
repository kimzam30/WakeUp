#!/usr/bin/env bash
# Install WakeUp like a regular app:  bash scripts/install.sh [path/to/WakeUp.AppImage]
# Uninstall:                          bash scripts/install.sh --uninstall
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPDIR="$HOME/Applications"
TARGET="$APPDIR/WakeUp.AppImage"
APPS="$HOME/.local/share/applications"
DESKTOP="$APPS/wakeup.desktop"
ICONS="$HOME/.local/share/icons/hicolor"
SIZES="16 24 32 48 64 128 256 512"

favorites() { gsettings get org.gnome.shell favorite-apps 2>/dev/null || echo "@as []"; }
set_favorites() { gsettings set org.gnome.shell favorite-apps "$1" 2>/dev/null || true; }
drop_fav() { sed "s/, '$1'//; s/'$1', //; s/'$1'//"; }

# Remove what the old "Work Hub" install left behind (its sign-ins move to ~/.config/WakeUp on first launch).
remove_legacy() {
  rm -f "$APPDIR/WorkHub.AppImage" "$APPS/workhub.desktop"
  for s in $SIZES; do rm -f "$ICONS/${s}x${s}/apps/workhub.png"; done
}

if [ "${1:-}" = "--uninstall" ]; then
  remove_legacy
  rm -f "$TARGET" "$DESKTOP" "$HOME/.config/autostart/wakeup.desktop"
  for s in $SIZES; do rm -f "$ICONS/${s}x${s}/apps/wakeup.png"; done
  set_favorites "$(favorites | drop_fav wakeup.desktop)"
  update-desktop-database "$APPS" 2>/dev/null || true
  echo "WakeUp removed (your sign-ins stay in ~/.config/WakeUp)."
  exit 0
fi

SRC="${1:-$(ls -t "$ROOT"/dist/WakeUp-*.AppImage 2>/dev/null | head -1)}"
[ -f "$SRC" ] || { echo "No AppImage found. Run: npm run dist"; exit 1; }

pkill -f "$APPDIR/WorkHub.AppImage" 2>/dev/null || true
mkdir -p "$APPDIR"
install -m 755 "$SRC" "$TARGET"

for s in $SIZES; do
  install -Dm644 "$ROOT/build/icons/${s}x${s}.png" "$ICONS/${s}x${s}/apps/wakeup.png"
done
gtk-update-icon-cache -f -t "$ICONS" >/dev/null 2>&1 || true

mkdir -p "$APPS"
cat > "$DESKTOP" <<DESK
[Desktop Entry]
Type=Application
Name=WakeUp
GenericName=Workspace
Comment=Ebwise, Outlook, Calendar, To Do and Teams side by side
Exec="$TARGET" %U
TryExec=$TARGET
Icon=wakeup
Terminal=false
Categories=Office;Network;
Keywords=mail;teams;outlook;calendar;todo;ebwise;mmu;workhub;
StartupNotify=true
StartupWMClass=wakeup
SingleMainWindow=true
Actions=Quit;

[Desktop Action Quit]
Name=Quit WakeUp
Exec=pkill -f "$TARGET"
DESK

# Dock: take over the old Work Hub pin in place, or pin once.
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
echo "Installed: $TARGET  (in app grid, search and dock)"
