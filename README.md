# Die Ordering Application

A comprehensive die ordering management system built with React, Express.js, and PostgreSQL.

## Features

- 📋 Die order management with PDF/Excel import
- 👥 User authentication with role-based access
- 📊 Analytics dashboard with charts
- 🔄 Kanban-style pipeline tracking
- 🏭 Plants and suppliers management
- 🔐 Secure API with JWT authentication

---

## Docker Deployment (Recommended)

### Prerequisites

- Docker and Docker Compose

### 1. Configure Environment

```bash
# Copy and edit the environment file
cp .env.example .env

# IMPORTANT: Generate a secure JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Update .env with:
# - JWT_SECRET (from command above)
# - POSTGRES_PASSWORD (strong password)
# - DEFAULT_ADMIN_PASSWORD (change from default)
```

### 2. Build and Start

```bash
# Build containers
docker compose build

# Start all services
docker compose up -d
```

### 3. Access the Application

| Service | URL |
|---------|-----|
| Application | http://localhost:8080 |
| Backend API | http://localhost:3001 |
| Database | localhost:5433 |

### 4. Default Login

- **Username**: `admin`
- **Password**: As set in `.env` (default: `admin123`)

> ⚠️ **You must change the password on first login!**

### Docker Commands

```bash
# View logs
docker compose logs -f

# Stop services
docker compose down

# Stop and remove volumes (DELETES DATA!)
docker compose down -v

# Rebuild after code changes
docker compose build --no-cache
docker compose up -d
```

---

## Development Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 15+

### Start Development Servers

```bash
# Install dependencies
npm install

# Terminal 1: Start backend
npm run server:dev

# Terminal 2: Start frontend
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001

---

## Project Structure

```
die-ordering-app/
├── src/                  # React frontend
│   ├── components/       # UI components
│   ├── hooks/            # Custom hooks
│   └── api.js            # API client
├── server/               # Express.js backend
│   ├── index.cjs         # Server entry
│   ├── db.cjs            # Database
│   └── routes/           # API routes
├── public/               # Static assets
├── Dockerfile.frontend   # Frontend Docker config
├── Dockerfile.backend    # Backend Docker config
├── docker-compose.yml    # Container orchestration
├── nginx.conf            # Nginx proxy config
└── init.sql              # Database initialization
```

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `JWT_SECRET` | JWT signing key (64+ chars) | ✅ |
| `POSTGRES_PASSWORD` | Database password | ✅ |
| `DEFAULT_ADMIN_PASSWORD` | Initial admin password | ✅ |
| `NODE_ENV` | Environment mode | No (default: production) |

---

## Production Checklist

- [x] Dockerized application
- [ ] Change all default passwords
- [ ] Generate secure JWT secret
- [ ] Configure HTTPS/SSL (reverse proxy)
- [ ] Set up automated backups
- [ ] Configure monitoring/logging

---

## License

MIT
