#!/usr/bin/env bash
# Daily backup of the bot's SQLite database (keeps 14 days in ./data/backups).
# Meant for cron on the server, e.g.:  15 4 * * *  /path/to/padrinho/scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T padrinho node dist/backup.js
