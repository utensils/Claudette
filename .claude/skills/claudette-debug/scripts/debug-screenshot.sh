#!/usr/bin/env bash
# Cross-platform screenshot capture for visual inspection.
# Usage: ./debug-screenshot.sh [--output PATH]
#
# macOS:         screencapture -x (silent full-screen)
# Linux/Wayland: grim
# Linux/X11:     import -window root (ImageMagick) or scrot
#
# Prints the output file path to stdout so Claude can Read the image.
set -euo pipefail

OUTDIR="/tmp/claudette-debug"
OUTFILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) OUTFILE="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

mkdir -p "$OUTDIR"

if [[ -z "$OUTFILE" ]]; then
  OUTFILE="${OUTDIR}/screenshot-$(date +%s).png"
fi

case "$(uname -s)" in
  Darwin)
    screencapture -x "$OUTFILE"
    ;;
  Linux)
    if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
      if command -v grim &>/dev/null; then
        grim "$OUTFILE"
      else
        echo "ERROR: grim not found. Install grim for Wayland screenshots." >&2
        exit 1
      fi
    else
      if command -v import &>/dev/null; then
        import -window root "$OUTFILE"
      elif command -v scrot &>/dev/null; then
        scrot "$OUTFILE"
      else
        echo "ERROR: No screenshot tool found. Install ImageMagick (import) or scrot." >&2
        exit 1
      fi
    fi
    ;;
  *)
    echo "ERROR: unsupported platform $(uname -s)" >&2
    exit 1
    ;;
esac

echo "$OUTFILE"
