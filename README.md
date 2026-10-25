# Padrinho

Discord bot for the **M4F1A** legion (Aion 2, Triniel LATAM, Asmodian), controllable through MCP.

- Plan: [docs/PLAN.md](docs/PLAN.md)
- Server layout: [docs/SERVER_LAYOUT.md](docs/SERVER_LAYOUT.md)
- Declarative server config: [server.yaml](server.yaml)

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

```bash
cp .env.example .env              # fill in the Discord credentials
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d --build
tailscale funnel --bg 8080
```

The SQLite database lives in `./data`. The container runs as the `node` user (uid 1000), so that folder must be writable by uid 1000; otherwise Docker creates it as root and the bot cannot open the database.
