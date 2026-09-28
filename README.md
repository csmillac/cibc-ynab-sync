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
- **Runs entirely in your browser.** CSV parsing happens locally, and your YNAB personal access token is used to call YNAB's API directly from your browser — nothing about your data or your token ever passes through a server of ours. There isn't one; see [Architecture](#architecture) below.

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

This is a fully static Next.js 16 app (App Router, `output: "export"`) — no server, no API routes, no database, no Cloudflare Workers or OpenAI Sites platform dependencies. It's just HTML/CSS/JS that can be hosted anywhere static files are served (GitHub Pages, Hostinger, Netlify, S3, a plain folder).

- Your YNAB personal access token is stored only in your browser's `localStorage`.
- CSV parsing and column mapping happen entirely client-side (see [lib/csv.ts](lib/csv.ts)); files never leave your browser except as the transactions you choose to sync.
- [lib/ynab.ts](lib/ynab.ts) calls the YNAB API (`api.ynab.com`) directly from the browser using the token you provide — there is no backend of ours in between at all.

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

`next.config.mjs` sets `output: "export"`, so this produces a plain static site in `out/` — no server needed. Preview it locally with:

```sh
npm start
```

(runs `npx serve out`).

## Deploying to GitHub Pages

[.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) builds and publishes `out/` to GitHub Pages automatically on every push to `main`, via GitHub's official Pages Actions (no `gh-pages` branch to manage).

One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**. After that, pushing to `main` deploys automatically.

GitHub Pages serves a project repo from `https://<user>.github.io/<repo>/`, so the build needs a matching `basePath`. The workflow sets `GITHUB_PAGES=true`, which `next.config.mjs` uses to set `basePath`/`assetPrefix` to `/cibc-ynab-sync` only for that build — a local build or any other static host still serves from `/`.

## Deploying elsewhere

Since this is now a static export, `out/` can be uploaded to any static host — Hostinger's regular (non-Node) hosting via file manager/FTP, Netlify, Vercel, S3 + CloudFront, or just opened as local files. There's no build pipeline, glibc, or Node version compatibility to worry about on the host — only when running `npm run build` yourself.

## Scripts

- `npm run dev` — start the dev server. Runs `next dev --webpack` rather than the Turbopack default, since Turbopack's persistent dev cache repeatedly corrupted itself in this environment.
- `npm run build` — static export to `out/`. Runs `next build --webpack` rather than the Turbopack default, for the same cache-stability reason as `dev`.
- `npm start` — serves `out/` locally via `npx serve out`, for smoke-testing a production build before deploying.
- `npm run lint` — run ESLint

## Disclaimer

This is an independent, unofficial tool. It is not affiliated with, endorsed by, or supported by CIBC Caribbean, CIBC FirstCaribbean, or YNAB. "CIBC Caribbean" and "YNAB" are trademarks of their respective owners, referenced here only to describe the services this tool connects.
