# CIBC Caribbean → YNAB Sync

A private, single-page Next.js app that imports CIBC Caribbean CSV exports into [YNAB](https://ynab.com) with duplicate-safe transaction IDs.

- Your YNAB personal access token is stored only in your browser's `localStorage`.
- CSV parsing and column mapping happen entirely client-side (see [lib/csv.ts](lib/csv.ts)); files never leave your browser except as the transactions you choose to sync.
- The only server-side code is [app/api/ynab/route.ts](app/api/ynab/route.ts), a thin proxy that forwards `plans` / `accounts` / `transactions` requests to the YNAB API using the token sent from the browser. It holds no state and uses no database.

This is a plain Next.js 16 app (App Router) — no Cloudflare Workers, D1, or OpenAI Sites platform dependencies, and no package-manager pinning via corepack. It can be deployed anywhere Node.js runs.

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

`next.config.ts` sets `output: "standalone"`, so the build also produces a self-contained server at `.next/standalone/server.js` with a pruned `node_modules`, useful for a bare VPS deploy. Static assets aren't copied there automatically:

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

- `npm run dev` — start the dev server
- `npm run build` — production build (standalone output)
- `npm start` — `next start` (useful for local smoke-testing; on a VPS prefer `node .next/standalone/server.js` per above)
- `npm run lint` — run ESLint
