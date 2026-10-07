# Family Expense Tracker

React frontend, Node.js (Express) API and Postgres, each in its own Docker container.

## Slice 1: login and configuration

- Local admin account, created on first start from `.env`. Passwords are hashed with bcrypt.
- 5 wrong passwords lock an account for 15 minutes. Sessions last 7 days (HTTP-only cookie).
- "Continue with Google": a new Gmail address becomes an application. The admin approves or rejects it under Configuration > Users.
- Configuration menu (admin only): family members, categories (with colours), service providers, payment modes, currencies, users.

## Slice 2: add an expense and see the month

- Any approved user can add, edit and delete expenses, and everyone sees all expenses.
- Fields: date, category, service provider, amount, currency, payment mode, and Family (common) or a named member (personal).
- The month view has previous/next arrows, a total per category, and a grand total. SGD and INR totals are shown separately, with no conversion yet.
- Admin can add approved Gmail addresses under Configuration > Users.
- New tables are created by the API on start-up, so an existing slice-1 database keeps its data.

## Slice 3: monthly recurring bills

- Bills page: set up monthly bills (name, category, provider, Family or member, currency, due day, usual amount and payment mode).
- Monthly checklist with due dates. Unpaid bills past their due date show as Overdue.
- "Mark paid" asks for the amount, payment mode and paid date, and adds the bill to Expenses. The amount is pre-filled with what was paid last time, or the usual amount. "Undo" removes that expense.
- A due day of 29 to 31 falls on the last day of shorter months.

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
