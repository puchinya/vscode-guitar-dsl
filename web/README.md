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

## Cloudflare Workers Static Assets deployment (one Worker + Previews)

GitHub Actions owns automated deployment. `.github/workflows/cloudflare-workers.yml` runs Node 22, `npm ci`, `npm run build:web`, then uploads `web/dist/` with Wrangler 4.160.0 or later. `wrangler.jsonc` configures the existing Worker `guitardsl` with SPA fallback and Workers Previews. No server-side request handler or backend is added.

| Trigger | GitHub environment | Cloudflare target | Public URL | Wrangler command |
| --- | --- | --- | --- | --- |
| Push to `main` (including merges) | `development` | Named Preview `dev` of **`guitardsl`** | `dev.guitardsl.app` | `wrangler preview --config wrangler.jsonc --name dev` |
| Push any tag whose commit is reachable from `main` | `production` | Existing `guitardsl` production deployment | `guitardsl.app` | `wrangler deploy --config wrangler.jsonc` |

The Preview named `dev` has a stable URL that points to its latest build and does **not** replace the production deployment. Distinct builds may bake in distinct public Google credentials. Pushing a PR or a non-main branch never publishes; a tag outside the `main` history fails before building or uploading. A tag of an older commit already reachable from `main` can intentionally release it. Production deployments are never automatically canceled; obsolete dev Preview updates may be canceled.

### One-time Cloudflare and GitHub setup

1. Reuse the existing Worker **`guitardsl`**, which currently owns `guitardsl.app`. Configure its `guitardsl.app` custom domain with `enabled: true` and `previews_enabled: true`. This preserves the production endpoint and also enables Preview aliases under `*.guitardsl.app`. The named Preview `dev` then resolves at **`dev.guitardsl.app`**. Do not create a second Worker for development.
2. Remove any conflicting explicit `dev.guitardsl.app` record or disabled Worker custom-domain association that predates Previews, after verifying it is unused. Preview routing generates DNS/certificate automatically; protect unrelated `guitardsl.app` MX/TXT Email Routing DNS and other subdomains.
3. Existing experimental Cloudflare Pages projects are **not** deployment targets. Delete them only after confirming that they contain no deployments/data and their custom-domain claims are no longer required.
4. Retain repository Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Require Cloudflare Workers Edit / Workers Scripts Edit on the account; to manage custom domains require Zone → Workers Routes → Write on `guitardsl.app`. Previous Pages-only permission is not sufficient. Do not commit tokens or pass secrets in `VITE_` variables.
5. Keep separate GitHub environments `development` and `production` for approval/tag restrictions and the optional build-time public values `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`, and `VITE_GOOGLE_APP_ID`. Without the Google values, local documents still work but Google Drive integration is disabled. Authorize both `https://guitardsl.app` and `https://dev.guitardsl.app` as Web OAuth JavaScript origins; restrict browser API keys to their appropriate referrers/APIs. Do not use an OAuth client secret.
6. Do not enable Cloudflare Workers Builds / Git auto deployment: GitHub Actions remains the single publish owner. Workers Previews requires Wrangler 4.135.0 or later; CI pins a supported version.

### Release and verification

After merging this PR into `main`, check the development job and `https://dev.guitardsl.app`, including direct navigation to a deep SPA route. Verify the Worker `guitardsl` **production deployment/version remains unchanged** after the Preview upload.

To publish production, explicitly create and push a tag on a `main` commit:

```sh
git switch main
git pull --ff-only origin main
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

Only then inspect `Deploy Web to Cloudflare Workers`, the production version of `guitardsl` and `https://guitardsl.app`. Build/auth/permission/tag validation failures stop deployment without a fallback. Avoid environment rules that reject the intended release tags. The workflow matches all pushed tags: protect tag creation or require production reviewers to authorize releases.

**Operational caveat:** Workers Previews uses the same named Worker with separate Preview versions; runtime settings/bindings must be assessed independently if server-side resources are ever added. The current Web SPA does not add such resources.
