# CIBC Caribbean → YNAB Sync

**Import CIBC Caribbean (formerly CIBC FirstCaribbean / FCIB) bank and credit card CSV statements directly into [YNAB](https://ynab.com)** — no manual data entry, no CIBC Caribbean password required, and no duplicate transactions.

CIBC Caribbean doesn't offer a direct bank-feed integration with YNAB, so budgeters across Barbados and the wider Eastern Caribbean who bank with CIBC Caribbean are left retyping every chequing, savings, and credit card transaction by hand. This tool closes that gap: export a CSV from CIBC Caribbean Online Banking, upload it here, and sync the transactions straight into your YNAB budget in a couple of clicks.

## What it does

- **Imports CIBC Caribbean CSV exports into YNAB** — chequing, savings, and credit card accounts, one or several files at once.
- **Auto-detects your CSV's columns** (date, payee, memo, debit/credit or a single amount column) so there's usually nothing to configure manually.
- **Lets you review every transaction before it syncs** — uncheck anything you don't want to send, fix the date format, or adjust how expenses appear.
- **Never asks for your CIBC Caribbean online banking password.** It only reads a CSV file you've already exported yourself.
- **Prevents duplicate transactions.** Deterministic, duplicate-safe import IDs mean re-uploading a file or overlapping date ranges never double-imports a transaction.
- **Undo any sync.** If something looks wrong in YNAB afterward, one click removes exactly the transactions that sync just created.
- **Runs entirely in your browser.** CSV parsing and your YNAB personal access token never leave your device or touch a server-side database — see [How it works](#how-it-works) below.

## How it works

1. **Connect YNAB** with a personal access token, pasted directly into the app. It's saved only in your browser's `localStorage`.
2. **Choose your YNAB budget** and assign each uploaded CSV to the right account.
3. **Upload your CIBC Caribbean CSV export(s)** — drag and drop, or pick multiple files. Review the auto-mapped transactions, then sync.

## FAQ

**Is this an official CIBC Caribbean or YNAB product?**
No. This is an independent, unofficial tool built to connect the two. It isn't affiliated with, endorsed by, or supported by CIBC Caribbean/CIBC FirstCaribbean or YNAB.

**Does it work with CIBC FirstCaribbean (FCIB) statements?**
Yes — CIBC Caribbean was formerly branded CIBC FirstCaribbean (FCIB); the CSV export format from Online Banking is the same tool.

**Will it ask for my online banking password?**
No, never. You export the CSV yourself from CIBC Caribbean Online Banking and upload that file; the tool has no access to your bank account.

**Where is my data stored?**
Nowhere but your browser. There's no database and no server-side storage — see the [Architecture](#architecture) section below.

**What if I sync the wrong file or make a mistake?**
Use the **Undo sync** button (shown right after a sync completes) to remove exactly the transactions that sync just added to YNAB.

## Architecture

This is a plain Next.js 16 app (App Router) — no Cloudflare Workers, D1, or OpenAI Sites platform dependencies, and no package-manager pinning via corepack. It can be deployed anywhere Node.js runs.

- Your YNAB personal access token is stored only in your browser's `localStorage`.
- CSV parsing and column mapping happen entirely client-side (see [lib/csv.ts](lib/csv.ts)); files never leave your browser except as the transactions you choose to sync.
- The only server-side code is [app/api/ynab/route.ts](app/api/ynab/route.ts), a thin proxy that forwards `plans` / `accounts` / `transactions` / `deleteTransactions` requests to the YNAB API using the token sent from the browser. It holds no state and uses no database.

## Prerequisites

- Node.js `>= 22.13.0`
- npm (ships with Node; no corepack/pnpm/yarn required)

## Local development

```sh
npm install
npm run dev
```

Visit `http://localhost:3000`.

## Production build

```sh
npm install
npm run build
```

`next.config.mjs` sets `output: "standalone"`, so the build also produces a self-contained server at `.next/standalone/server.js` with a pruned `node_modules`, useful for a bare VPS deploy. Static assets aren't copied there automatically:

```sh
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
```

Run it with:

```sh
PORT=3000 node .next/standalone/server.js
```

## Deploying to Hostinger

### Git-based Node.js app (Hostinger's "Settings and redeploy" build pipeline)

Point it at this repo with:

- **Framework preset**: Next.js
- **Node version**: 22.x
- **Root directory**: `./`
- **Build command**: `npm run build`
- **Package manager**: npm
- **Output directory**: `.next`
- **Environment Variables**: none needed — the app is stateless server-side

### Bare VPS (SSH access)

1. **Provision & connect**: SSH into the VPS, install Node.js 22+.
2. **Get the code**: `git clone` this repo onto the server (or `git pull` on redeploys).
3. **Install & build**:
   ```sh
   npm install
   npm run build
   cp -r public .next/standalone/public
   cp -r .next/static .next/standalone/.next/static
   ```
4. **Run it as a service** with `pm2` (recommended) so it survives reboots/crashes:
   ```sh
   npm install -g pm2
   pm2 start .next/standalone/server.js --name cibc-ynab-sync --env PORT=3000
   pm2 save
   pm2 startup   # follow the printed instructions to enable on boot
   ```
5. **Point a domain at it** via Nginx as a reverse proxy to `127.0.0.1:3000`, then issue a free TLS cert with `certbot`. A minimal server block:
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;
       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```
6. **Redeploying**: `git pull`, repeat step 3, then `pm2 restart cibc-ynab-sync`.

## Scripts

- `npm run dev` — start the dev server. Runs `next dev --webpack` rather than the Turbopack default, since Turbopack's persistent dev cache repeatedly corrupted itself in this environment.
- `npm run build` — production build (standalone output). Runs `next build --webpack` rather than the Turbopack default: some hosts (e.g. Hostinger's build containers) run an older glibc that can't load Next's native Turbopack/SWC binaries, and only the webpack build path has a working WASM fallback for that case.
- `npm start` — `next start` (useful for local smoke-testing; on a VPS prefer `node .next/standalone/server.js` per above)
- `npm run lint` — run ESLint

## Disclaimer

This is an independent, unofficial tool. It is not affiliated with, endorsed by, or supported by CIBC Caribbean, CIBC FirstCaribbean, or YNAB. "CIBC Caribbean" and "YNAB" are trademarks of their respective owners, referenced here only to describe the services this tool connects.
