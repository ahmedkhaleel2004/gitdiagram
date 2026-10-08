# Keys for the experiment's processes only; nothing is printed or written.
export ANTHROPIC_API_KEY="$(cat ~/.config/gitdiagram/anthropic-api-key)"
export OPENAI_API_KEY="$(grep '^OPENAI_API_KEY=' ~/repos/gitdiagram/.env | head -1 | cut -d= -f2- | tr -d '"')"
export GITHUB_PAT="$(grep '^GITHUB_PAT=' ~/repos/gitdiagram/.env | head -1 | cut -d= -f2- | tr -d '"')"
