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

## Cloudflare Workers Static Assets deployment

`.github/workflows/cloudflare-workers.yml` runs Node 22, `npm ci`, and the root `npm run build:web` command on GitHub Actions, then publishes the same `web/dist/` static artifact with Wrangler. `wrangler.jsonc` configures Workers Static Assets with single-page-application fallback; no server-side Worker request handler or application backend is added.

| Trigger | GitHub environment | Worker name | Custom domain | Wrangler command |
| --- | --- | --- | --- | --- |
| Push to `main` (including merged PRs) | `development` | `guitardsl-dev` | `dev.guitardsl.app` | `wrangler deploy --config wrangler.jsonc --env development` |
| Push a Git tag whose commit is reachable from `main` | `production` | `guitardsl` (existing) | `guitardsl.app` | `wrangler deploy --config wrangler.jsonc` |

Pull requests and pushes to other branches never deploy. Before a tag deployment, full history and the latest `origin/main` are fetched and `git merge-base --is-ancestor HEAD origin/main` enforces the release guard for lightweight and annotated tags. A tag on a previously merged `main` commit can intentionally release that older version. The workflow currently accepts all pushed tags; protect tag creation or require production environment reviewers if only authorized releases should publish.

### One-time Cloudflare and GitHub setup

1. Keep the existing production Worker **`guitardsl`** bound to **`guitardsl.app`**. Do **not** delete or overwrite its current production version during initial setup. Its first replacement must come from an intentionally pushed tag after the PR has merged.
2. The development Worker is `guitardsl-dev`. Its custom domain `dev.guitardsl.app` is declared in `wrangler.jsonc`; if it does not exist yet, the first authorized `main` deployment creates it and attempts to bind the domain. Distinct Workers must serve development and production. Do not attach the development hostname to the production Worker.
3. GitHub Actions, **not Cloudflare Workers Builds**, is the automated deploy owner. Do not configure a second Git-connected build pipeline.
4. Retain the repository Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token must have **Workers Edit / Workers Scripts Edit** permission for the account and **Zone → Workers Routes → Write** for `guitardsl.app` if the domain routes are created or changed. The previous Pages Edit-only token is insufficient. Never commit token contents or pass them through `VITE_` variables.
5. In GitHub **Settings → Environments**, configure `development` and `production` with appropriate deployment restrictions. Production tag workflows must not be blocked by branch-only filters. The optional environment-scoped public build variables are `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`, and `VITE_GOOGLE_APP_ID`. Omitting them retains local documents but disables Drive integration.
6. When enabling Google Drive, authorize `https://dev.guitardsl.app` and `https://guitardsl.app` as Web OAuth JavaScript origins. Restrict each browser API key by intended HTTP referrers and enabled Google APIs. These are public browser credentials; **never** supply an OAuth client secret.
7. Any prior experimental Cloudflare Pages projects are **not** used for publishing. Only clean them up after confirming they hold no deployments/data, and keep the existing production Worker mapping, Email Routing MX/TXT and unrelated DNS intact.

### Release and verification

After merging the PR, inspect the `Deploy Web to Cloudflare Workers` GitHub Action, then check `https://dev.guitardsl.app` and verify that direct navigation to a nested SPA path returns the app shell. Check the Worker named `guitardsl-dev` receives the deployment; the production Worker remains unchanged.

For production, create and push a tag on a commit in `main`:

```sh
git switch main
git pull --ff-only origin main
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

Inspect the production workflow status, the `guitardsl` Worker deployment version, and `https://guitardsl.app`. A failed build, missing secret, missing permission, failed domain binding, or off-main tag stops that deployment; there is **no fallback** to the other Worker. Production rollbacks should be made with an intentionally approved release tag on the desired prior commit (or with explicit Cloudflare version rollback procedures), not by pushing an unreviewed tag. No production tag is pushed by the deployment setup itself.
