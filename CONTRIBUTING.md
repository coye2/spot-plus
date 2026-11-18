# Contributing to Spot+

Thanks for helping make Spot+ better.

## Reporting a bug

Open an [issue](https://github.com/coye2/spot-plus/issues/new/choose) and include:

- your device and browser (for example, iPhone 16 · Safari · Home Screen app)
- what you did, what you expected and what happened instead
- a screenshot or screen recording if it's visual

## Before you contribute

Spot+ is not open source (see [LICENSE](LICENSE)). By opening a pull request you agree that your contribution can be used in Spot+ under that license.

## Making changes

### Mandatory maintenance gate workflow

While active development or unverified changes are underway on `main`, **maintenance mode MUST stay enabled** so public visitors see the *"We’ll return momentarily"* maintenance screen and cannot access the app:

1. Keep `MAINTENANCE_MODE = true` in `js/maintenance.js` and `var MAINTENANCE = true;` in `js/boot.js` during all active development commits.
2. Only authorized maintainer sessions (`coye-9` Spotify accounts and unlocked owner devices via `spotplus.devAccess` / `?dev=coye-9`) bypass the gate while maintenance is active.
3. **Do not disable maintenance mode** (`MAINTENANCE_MODE = false` / `MAINTENANCE = false`, plus `SHELL_CACHE` bump in `sw.js`) until development is complete and the maintainer explicitly confirms the release is **stable**.

### Standard workflow

1. Fork the repo and create a branch from `main`.
2. Run `npm ci`, then `npm run dev` to work locally.
3. Before opening a pull request, make sure these all pass:

   ```sh
   npm run lint
   npm test
   npm run check
   npm run build
   ```

4. If you change files the app needs offline, add them to the `SHELL` list in `sw.js` and bump its cache version.
5. Keep pull requests focused, and describe what changed and how you tested it, including the devices you tried.

## Style

- Plain ES modules, no framework. Keep dependencies to a minimum.
- New styles go in `css/polish.css`.
- Write user-facing text in plain language, with no technical jargon.
- Never collect passwords or send user data anywhere without encryption.
