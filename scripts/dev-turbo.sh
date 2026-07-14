#!/usr/bin/env bash

set -u

# Keep the interactive terminal healthy after Next exits or receives Ctrl-C.
restore_tty() {
  if [[ -t 0 ]]; then
    # Restore normal line editing/echo settings for the current TTY.
    stty sane 2>/dev/null || true
    # Re-enable bracketed paste and switch back to normal cursor-key mode so
    # zsh stops printing raw escape sequences like ^[[C and ^[[200~.
    printf '\033[?2004h\033[?1l\033>' 2>/dev/null || true
  fi
}

# Always restore terminal modes when the dev server exits, including SIGINT.
trap restore_tty EXIT INT TERM

next dev --turbo "$@"
