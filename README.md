# Padrinho

Discord bot for the **M4F1A** legion (Aion 2, Triniel LATAM, Asmodian), controllable through MCP.

- Declarative server config: [server.yaml](server.yaml)
- The plan and the server layout (`docs/`) are kept locally, outside the repository.

## Development

```bash
npm install
cp .env.example .env   # fill in the Discord credentials
npm run dev
```

| Script                | What it does                                   |
| --------------------- | ---------------------------------------------- |
| `npm run dev`         | Runs the bot with reload, reading `.env`       |
| `npm run check`       | Typecheck, lint, format check and tests        |
| `npm run build`       | Compiles to `dist/` (with migrations)          |
| `npm run db:generate` | Generates a migration after editing the schema |

Health check: `GET http://localhost:8080/healthz`.

## Production

On the Linux server (Docker, git, curl and Tailscale installed; the repo is private, so log in with `gh auth login` or use a deploy key first):

```bash
git clone https://github.com/gomes-eric/godfather.git
cd godfather
./scripts/deploy-wizard.sh
```

The wizard walks through every step and is safe to re-run: production `.env`, stopping the dev bot, copying `data/padrinho.db` from the PC, `docker compose up -d --build`, the Tailscale Funnel URL (`PUBLIC_BASE_URL`), the daily backup cron and a final check of `/healthz` and `/mcp`.

- **Never run two copies of the bot** with the same token: both answer every command and reminders go out twice.
- The SQLite database lives in `./data`, owned by uid 1000 (the container's `node` user).
- Backups: `scripts/backup.sh` (runs `node dist/backup.js` inside the container) writes `data/backups/padrinho-YYYY-MM-DD.db` and keeps 14 days.
- Updating: `git pull && docker compose up -d --build`.
