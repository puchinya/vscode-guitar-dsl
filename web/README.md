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
