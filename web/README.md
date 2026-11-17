# GuitarDSL Web app

The app is a static Vite SPA. Vue 3 owns the Web shell and workspace views; a single `WebWorkspaceController` owns document, storage, Drive, preview, and Inspector state. Pinia's one Web-only workspace store projects the latest Controller snapshot through a shallow view ref and derives the Problems summary. It does not own source, revisions, persistence, Drive sessions, audio, or commands; edits and actions still go through the Controller. `main.ts` attaches the store before mounting Vue and starts the Controller after its hosts mount. The app detaches before Controller disposal on an ordinary page exit or Vue unmount, while BFCache suspension keeps the same store and subscription. The VS Code extension remains separate and does not depend on Vue or Pinia.

Vue-owned fixed labels, tooltips, and ARIA text use `vue-i18n` 11.4.22 Composition API with statically imported English and Japanese messages. The Controller's locale and IndexedDB preference remain authoritative; `App.vue` projects each snapshot locale into the global Composer and the document language. Controller-generated menus, Help and Inspector DOM, and shared-package messages continue using their existing translation owners.

Local documents work without Google credentials:

```sh
npm install
npm run dev --workspace @guitardsl/web
```

To enable Google Drive, enable the Google Drive API and Google Picker API in a Google Cloud project, configure a Web OAuth client with the development and deployed JavaScript origins, then copy `.env.example` to `.env.local` and set the public client ID, a referrer-restricted API key, and the project number. The browser asks for `drive.file` and `drive.appdata`; there is no client secret or app backend.

The production Web app is installable as a PWA. After its first online load and service worker setup, local documents and drafts stored in IndexedDB can be opened, edited, previewed, and exported to PDF offline. Google Drive authentication, Picker, listing, and saves need a network connection. The service worker precaches same-origin static assets, including the PDF fonts; it does not cache document data, OAuth tokens, or Google API responses. Updates are offered to the user and wait while text composition, drafts, or Drive synchronization are not safe to interrupt. The app never activates an update and reloads automatically.

```sh
npm run build:web
npm run test:web
```

`build:web` type-checks Web TypeScript and Vue templates before producing `web/dist/`. Drive and Picker credentials are deployment configuration and must not be committed.

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
