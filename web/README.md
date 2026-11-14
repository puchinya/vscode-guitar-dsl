# GuitarDSL Web app

The app is a static Vite SPA. Local documents work without Google credentials:

```sh
npm install
npm run dev --workspace @guitardsl/web
```

To enable Google Drive, enable the Google Drive API and Google Picker API in a Google Cloud project, configure a Web OAuth client with the development and deployed JavaScript origins, then copy `.env.example` to `.env.local` and set the public client ID, a referrer-restricted API key, and the project number. The browser asks only for `drive.file`; there is no client secret or app backend.

```sh
npm run build:web
npm run test:web
```

`build:web` type-checks the Web TypeScript before producing `web/dist/`. Drive and Picker credentials are deployment configuration and must not be committed.

## Cloudflare Pages deployment

`.github/workflows/cloudflare-pages.yml` builds the same `web/dist/` assets on GitHub Actions (Node 22, `npm ci`, `npm run build:web`) and uploads them to **two distinct Cloudflare Pages projects** using Wrangler:

| Trigger | GitHub environment | Default Pages project | Custom domain |
| --- | --- | --- | --- |
| Push to `main` (including merged PRs) | `development` | `guitardsl-dev` | `dev.guitardsl.app` |
| Push any Git tag pointing to a commit reachable from `main` | `production` | `guitardsl` | `guitardsl.app` |

PRs do not publish. A tag from an unmerged branch **fails before Cloudflare upload**. Both projects use `main` as their Pages **production branch**; this is not a preview-branch deployment. Tagging an older commit still reachable from `main` deliberately releases that commit, not the latest `main`.

### One-time Cloudflare setup

1. Create two **separate Pages projects** with **Direct Upload**, named `guitardsl-dev` and `guitardsl` by default; set each project's production branch to `main`. Existing projects can use different names via the variables below. Do not point both environments to the same Pages project.
2. In each project's **Custom domains**, associate `dev.guitardsl.app` with the development project and `guitardsl.app` with the production project. Complete the required Cloudflare DNS setup.
3. If either Pages project has Cloudflare's Git integration, disable its automatic deployments, so GitHub Actions remains the only deployment trigger. For a new project, prefer Direct Upload rather than Git integration.
4. Keep these already configured **repository Actions secrets**: `CLOUDFLARE_API_TOKEN` (token with Cloudflare Pages Edit permission for the target account) and `CLOUDFLARE_ACCOUNT_ID`. Do not put values in files or build-time `VITE_` variables.
5. In GitHub **Settings → Environments**, create or configure `development` and `production` for deployment protection and environment-specific variables. The following **environment variables** are optional:
   - `CLOUDFLARE_PAGES_PROJECT`: override the default project name for that environment; both values must refer to different Pages projects.
   - `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`, `VITE_GOOGLE_APP_ID`: public browser credentials built into this environment's Vite bundle. Without them, local documents still work but Google Drive integration is unavailable.
6. If enabling Google Drive, register **both** `https://guitardsl.app` and `https://dev.guitardsl.app` as authorized JavaScript origins for the Google Web OAuth client(s). Restrict each Google API key to its intended HTTP referrers and permitted APIs. These are **public** browser values, not a Google OAuth client secret.

Do not enable GitHub environment *branch-only* restrictions for the `production` environment without allowing the intended release **tags**. Protect release tags and/or require reviewers for production deployments as appropriate.

### Release and verification

After merging a PR to `main`, inspect the development deployment at `https://dev.guitardsl.app`. For a production release, create and push a tag **on a commit in `main`**:

```sh
git switch main
git pull --ff-only origin main
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

Inspect the `Deploy Web to Cloudflare Pages` workflow in GitHub Actions and confirm the matching Pages deployment and custom domain. A failed build, missing secret, missing project, tag ancestry mismatch, or failed upload stops that deployment; there is no fallback domain. The workflow does not automatically create the Cloudflare projects, assign domains, or verify browser Google OAuth end-to-end.

The deploy workflow covers **all pushed tags**, not only `v*`. Use GitHub tag protection/rules if only authorized release tags should publish to production.
