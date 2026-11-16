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
