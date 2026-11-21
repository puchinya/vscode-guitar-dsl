# Privacy Policy

Effective date: 2026-11-21  
Last revised: 2026-11-21

## Summary

GuitarDSL does not collect or store users' scores, drafts, Google Drive files, or workspace data on servers operated by puchinya. Such data remains on the user's device or in the user's Google Drive when the user enables that integration.

## Local storage

GuitarDSL Web can be used without a Google account. Scores, recoverable drafts, workspace layout, and related local settings are stored in IndexedDB in the browser on the user's device. The operator does not upload or retain those contents on an operator-controlled application server. Removing this site's browser storage may remove local scores and drafts. Users should keep their own backups.

## Optional Google Drive integration

Google Drive is optional and is connected only after the user chooses the connection action. The browser requests the scopes `https://www.googleapis.com/auth/drive.file` and `https://www.googleapis.com/auth/drive.appdata`, and communicates directly with Google APIs. The `drive.file` scope is limited to files the user opens or creates with the app and files the user separately authorizes. It does not grant GuitarDSL general access to the user's Drive.

While connected, the browser temporarily processes the Google account permission ID, display name, and email address to identify and show the selected account. It also processes Drive file IDs, names, score contents, and necessary file metadata to open, edit, save, and display the GuitarDSL library. Scores that the user explicitly saves to Drive are stored in that user's Google Drive.

The app stores one `guitardsl-state-v1.json` file in the user's hidden Google Drive app-data area. It contains the selected library folder ID, setup prompt state, and bounded lists of open, active, and recent Drive file IDs. It does not contain score source, local document IDs, drafts, OAuth credentials, or email addresses. Access tokens stay in memory. Account-keyed pending recovery metadata may be stored locally in the browser.

## Operator and service providers

The operator, puchinya, does not collect, upload to an operator-controlled server, retain on an operator backend, sell, or use scores, drafts, Drive content, or workspace data for advertising or generalized AI training. Google processes information sent to its APIs under Google's terms. Website hosting and content-delivery providers may process IP addresses and ordinary technical request and access-log data under their own terms. This policy does not claim that ordinary website requests generate no technical data.

Google API Services User Data is used in accordance with [Google's API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including its Limited Use requirements. Google, hosting providers, and other third parties act under their own terms and privacy policies.

## Retention and choices

Users can remove local scores, drafts, layout, and settings by deleting this site's browser storage. Users manage or delete score files in their own Google Drive and may manage GuitarDSL app-data through Google account controls where available. Disconnecting GuitarDSL or revoking its Google authorization does not delete files stored in Drive. Users can revoke third-party access through Google account security settings. Local data may be lost if the browser profile or device is removed; keep separate backups.

## Operator and contact

Operator: puchinya  
Contact: [support@guitardsl.app](mailto:support@guitardsl.app)
