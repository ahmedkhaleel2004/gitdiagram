# Keys for the experiment's processes only; nothing is printed or written.
export ANTHROPIC_API_KEY="$(cat ~/.config/gitdiagram/anthropic-api-key)"
export OPENAI_API_KEY="$(grep '^OPENAI_API_KEY=' ~/repos/gitdiagram/.env | head -1 | cut -d= -f2- | tr -d '"')"
export VIDEO_RENDER_CHROME_PATH="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell"
