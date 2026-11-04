import type { CapacitorConfig } from '@capacitor/cli';

// Privacy posture: no server.url (the app loads only its bundled files), no cleartext, no remote debugging,
// no extra navigation allowlist. The meta CSP in ui/index.html applies unchanged to https://localhost.
const config: CapacitorConfig = {
  appId: 'app.eqdownload.android',
  appName: 'EqDownload',
  webDir: 'ui/dist',
  server: { androidScheme: 'https', cleartext: false },
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
};

export default config;
