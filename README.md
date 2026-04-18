# Die Ordering Application

Die order management system built with React, Express, and PostgreSQL. Designed to be self-hosted on a single Linux server via Docker Compose.

**Stack**

- **Frontend**: React 19 + Vite, served by Nginx
- **Backend**: Node.js 20 + Express 5
- **Database**: PostgreSQL 15
- **Transport**: single published port; API reverse-proxied through Nginx

---

## Production deployment (Docker, local server)

This deployment targets a self-hosted Linux host on your LAN. Only the frontend port is published to the host; the API and database stay on the internal Docker network.

### 1. Prerequisites

- Linux host with Docker Engine 24+ and the Docker Compose plugin
- At least 2 GB free RAM and 2 GB free disk
- A non-root user that is a member of the `docker` group

Verify:

```bash
docker --version
docker compose version
```

### 2. Fetch the code

```bash
git clone <your-repo-url> /opt/die-ordering
cd /opt/die-ordering
```

### 3. Configure `.env`

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

| Variable | How to generate / choose |
|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `DEFAULT_ADMIN_PASSWORD` | Strong password (you will change it on first login) |

Compose will refuse to start if any of these three are missing.

Optional:

- `FRONTEND_PORT` — change if 8080 is already in use on the host (e.g. `80`, `8090`).
- `ALLOWED_ORIGINS` — leave empty unless frontend and backend are on different hosts.

### 4. Start the stack

```bash
docker compose up -d
docker compose ps
docker compose logs -f backend
```

The database schema and the initial admin account are created automatically on first boot.

### 5. Log in

Open `http://<server-ip>:8080` on the LAN. Sign in with `DEFAULT_ADMIN_USERNAME` / `DEFAULT_ADMIN_PASSWORD` from `.env`, then **change the admin password immediately** from the Users page.

---

## What gets exposed

| Service | Container port | Host port | Reachable from |
|---|---|---|---|
| Frontend (Nginx) | 80 | `${FRONTEND_PORT}` (default `8080`) | LAN |
| Backend API | 3001 | — | internal Docker network only |
| PostgreSQL | 5432 | — | internal Docker network only |

The backend and database are **not** published on the host. The frontend Nginx reverse-proxies `/api/*` to the backend over the Docker network.

---

## Operations

All commands run from the project root.

### Day-to-day

```bash
# View running services and health
docker compose ps

# Tail logs (Ctrl-C to exit; does not stop services)
docker compose logs -f

# Logs for one service
docker compose logs -f backend

# Restart after a config change (no rebuild)
docker compose restart backend

# Stop everything (data volume is preserved)
docker compose down
```

### Updating the app

```bash
git pull
docker compose build
docker compose up -d
```

If a build picks up stale layers:

```bash
docker compose build --no-cache
docker compose up -d
```

### Backups

Manual dump to a gzipped SQL file:

```bash
npm run db:backup
# or equivalently:
docker exec die-ordering-db pg_dump -U postgres die_ordering \
  | gzip > backup-$(date +%Y%m%d-%H%M%S).sql.gz
```

Restore (stack must be running, database empty):

```bash
gunzip -c backup-20260418-120000.sql.gz \
  | docker exec -i die-ordering-db psql -U postgres -d die_ordering
```

Schedule daily backups with cron:

```bash
# crontab -e
0 2 * * * cd /opt/die-ordering && /usr/bin/npm run db:backup >> /var/log/die-ordering-backup.log 2>&1
```

Retention pruning (keep last 14 days):

```bash
find /opt/die-ordering -maxdepth 1 -name 'backup-*.sql.gz' -mtime +14 -delete
```

### Wiping the database

```bash
docker compose down -v   # -v removes the postgres_data volume. Data is gone.
docker compose up -d     # Recreates schema and admin account from .env.
```

---

## Development setup

Dev runs without Docker against a local Postgres.

```bash
npm install

# Terminal 1 — backend (watch mode)
npm run server:dev

# Terminal 2 — frontend (Vite dev server)
npm run dev
```

- Frontend: http://localhost:5173
- Backend:  http://localhost:3001

Vite proxies `/api` to the backend (`vite.config.js`), so the same API code path works in dev and production.

A local Postgres must be reachable via the `PG*` vars or `DATABASE_URL` in a dev `.env`.

---

## Production checklist

