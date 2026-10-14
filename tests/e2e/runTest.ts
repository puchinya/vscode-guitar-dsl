import * as fs from 'fs';
import { createHash } from 'crypto';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  // Keep VS Code's IPC socket paths short on macOS, where AF_UNIX paths have
  // a small fixed limit and the default profile lives under the checkout.
  const tempRoot = process.platform === 'win32' ? os.tmpdir() : '/tmp';
  const userDataDir = fs.mkdtempSync(path.join(tempRoot, 'guitar-dsl-vscode-test-'));
  const previousPortableDir = process.env.VSCODE_PORTABLE;

  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');

    // The path to test runner
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './index');

    const captureScreenshots = process.env.GUITARDSL_E2E_CAPTURE_SCREENSHOTS === '1';
    let remoteDebuggingArgs: string[] = [];
    if (captureScreenshots) {
      const server = net.createServer();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Could not reserve a local DevTools port');
      const remoteDebuggingPort = address.port;
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      process.env.GUITARDSL_E2E_CDP_PORT = String(remoteDebuggingPort);
      remoteDebuggingArgs = [
        `--remote-debugging-port=${remoteDebuggingPort}`
      ];
    }

    const locale = process.env.GUITARDSL_E2E_LOCALE;
    const languagePackDirectory = captureScreenshots ? process.env.GUITARDSL_E2E_LANGUAGE_PACK_DIR : undefined;
    let extensionDirectoryArgs: string[] = [];
    if (captureScreenshots) {
      if (locale) {
        // VS Code resolves argv.json from VSCODE_PORTABLE (or the real
        // application data folder), not from --user-data-dir. Point portable
        // mode at this isolated test profile so locale selection is honored
        // without reading or changing the user's normal argv.json.
        process.env.VSCODE_PORTABLE = userDataDir;
        fs.writeFileSync(path.join(userDataDir, 'argv.json'), JSON.stringify({ locale }, null, 2));
      }
      const profileUserDataDir = path.join(userDataDir, 'user-data');
      fs.mkdirSync(profileUserDataDir, { recursive: true });
      const extensionDirectory = path.join(userDataDir, 'extensions');
      fs.mkdirSync(extensionDirectory, { recursive: true });
      if (languagePackDirectory) {
        const copiedPackPath = path.join(extensionDirectory, path.basename(languagePackDirectory));
        fs.cpSync(languagePackDirectory, copiedPackPath, { recursive: true });

        // VS Code uses extensions.json as the installed-extension registry;
        // copying only the language-pack files does not make the pack visible.
        const packageJson = JSON.parse(fs.readFileSync(path.join(copiedPackPath, 'package.json'), 'utf8')) as {
          name: string;
          publisher: string;
          version: string;
          contributes?: {
            localizations?: Array<{
              languageId: string;
              translations: Array<{ id: string; path: string }>;
            }>;
          };
        };
        const sourceRegistryPath = path.join(path.dirname(languagePackDirectory), 'extensions.json');
        const sourceRegistry = JSON.parse(fs.readFileSync(sourceRegistryPath, 'utf8')) as Array<{
          identifier: { id: string; uuid?: string };
          location: Record<string, unknown>;
          relativeLocation: string;
          [key: string]: unknown;
        }>;
        const extensionId = `${packageJson.publisher}.${packageJson.name}`.toLowerCase();
        const languagePackEntry = sourceRegistry.find(entry => entry.identifier.id.toLowerCase() === extensionId);
        if (!languagePackEntry) throw new Error(`Language pack ${extensionId} is not registered in ${sourceRegistryPath}`);
        const isolatedEntry = JSON.parse(JSON.stringify(languagePackEntry)) as typeof languagePackEntry;
        isolatedEntry.location = { ...isolatedEntry.location, path: copiedPackPath };
        isolatedEntry.relativeLocation = path.basename(copiedPackPath);
        fs.writeFileSync(path.join(extensionDirectory, 'extensions.json'), JSON.stringify([isolatedEntry]));

        if (locale) {
          const localization = packageJson.contributes?.localizations?.find(
            item => item.languageId.toLowerCase() === locale.toLowerCase()
          );
          if (!localization) throw new Error(`Language pack ${extensionId} does not provide locale ${locale}`);
          const translations = Object.fromEntries(localization.translations.map(translation => [
            translation.id,
            path.resolve(copiedPackPath, translation.path)
          ]));
          if (typeof translations.vscode !== 'string') {
            throw new Error(`Language pack ${extensionId} has no core VS Code translation for locale ${locale}`);
          }
          const hash = createHash('sha256').update(`${extensionId}@${packageJson.version}`).digest('hex');
          fs.writeFileSync(path.join(profileUserDataDir, 'languagepacks.json'), JSON.stringify({
            [localization.languageId]: {
              hash,
              extensions: [{ extensionIdentifier: languagePackEntry.identifier, version: packageJson.version }],
              translations
            }
          }));
        }
      }
      extensionDirectoryArgs = [`--extensions-dir=${extensionDirectory}`];
    }

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        ...(captureScreenshots ? [] : ['--disable-extensions']),
        `--user-data-dir=${userDataDir}`,
        ...extensionDirectoryArgs,
        ...remoteDebuggingArgs,
        ...(locale ? [`--locale=${locale}`] : [])
      ]
    });
  } catch (err) {
    console.error('Failed to run tests', err);
    process.exitCode = 1;
  } finally {
    if (previousPortableDir === undefined) delete process.env.VSCODE_PORTABLE;
    else process.env.VSCODE_PORTABLE = previousPortableDir;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main();
