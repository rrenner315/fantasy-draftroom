# Set up and run The Program

The Program helps you prepare fantasy football rankings and tiers and follow a draft. You can run it in a web browser or in its own desktop window.

**If someone sent you a link directly to this page, you are in the right place.** This guide starts from scratch. You do not need to know how to code, install Git, or use a GitHub account to download a public repository. Reading this page on GitHub does not start the app.

[Project home](https://github.com/rrenner315/fantasy-draftroom) · [Features and technical reference](README.md)

## Choose how you want to use it

- **Desktop:** Best if you want local backups and manual drafting without internet access after setup. The app opens in its own window.
- **Browser:** Runs on your computer and opens in Chrome, Edge, Firefox, or Safari. A small local server must stay running in a terminal while you use it.

Both options below start with the same installation. You can try both, but **their saved rankings and drafts are separate**. There is no automatic transfer or sync between them.

You need a Windows PC or Mac, an internet connection for installation, and permission to install software. Linux users can use the source commands too, but this guide's installation steps focus on Windows and macOS. Online ranking imports and live Sleeper features always need internet access.

## 1. Install Node.js

Node.js runs the program's setup tools. Its installer also includes **npm**, which downloads the software components the app needs.

1. Open the official [Node.js download page](https://nodejs.org/en/download).
2. Choose **Node.js 24 LTS** and the installer for your operating system: `.msi` for Windows or `.pkg` for macOS. Use the installer download, rather than copying the installation commands shown on the page. The project's minimum is Node.js 22.13.0.
3. Open the downloaded installer and follow its prompts, keeping the default options. On Windows, keep the option to add Node.js to PATH enabled if shown.
4. Close any terminal windows already open so that new ones can find Node.js.

Open a command window:

- **Windows:** Open Start, type **Command Prompt**, and open it. Use Command Prompt for this guide rather than PowerShell.
- **Mac:** Press **Command+Space**, type **Terminal**, and press Return.

Copy this line into the window and press Enter (Return on Mac):

```sh
node --version
```

Then run:

```sh
npm --version
```

Each should print a version number. Node should show `v24...` if you installed version 24. If either says it cannot find the command, restart the command window or reinstall Node.js before continuing.

**How to enter commands:** Copy only the text inside each command box, paste it into the command window, and press Enter. Run one command at a time. Do not type the surrounding backticks or the prompt already displayed in the window. Wait for the prompt to return before entering the next command, except when the guide tells you to leave a server running.

## 2. Download the whole project from GitHub

1. Open the [repository home page](https://github.com/rrenner315/fantasy-draftroom). This takes you out of this individual file and to the project's file list.
2. Click the green **Code** button, then **Download ZIP**.
3. Find the ZIP in your Downloads folder.
4. Extract it: on Windows, right-click it and choose **Extract All**; on Mac, double-click it.
5. Move the extracted folder somewhere you can keep it, such as Documents. Its name will usually be `fantasy-draftroom-main`.
6. Open that folder and look for **package.json**, **README.md**, and folders named **app** and **electron**. This is the project folder you will use below. If you see just another folder, open that inner folder first.

Do not download only `setup.md`, and do not try to run the program from inside the ZIP archive. Keep the extracted project folder: you will use it each time you launch from source.

## 3. Open a command window in the project folder

Commands need to run in the folder containing `package.json`.

### Windows

1. Open the extracted project folder in File Explorer.
2. Click the address bar at the top of File Explorer.
3. Type `cmd` and press Enter. Command Prompt opens in that folder.
4. Run:

```bat
dir package.json
```

You should see `package.json` listed. Keep this window open.

### Mac

1. Open Terminal as described in step 1.
2. Type `cd` followed by a space, but do not press Return yet.
3. Drag the extracted project folder from Finder into Terminal. This fills in its location, including any spaces.
4. Press Return. The `cd` command means “change directory,” or move into this folder.
5. Run:

```sh
ls package.json
```

You should see `package.json`. Keep this window open.

If the file is not found, go back to step 2 and make sure you selected the folder that directly contains it.

## 4. Install the program's components

In that same command window, run:

```sh
npm ci
```

This installs the versions listed in the project's lockfile, including the desktop runtime. It may take several minutes and needs internet access. It creates a `node_modules` folder; leave that folder in place.

Wait until the command finishes and the prompt returns. Notices or warnings may appear; an `npm ERR!` or `npm error` message means installation may have failed. Use the troubleshooting section below before trying to launch. You do not need to run `npm audit fix` as part of setup.

You normally do this only once per downloaded copy, and again after downloading an updated copy.

## 5A. Run in your browser

Choose the command for your computer, in the project command window.

**Mac or Linux:**

```sh
npm run dev
```

**Windows Command Prompt:**

```bat
npx vinext dev
```

Windows uses a different command because the current `npm run dev` script contains a macOS/Linux-style setting. The installed app tools are the same. See [npm's script-shell documentation](https://docs.npmjs.com/cli/using-npm/scripts/) for the underlying platform difference.

Wait for the terminal to print a local address, normally **http://localhost:3000**. Open your browser and enter that address in its address bar. Use the exact address printed if the port number differs.

You should see **The Program** and the **Rankings and drafts** home screen. `localhost` means your own computer; this does not publish the app to the internet.

**Keep the command window open while using the app.** It is normal for the command to keep running without returning to a prompt. To stop, return to that window and press **Ctrl+C** (also Control+C on Mac). If Windows asks to terminate the batch job, type `Y` and press Enter.

Next time, repeat step 3, run the same browser command, and open the same address. You do not need to reinstall components. Use the same browser profile and address, including the port, to see your saved data.

## 5B. Run as a desktop app

On either Windows or Mac, run this in the project command window:

```sh
npm run desktop:run
```

Wait while it builds the interface. A separate **The Program** window should open with the **Rankings and drafts** home screen. You do not need to run the browser command first.

Keep the terminal open while using this source-launched app. When finished, quit the app; on Mac, use **Command+Q** to fully quit. If the terminal command is still running afterward, press **Ctrl+C**.

Next time, repeat step 3 and run `npm run desktop:run` again. It rebuilds the interface on each launch and restores saved data from the local database. Your downloaded project folder is needed for this method.

### Optional: create an app you can open without a terminal

This extra step creates an installer. It is not required to use the desktop version above. Run it on the operating system you want to install on, while connected to the internet.

**On a Mac:**

```sh
npm run desktop:package:mac
```

**On Windows:**

```bat
npm run desktop:package:win
```

When it finishes, open the **release** folder inside the project folder:

- **Mac:** Open the `.dmg` file and copy The Program to Applications. Open it from Applications afterward.
- **Windows:** Open the installer `.exe` file and follow its prompts. Open The Program from the Start menu afterward.

ZIP packages are also generated, but the installer is the simpler route. Once installed, the packaged app does not need Node.js or a terminal to launch. Export a backup before switching between source and packaged versions; their app-data locations can differ.

These locally built installers are unsigned development builds, so your operating system may display a security warning. If installation is blocked, use the source-launch method above or obtain a signed build from the maintainer. Do not disable system-wide security settings.

## 6. Prepare your first draft

1. Click **Create rankings set**, enter a name, and choose **Save name**.
2. Add players using **Choose ranking files** or **Import Expert Ranks**. For online imports, choose a source and one of its available formats, then import. For spreadsheets, use CSV, TSV, or `.xlsx` with a `Player`, `Player Name`, or `Name` column. Position and Team columns are recommended; Rank or ADP is optional.
3. Check **Source priority** if you imported multiple lists. The top source supplies shared players' rankings; lower sources add missing players. Adjust the player order as desired.
4. Optionally choose **Apply tiers**. You can download a blank template or upload your own tier sheet, then review the matches. Players not listed in the tier sheet become `N/A`.
5. Click **Set up a draft**, give the draft a name, and choose **Save name** when prompted. Choose your team count, draft position, snake or linear order, and roster slots. Platform-rank comparison is optional.
6. Choose **Enter draft room**. In manual mode, use a player's **+** control in the player list to record a pick. Use **Undo** to correct a manual pick. Switch among **Draft Board**, **Roster View**, and **Tier Board** as needed.
7. Return to the home screen to open or continue a saved draft. You can keep multiple drafts within a ranking set.

For a live Sleeper draft, use **Connect a Sleeper draft** in draft setup and paste the draft-room link or ID. Make your actual picks in Sleeper; The Program follows them automatically. Resolve any unmatched names when prompted. **Switch to manual** pauses syncing; reconnecting can replace manual changes with Sleeper's picks.

### Keep up with Yahoo using Quick picks

In the full draft room, click **↗ Quick picks** at the top right. A separate compact window opens. Move it beside Yahoo's draft room, including onto another monitor, while keeping the full program open. On a browser, allow pop-ups for the local site if prompted. Some browsers may open a tab instead; drag it into its own window.

- Click the search box and type a player name, initials, or team. Use position filters to narrow the results.
- Use **↑ / ↓** to highlight a result and **Enter** to record it, or click the player. Search clears after the pick, ready for the next name. **Esc** clears search or cancels filling a skipped slot.
- **Undo** removes the most recent pick, including a skipped pick. The player becomes available again.
- **Skip pick** reserves the current slot as **Unknown player** and moves to the next pick. Once you identify the player, choose that slot from the skipped-pick selector and record the player. Later picks stay in their original slots. Undo always removes the latest draft slot, even if you just filled an earlier one.
- Picks from either window immediately update both. The compact window follows the active draft in the full program. Changes are disabled while the main window is outside the draft room or while Sleeper controls the draft.

This is manual entry: make your actual selection in Yahoo and record each league pick in The Program. A skipped player's availability remains unknown until you fill that slot. Closing Quick picks leaves the full program running. If the full program is reloaded or closed, reopen Quick picks from the draft room to reconnect. On desktop, closing the full window also closes its companion.

## 7. Keep your data safe

### Browser

Data is saved automatically in that browser's local storage. Stay in a normal window, not private/incognito mode. Use the same computer, browser profile, and exact address each time. `localhost` and `127.0.0.1`, or different port numbers, have separate storage.

Clearing browser site data can erase your rankings and drafts. The browser version currently has no built-in backup export or restore controls. Choose desktop if portable backups are important to you.

### Desktop

Data is saved automatically to a local SQLite database named `draftroom.db` in the operating system's application-data area, outside the downloaded source folder. You do not need to install or configure a database.

A `Backups` subfolder stores one JSON backup per save date. Each save updates that day's file, and the ten most recent dates are retained. These are local copies, so use **Export backup** in the app's navigation menu to save a `.draftroom` file somewhere separate, such as an external drive.

To load a portable backup, choose **Restore backup** and select the file. **Restoring replaces your current saved state.** Export your current data first if you want to keep it. Online services are not needed for local saves or manual drafting.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `node` or `npm` is not recognized / command not found | Install Node.js from step 1, close and reopen the command window, and check both version commands again. |
| `ENOENT`, missing `package.json`, or “Could not read package.json” | Your command window is in the wrong folder. Repeat step 3 in the extracted folder containing `package.json`. |
| `npm.ps1 cannot be loaded` or scripts are disabled | You opened PowerShell. Open **Command Prompt** instead and repeat step 3; no execution-policy change is needed. |
| `WRANGLER_LOG_PATH` is not recognized on Windows | Use `npx vinext dev` instead of `npm run dev`. |
| `EBADENGINE` or unsupported Node version | Run `node --version`; install Node 24 LTS and reopen the terminal, then rerun `npm ci`. |
| Installation fails while downloading Electron or another component | Check your internet connection and any workplace proxy restrictions, then retry `npm ci`. Keep the error text if it fails again. |
| `npx` asks to install vinext | Stop with Ctrl+C. Confirm you are in the project folder and that `npm ci` completed successfully. |
| Browser says the site cannot be reached | Make sure the server is still running, wait for its ready message, and use the exact URL it prints. |
| Port 3000 is already in use | Stop an earlier copy of the server with Ctrl+C. Alternatively run `npx vinext dev --port 3001`; remember that a different port has separate browser data. |
| My browser draft disappeared | Check the browser profile and exact address you used before, and whether site data was cleared. Desktop saves are separate from browser saves. |
| Desktop window does not open | Read the terminal error, confirm installation finished, and retry `npm run desktop:run` from the project folder. |
| Online rankings or Sleeper will not load | Check your internet connection and the source/link. External services can be unavailable or change their data. You can still import a local ranking file and track manually. |

If you still need help, share your operating system, the command you ran, and the full error text with the person who sent you this guide or through the [repository's issue page](https://github.com/rrenner315/fantasy-draftroom/issues). Do not include private draft backups.

## Updating later

1. In desktop, export a backup before updating. In browser, keep your existing browser profile and site data.
2. Quit the app or stop the browser server.
3. Download and extract a fresh ZIP from the repository, following step 2. Keep the old folder until the new version works.
4. Open a command window in the new folder and run `npm ci`.
5. Launch your chosen version using step 5A or 5B. For browser saves, use the same address and port as before. For desktop, restore your exported backup if the new launch uses a different data location.
6. If you use an installed desktop app, build and install a new package to update it; downloading source files alone does not update the installed app.
