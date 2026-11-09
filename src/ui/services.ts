import { DEFAULT_CONFIG, type WiroConfig } from '../config.js';
import type { Platform } from '../platform.js';
import { OAuth } from '../auth/oauth.js';
import { McpClient } from '../mcp/client.js';
import { WiroApi } from '../wiro/api.js';
import { ModelDirectory } from '../catalog/models.js';
import { loadCatalog, type Catalog } from '../catalog/catalog.js';
import type { HistoryEntry, TrayItem } from '../types.js';

export interface Services {
  platform: Platform;
  config: WiroConfig;
  oauth: OAuth;
  api: WiroApi;
  directory: ModelDirectory;
  catalog: () => Promise<Catalog>;
}

export function createServices(platform: Platform, config: WiroConfig = DEFAULT_CONFIG): Services {
  const oauth = new OAuth(platform, config);
  const api = new WiroApi(new McpClient(config.mcpUrl, oauth));
  let catalog: Promise<Catalog> | undefined;
  return {
    platform,
    config,
    oauth,
    api,
    directory: new ModelDirectory(api),
    catalog: () => (catalog ??= loadCatalog(platform.storage, config.catalogUrl)),
  };
}

const TRAY_KEY = 'wiro.tray';
const HISTORY_KEY = 'wiro.history';
const LAST_MODEL_KEY = 'wiro.lastModel';
const TRAY_MAX = 20;
const HISTORY_MAX = 50;

export async function readTray(platform: Platform): Promise<TrayItem[]> {
  return (await platform.storage.get<TrayItem[]>(TRAY_KEY)) ?? [];
}

export async function addToTray(platform: Platform, item: Omit<TrayItem, 'id' | 'addedAt'>): Promise<void> {
  const items = await readTray(platform);
  if (item.url && items.some(existing => existing.url === item.url)) return;
  items.unshift({ ...item, id: Math.random().toString(36).slice(2, 10), addedAt: Date.now() });
  await platform.storage.set(TRAY_KEY, items.slice(0, TRAY_MAX));
}

export async function removeFromTray(platform: Platform, id: string): Promise<void> {
  await platform.storage.set(TRAY_KEY, (await readTray(platform)).filter(item => item.id !== id));
}

export async function readHistory(platform: Platform): Promise<HistoryEntry[]> {
  return (await platform.storage.get<HistoryEntry[]>(HISTORY_KEY)) ?? [];
}

export async function addHistory(platform: Platform, entry: HistoryEntry): Promise<void> {
  const items = (await readHistory(platform)).filter(existing => existing.id !== entry.id);
  items.unshift(entry);
  await platform.storage.set(HISTORY_KEY, items.slice(0, HISTORY_MAX));
}

export async function lastModel(platform: Platform, actionKey: string): Promise<string | undefined> {
  const all = (await platform.storage.get<Record<string, string>>(LAST_MODEL_KEY)) ?? {};
  return all[actionKey];
}

export async function rememberModel(platform: Platform, actionKey: string, slug: string): Promise<void> {
  const all = (await platform.storage.get<Record<string, string>>(LAST_MODEL_KEY)) ?? {};
  all[actionKey] = slug;
  await platform.storage.set(LAST_MODEL_KEY, all);
}
