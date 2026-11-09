// The panel in a plain web page, with an in-memory platform and the local mock
// MCP server, for UI tests without a browser extension runtime.
import '../../src/ui/styles.css';
import { mountPanel } from '../../src/ui/app.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import type { KeyValueStore, Platform } from '../../src/platform.js';
import { JOB_KEY } from '../../src/background/menus.js';
import type { Job } from '../../src/types.js';

function memory(seed: Record<string, unknown> = {}): KeyValueStore {
  const values = new Map<string, unknown>(Object.entries(seed));
  const listeners = new Set<(changes: Record<string, unknown>) => void>();
  return {
    get: async <T,>(key: string) => values.get(key) as T | undefined,
    async set(key, value) { values.set(key, value); listeners.forEach(listener => listener({ [key]: value })); },
    async remove(key) { values.delete(key); listeners.forEach(listener => listener({ [key]: undefined })); },
    onChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

const params = new URLSearchParams(location.search);
const signedIn = params.get('signedin') !== '0';
const config = { ...DEFAULT_CONFIG, mcpUrl: params.get('mcp') ?? 'http://127.0.0.1:8788/v1', catalogUrl: 'http://127.0.0.1:8788/none.json' };
const opened: string[] = [];

const platform: Platform = {
  name: 'chrome',
  version: '0.1.0',
  storage: memory(signedIn ? {
    'wiro.oauth.tokens': { accessToken: 'wiro_at_harness', refreshToken: 'wiro_rt_harness', expiresAt: Date.now() + 3600_000, clientId: 'wiro_mc_harness', issuer: config.issuer },
  } : {}),
  session: memory(),
  clientName: 'Wiro Harness',
  redirectUri: () => 'https://harness.chromiumapp.org/',
  launchAuth: async () => { throw new Error('closed'); },
  openTab: url => { opened.push(url); },
};

Object.assign(window, {
  wiroJob: (job: Partial<Job>) => platform.session.set(JOB_KEY, { id: String(Date.now()), createdAt: Date.now(), ...job }),
  wiroOpened: opened,
});

mountPanel(document.getElementById('app') as HTMLElement, platform, config);
