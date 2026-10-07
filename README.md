# Family Expense Tracker

React frontend, Node.js (Express) API and Postgres, each in its own Docker container.

## Slice 1: login and configuration

- Local admin account, created on first start from `.env`. Passwords are hashed with bcrypt.
- 5 wrong passwords lock an account for 15 minutes. Sessions last 7 days (HTTP-only cookie).
- "Continue with Google": a new Gmail address becomes an application. The admin approves or rejects it under Configuration > Users.
- Configuration menu (admin only): family members, categories (with colours), service providers, payment modes, currencies, users.

## Run it

```bash
cp .env.example .env      # then edit .env and set real passwords
docker compose up -d --build
```

Open `http://<server-ip>/` (or the port set in `WEB_PORT`) and log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

The database is not published outside Docker. Its data lives in the `pgdata` volume.

`.env` holds credentials and is ignored by Git (see `.gitignore`). Only `.env.example` is committed.

## Turn on Google sign-in

1. Go to https://console.cloud.google.com/ and create a project.
2. APIs & Services > OAuth consent screen: choose "External", fill in the app name and your email.
3. APIs & Services > Credentials > Create credentials > OAuth client ID > "Web application".
4. Under "Authorized JavaScript origins" add the address you open the site with, e.g. `https://<server-ip>`.
   Google requires HTTPS here (plain `http://localhost` is allowed for testing). Whether Google accepts a bare IP address as an origin: Unknown, to be checked during the HTTPS slice; DuckDNS is the fallback.
5. Copy the client ID into `GOOGLE_CLIENT_ID` in `.env` and run `docker compose up -d`.

## Not in this slice

HTTPS (Let's Encrypt), expenses, dashboard, backups. Set `COOKIE_SECURE=true` once HTTPS is on.

## Local development

```bash
cd api && npm install && DATABASE_URL=postgres://... ADMIN_PASSWORD=... npm start
cd web && npm install && npm run dev     # proxies /api to localhost:3000
```
