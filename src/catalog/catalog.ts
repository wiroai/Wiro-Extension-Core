import type { ContentKind, MediaKind } from '../types.js';
import type { KeyValueStore } from '../platform.js';
import { DEFAULT_CATALOG } from './default-catalog.js';

// The right-click actions. Every action points at Wiro categories, never at
// fixed models: the panel lists the category's models live, so new models show
// up without an extension update. The catalog itself also loads from wiro.ai,
// so new actions need no update either.

export interface CatalogAction {
  id: string;
  /** Menu label. */
  label: string;
  /** Panel title; the label without its ellipsis when left out. */
  title?: string;
  kind: ContentKind;
  /** Models of any of these categories. */
  categories: string[];
  /** The file kind the model must take; defaults to the clicked kind. */
  input?: MediaKind | 'text' | 'url';
  /** How the prompt field shows. */
  prompt?: 'required' | 'optional' | 'hidden';
  /** Placeholder for the prompt field. */
  promptHint?: string;
  /** Skip live (realtime) models, which a one-shot run cannot use. */
  skipLive?: boolean;
  /** Leave out models that also carry one of these categories. */
  exclude?: string[];
  /** Wiro Studio instead of a single model. */
  agent?: 'studio';
  /** Items with the same group sit together; a separator goes between groups. */
  group?: number;
}

export interface Catalog {
  version: number;
  actions: CatalogAction[];
  /** "More actions": the categories a kind can open, with a label each. */
  more: Partial<Record<ContentKind, Array<{ category: string; label: string }>>>;
}

const CACHE_KEY = 'wiro.catalog';
const CACHE_MS = 6 * 3600_000;

interface CachedCatalog {
  catalog: Catalog;
  fetchedAt: number;
}

export function actionsFor(catalog: Catalog, kind: ContentKind): CatalogAction[] {
  return catalog.actions.filter(action => action.kind === kind);
}

export function findAction(catalog: Catalog, kind: ContentKind, id: string | undefined): CatalogAction | undefined {
  return id ? catalog.actions.find(action => action.kind === kind && action.id === id) : undefined;
}

export function actionTitle(action: CatalogAction): string {
  return action.title ?? action.label.replace(/…$/, '');
}

/** The input a model must take for this action. */
export function actionInput(action: CatalogAction): MediaKind | 'text' | 'url' {
  if (action.input) return action.input;
  switch (action.kind) {
    case 'image': return 'image';
    case 'video': return 'video';
    case 'audio': return 'audio';
    case 'selection': return 'text';
    case 'page': return 'url';
  }
}

/** Keeps only well-formed actions from a remote catalog. */
export function validCatalog(value: unknown): Catalog | undefined {
  const candidate = value as Partial<Catalog> | undefined;
  if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.actions)) return undefined;
  const kinds: ContentKind[] = ['image', 'video', 'audio', 'selection', 'page'];
  const actions = candidate.actions.filter((action): action is CatalogAction =>
    Boolean(action) && typeof action.id === 'string' && typeof action.label === 'string'
    && kinds.includes(action.kind) && Array.isArray(action.categories)
    && (action.categories.length > 0 || action.agent === 'studio'));
  if (actions.length === 0) return undefined;
  return { version: Number(candidate.version) || 1, actions, more: candidate.more ?? {} };
}

/** The bundled catalog, replaced by the wiro.ai one when it loads. */
export async function loadCatalog(storage: KeyValueStore, url: string, fetchImpl: typeof fetch = (...args) => fetch(...args)): Promise<Catalog> {
  const cached = await storage.get<CachedCatalog>(CACHE_KEY);
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached.catalog;
  try {
    const response = await fetchImpl(url, { cache: 'no-cache' });
    if (response.ok) {
      const catalog = validCatalog(await response.json());
      if (catalog) {
        await storage.set(CACHE_KEY, { catalog, fetchedAt: Date.now() } satisfies CachedCatalog);
        return catalog;
      }
    }
  } catch {
    // Offline or not published yet: the bundled catalog works on its own.
  }
  return cached?.catalog ?? DEFAULT_CATALOG;
}
