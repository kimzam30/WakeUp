#!/usr/bin/env bash
# Install Work Hub like a regular app:  bash scripts/install.sh [path/to/WorkHub.AppImage]
# Uninstall:                            bash scripts/install.sh --uninstall
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPDIR="$HOME/Applications"
TARGET="$APPDIR/WorkHub.AppImage"
DESKTOP="$HOME/.local/share/applications/workhub.desktop"
ICONS="$HOME/.local/share/icons/hicolor"

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$TARGET" "$DESKTOP" "$HOME/.config/autostart/workhub.desktop"
  for s in 16 24 32 48 64 128 256 512; do rm -f "$ICONS/${s}x${s}/apps/workhub.png"; done
  gsettings set org.gnome.shell favorite-apps "$(gsettings get org.gnome.shell favorite-apps | sed "s/, 'workhub.desktop'//; s/'workhub.desktop', //; s/'workhub.desktop'//")"
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
  echo "Work Hub removed (your sign-ins stay in ~/.config/Work Hub)."
  exit 0
fi

SRC="${1:-$(ls -t "$ROOT"/dist/WorkHub-*.AppImage 2>/dev/null | head -1)}"
[ -f "$SRC" ] || { echo "No AppImage found. Run: npm run dist"; exit 1; }

mkdir -p "$APPDIR"
install -m 755 "$SRC" "$TARGET"

for s in 16 24 32 48 64 128 256 512; do
  install -Dm644 "$ROOT/build/icons/${s}x${s}.png" "$ICONS/${s}x${s}/apps/workhub.png"
done
gtk-update-icon-cache -f -t "$ICONS" >/dev/null 2>&1 || true

mkdir -p "$(dirname "$DESKTOP")"
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=Work Hub
GenericName=Workspace
Comment=Ebwise, Outlook, Calendar, To Do and Teams side by side
Exec="$TARGET" %U
TryExec=$TARGET
Icon=workhub
Terminal=false
Categories=Office;Network;
Keywords=mail;teams;outlook;calendar;todo;ebwise;mmu;
StartupNotify=true
StartupWMClass=workhub
SingleMainWindow=true
Actions=Quit;

[Desktop Action Quit]
Name=Quit Work Hub
Exec=pkill -f "$TARGET"
EOF
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

# Pin to the dock once.
FAV="$(gsettings get org.gnome.shell favorite-apps)"
if [[ "$FAV" != *"workhub.desktop"* ]]; then
  gsettings set org.gnome.shell favorite-apps "${FAV%]*}, 'workhub.desktop']"
fi
echo "Installed: $TARGET  (in app grid, search and dock)"
