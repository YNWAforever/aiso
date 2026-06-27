#!/usr/bin/env sh
set -eu

if [ -z "${DATABASE_URL:-}" ] && [ -f ".env.local" ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required for the Neon MCP server." >&2
  exit 1
fi

exec npx -y @modelcontextprotocol/server-postgres@0.6.2 "$DATABASE_URL"