Before rolling out to users:

- [ ] `.env` has no `CHANGE_ME_*` placeholders
- [ ] `JWT_SECRET` is 64+ random hex characters (generated with `crypto.randomBytes`)
- [ ] `POSTGRES_PASSWORD` is random and at least 16 characters
- [ ] `DEFAULT_ADMIN_PASSWORD` is changed from the `.env` value via the UI after first login
- [ ] `docker compose ps` shows all three services as `healthy`
- [ ] `curl http://<server-ip>:8080/api/health` returns `{"status":"ok","database":"connected",...}`
- [ ] Automated backup cron is installed and a restore has been rehearsed at least once
- [ ] Host firewall only allows the frontend port (e.g. UFW: `ufw allow 8080/tcp`)
- [ ] Docker log rotation is in effect (enabled by default in `docker-compose.yml`: 10 MB × 5 files per service)

---

## Troubleshooting

**`JWT_SECRET must be set in .env`** on `docker compose up`
Compose is refusing to start with a placeholder. Fill it in and try again.

**Backend stays unhealthy, `database: disconnected` in health check**
The db container is still initializing or `POSTGRES_PASSWORD` in `.env` doesn't match the value used on the first boot (stored in the `postgres_data` volume). To reset from scratch: `docker compose down -v && docker compose up -d`. **This destroys data.**

**Frontend shows "Network error" on every request**
Check that the backend container is healthy (`docker compose ps`). The frontend speaks to the backend via Nginx on the Docker network — if the backend is down, every API call fails.

**"Port 8080 already in use"**
Set `FRONTEND_PORT=8090` (or any free port) in `.env` and re-run `docker compose up -d`.

**Forgotten admin password**
Shell into the database and reset it:

```bash
docker exec -it die-ordering-db psql -U postgres -d die_ordering
```

Then in `psql`:

```sql
-- bcrypt hash for 'temp-password-change-me' generated offline;
-- easier path: delete the admin user and restart the backend — it will recreate
-- the admin from DEFAULT_ADMIN_PASSWORD in .env.
DELETE FROM users WHERE username = 'admin';
\q
```

```bash
docker compose restart backend
```

---

## Project structure

```
die-ordering-app/
├── src/                       # React frontend
│   ├── components/
│   ├── hooks/
│   └── api.js                 # API client (uses /api — proxied by Nginx/Vite)
├── server/                    # Express backend
│   ├── index.cjs              # Entry point + middleware
│   ├── db.cjs                 # PG pool + schema init + admin seed
│   └── routes/                # Route modules (auth, orders, users, …)
├── public/                    # Static assets
├── Dockerfile.frontend        # Multi-stage Nginx image
├── Dockerfile.backend         # Node 20-alpine, runs as non-root
├── docker-compose.yml         # 3 services, only frontend port is published
├── nginx.conf                 # Reverse proxy + SPA routing + security headers
├── init.sql                   # DB initialization (applied on first boot)
└── .env.example               # Template for .env
```

---

## Environment variables

All variables are read by the backend container unless marked otherwise. See `.env.example` for the full list with inline comments.

| Variable | Required | Purpose |
|---|---|---|
| `POSTGRES_PASSWORD` | ✅ | DB superuser password. Used by db container and backend. |
| `JWT_SECRET` | ✅ | Signs session JWTs. 32+ chars enforced in production. |
| `DEFAULT_ADMIN_PASSWORD` | ✅ | Initial admin password (first boot only). |
| `DEFAULT_ADMIN_USERNAME` | | Admin username. Default: `admin`. |
| `POSTGRES_DB`, `POSTGRES_USER` | | Default: `die_ordering`, `postgres`. |
| `PORT`, `HOST` | | Backend bind. Defaults `3001` / `0.0.0.0`. |
| `JWT_EXPIRES_IN` | | Session lifetime. Default `24h`. |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS` | | General API rate limit. |
| `AUTH_RATE_LIMIT_MAX` | | Per-window cap on `/api/auth/*` attempts. Default `5`. |
| `ALLOWED_ORIGINS` | | Comma-separated CORS allowlist. Empty = same-origin only. |
| `EMAIL_ENABLED`, `PA_*` | | Optional Power Automate email integration. |
| `FRONTEND_PORT` | | Host port for the published frontend. Default `8080`. |

---

## License

MIT
