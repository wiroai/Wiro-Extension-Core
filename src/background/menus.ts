import type { Catalog } from '../catalog/catalog.js';
import { actionsFor } from '../catalog/catalog.js';
import type { ContentKind, Job } from '../types.js';

// Builds the right-click menus from the catalog and turns a click into a Job.
// Each content kind gets one "Wiro" item with the kind's actions under it, so
// Chrome, Firefox and Safari all show "Wiro ▸" next to their own items.

export interface MenuItem {
  id: string;
  parentId?: string;
  title?: string;
  contexts?: string[];
  type?: 'normal' | 'separator';
}

export interface MenusApi {
  removeAll(): Promise<void>;
  create(item: MenuItem): void;
}

export interface MenuClick {
  menuItemId: string | number;
  srcUrl?: string;
  linkUrl?: string;
  pageUrl?: string;
  frameUrl?: string;
  selectionText?: string;
  mediaType?: string;
}

const CONTEXTS: Record<ContentKind, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  selection: 'selection',
  page: 'page',
};

export const MORE_ID = 'more';
export const TRAY_ID = 'tray';

export async function buildMenus(menus: MenusApi, catalog: Catalog): Promise<void> {
  await menus.removeAll();
  for (const kind of Object.keys(CONTEXTS) as ContentKind[]) {
    const actions = actionsFor(catalog, kind);
    if (actions.length === 0) continue;
    const contexts = [CONTEXTS[kind]];
    const parentId = `wiro:${kind}`;
    menus.create({ id: parentId, title: 'Wiro', contexts });
    let group = actions[0]?.group ?? 0;
    let separators = 0;
    for (const action of actions) {
      if ((action.group ?? 0) !== group) {
        menus.create({ id: `${parentId}:sep${separators++}`, parentId, type: 'separator', contexts });
        group = action.group ?? 0;
      }
      menus.create({ id: `${parentId}:${action.id}`, parentId, title: action.label, contexts });
    }
    menus.create({ id: `${parentId}:sep${separators++}`, parentId, type: 'separator', contexts });
    menus.create({ id: `${parentId}:${MORE_ID}`, parentId, title: 'More actions…', contexts });
    if (kind !== 'page') menus.create({ id: `${parentId}:${TRAY_ID}`, parentId, title: 'Add to tray', contexts });
  }
}

/** The menu item id → kind and action, or undefined for an item that is not ours. */
export function parseMenuId(id: string | number): { kind: ContentKind; actionId: string } | undefined {
  const match = /^wiro:(image|video|audio|selection|page):(.+)$/.exec(String(id));
  if (!match) return undefined;
  return { kind: match[1] as ContentKind, actionId: match[2] as string };
}

export function jobFromClick(click: MenuClick, tab?: { url?: string; title?: string }): Job | undefined {
  const parsed = parseMenuId(click.menuItemId);
  if (!parsed) return undefined;
  const job: Job = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    kind: parsed.kind,
    actionId: parsed.actionId,
    pageUrl: click.pageUrl ?? tab?.url,
    pageTitle: tab?.title,
    createdAt: Date.now(),
  };
  if (parsed.kind === 'selection') job.text = click.selectionText;
  else if (parsed.kind === 'page') job.url = click.pageUrl ?? tab?.url;
  else job.url = click.srcUrl ?? click.linkUrl;
  return job;
}

export const JOB_KEY = 'wiro.job';
