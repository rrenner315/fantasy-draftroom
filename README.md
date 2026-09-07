# The Program

A fantasy football draft companion for building your own rankings, organizing tiers, and tracking a draft in your browser or as an offline-capable desktop app.

**New here? Start with the [step-by-step setup guide](setup.md).** It covers downloading the project from GitHub, installing the tools, launching either version, and starting your first draft. No Git or command-line experience is assumed.

## What you can do

- Keep multiple named ranking sets, each with its own sources, player order, tiers, and saved drafts.
- Import rankings from CSV, TSV, or Excel (`.xlsx`) files. Headers and ranking tables are detected automatically; row order supplies the ranking when no rank column exists.
- Import online snapshots from ESPN, Yahoo, Sleeper, or Fantasy Football Calculator. Available scoring formats vary by source.
- Arrange source priority: the first source wins for shared players, and later sources fill gaps. Reorder individual players using drag handles or rank controls.
- Apply custom tiers from a spreadsheet, download blank tier templates, and review uncertain player-name matches. Supported layouts include player tables, position columns separated by blank cells, and tier headings. Players absent from the tier sheet receive `N/A`.
- Configure 8–16 teams from the available presets, your draft position, snake or linear order, and starting/bench roster slots, including Superflex and 2QB presets.
- Open **Quick picks** in a separate browser or desktop window beside Yahoo (or another draft room). Search by name, initials, or team; use arrow keys and Enter, Undo, or Skip pick. Fill skipped slots later without shifting subsequent picks. Both windows share the active draft; keep the full program open.
- Track picks with Draft Board, Roster View, and Tier Board views. Search and filter available players, check bye weeks, rename teams, and undo manual picks.
- Choose a companion panel for draft signals, your watchlist, or your roster, or hide it. Signals include tier scarcity, position runs, and stacking opportunities.
- Optionally compare personal ranks with Sleeper, ESPN, or Yahoo defaults to flag discrepancies of at least one round.
- Connect a Sleeper draft link or ID to follow live picks and rosters. Review player matches, switch to manual tracking, and reconnect. Sleeper remains the source of truth while connected; this app does not submit picks to Sleeper.

## Browser or desktop?

| | Browser | Desktop |
| --- | --- | --- |
| Launch from source | Start a local server, then open its address | Open an Electron app window |
| Saved data | This browser profile's local storage for the exact site address | Local SQLite database in the operating system's app-data folder |
| Portable backups | No built-in export/restore controls | Export and restore `.draftroom` files |
| Automatic backups | None | One file per save date, updated with each save; ten most recent dates retained |
| Offline use | Local launch requires the server to keep running; not an installable offline web app | Imported rankings and manual drafts work offline after installation |

The two versions have separate saved data and do not automatically synchronize. Online ranking imports, platform comparisons, and live Sleeper syncing require internet access in either version. Rankings are imported snapshots, not continuously refreshed feeds.

## Quick start from source

Install Node.js **22.13.0 or newer** (Node 24 LTS is a suitable starting point), download or clone this repository, and open a terminal in the folder containing `package.json`.

```sh
npm ci
```

**Browser — macOS/Linux:**

```sh
npm run dev
```

**Browser — Windows Command Prompt:**

```bat
npx vinext dev
```

Open the local URL printed in the terminal, normally [http://localhost:3000](http://localhost:3000). Keep the terminal running. Stop the server with **Ctrl+C**.

The Windows command avoids the Unix-style environment assignment in the current `dev` script. The Vite configuration supplies the local tool settings.

**Desktop — macOS/Windows:**

```sh
npm run desktop:run
```

This builds the desktop interface and launches it. No browser server is needed. See [setup.md](setup.md) for opening the right folder, reopening the app, and troubleshooting.

## Data and backups

Both versions automatically save ranking sets and draft state. Browser data stays with the same browser profile, hostname, and port; clearing site data or using a private window can lose it.

Desktop saves go to `draftroom.db` in Electron's user-data directory, with daily JSON backups in its `Backups` subfolder. These backups share the same computer as the database. Use **Export backup** in the navigation menu to keep a separate portable copy. **Restore backup** replaces the current saved state; export first if you want to keep it.

## Development and packaging

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the browser development server (macOS/Linux) |
| `npm run build` | Build the browser application (macOS/Linux) |
| `npm start` | Start the built browser application (macOS/Linux) |
| `npm test` | Build the browser app and run rendering, parser, and feature checks (macOS/Linux) |
| `npm run lint` | Run ESLint |
| `npm run desktop:build` | Build the desktop interface into `desktop-dist/` |
| `npm run desktop:run` | Build and launch Electron |
| `npm run desktop:package:mac` | Build macOS DMG and ZIP packages |
| `npm run desktop:package:win` | Build Windows NSIS installer and ZIP packages |
| `npm run desktop:package` | Package for the current platform; Linux configuration targets AppImage |

On Windows, use `npx vinext build` and `npx vinext start` for browser build/start. To run the tests, run `npx vinext build`, then `node --test tests/rendered-html.test.mjs tests/manual-draft.test.mjs tests/companion-window.test.cjs` as a separate command.

Packages are written to `release/`. Build macOS packages on a Mac and Windows packages on Windows. Signing credentials are not configured in this repository, so locally generated installers are unsigned development builds. Packaging may download additional tools and requires internet access.

The shared React interface lives in `app/page.tsx`; parsers are in `app/*-parser.mjs` and player matching in `app/name-matching.mjs`. Browser integrations live under `app/api/`. Electron's local persistence and integrations live in `electron/`, with the desktop entry point in `desktop/`. Browser builds use vinext/Vite; desktop builds use Vite/Electron.

The repository also includes optional Sites/Cloudflare and Drizzle scaffolding (`.openai/`, `worker/`, `db/`, and `examples/d1/`). Local draft storage does not require configuring a cloud database, an account, or API keys.
