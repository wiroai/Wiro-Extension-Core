import type { WiroApi } from '../wiro/api.js';
import type { MediaKind, ModelDetail, ModelSummary } from '../types.js';
import { inputFit, type InputFit } from '../gateway/gateway.js';
import { isLiveModel, priceSortKey } from '../pricing/price.js';

// Model lists for an action, straight from Wiro's categories.

export type SortOrder = 'price' | 'popular' | 'newest';

const LIST_TTL_MS = 10 * 60_000;
const PAGE = 100;
const MAX_PER_CATEGORY = 300;

/** Models the extension never lists. The Web Store does not allow sexual content. */
// Uncensored chat models stay out; some say so only in their description. A
// model that detects NSFW content is a moderation tool and stays in.
const UNCENSORED = /uncensored|decensored|abliterated|obliterated|heretic|refusal[- ]reduced/i;
const NSFW = /nsfw/i;
const MODERATION = /detect|classif|moderat|filter|checker/i;

export function isHiddenFromExtension(model: ModelSummary): boolean {
  const text = `${model.slug} ${model.title} ${model.description ?? ''}`;
  if (UNCENSORED.test(text)) return true;
  const name = `${model.slug} ${model.title}`;
  return NSFW.test(name) && !MODERATION.test(name);
}

export interface ListOptions {
  /** Skip live (realtime) models. */
  skipLive?: boolean;
  /** Leave out models that also carry one of these categories. */
  exclude?: string[];
}

export class ModelDirectory {
  private lists = new Map<string, { at: number; models: ModelSummary[] }>();
  private details = new Map<string, Promise<ModelDetail>>();

  constructor(private readonly api: WiroApi) {}

  /** Every model of these categories (any of them), deduplicated, in Wiro's order for the sort. */
  async list(categories: string[], sort: SortOrder = 'price', options: ListOptions = {}): Promise<ModelSummary[]> {
    const wiroSort = sort === 'popular' ? 'ratedusercount' : sort === 'newest' ? 'time' : 'relevance';
    const seen = new Map<string, ModelSummary>();
    for (const category of categories) {
      for (const model of await this.category(category, wiroSort)) {
        if (!seen.has(model.slug)) seen.set(model.slug, model);
      }
    }
    let models = [...seen.values()].filter(model => !isHiddenFromExtension(model));
    if (options.skipLive) models = models.filter(model => !isLiveModel(model));
    const exclude = options.exclude ?? [];
    if (exclude.length > 0) models = models.filter(model => !model.categories.some(category => exclude.includes(category)));
    if (sort === 'price') models = [...models].sort((a, b) => priceSortKey(a) - priceSortKey(b));
    return models;
  }

  private async category(category: string, sort: 'relevance' | 'ratedusercount' | 'time'): Promise<ModelSummary[]> {
    const key = `${category}|${sort}`;
    const cached = this.lists.get(key);
    if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.models;
    const models: ModelSummary[] = [];
    let start = 0;
    while (start < MAX_PER_CATEGORY) {
      const page = await this.api.searchModels({ categories: [category], sort, start, limit: PAGE });
      models.push(...page.models);
      if (page.nextStart === null || page.models.length === 0) break;
      start = page.nextStart;
    }
    this.lists.set(key, { at: Date.now(), models });
    return models;
  }

  /** A model's schema, fetched once per panel session. */
  detail(slug: string): Promise<ModelDetail> {
    let pending = this.details.get(slug);
    if (!pending) {
      pending = this.api.getModel(slug);
      pending.catch(() => this.details.delete(slug));
      this.details.set(slug, pending);
    }
    return pending;
  }

  /**
   * Checks the first models of a list against the input the action needs and
   * reports each answer, a few at a time (the MCP endpoint allows 60 calls a
   * minute per sign-in).
   */
  async checkInputs(models: ModelSummary[], input: MediaKind | 'text' | 'url', onResult: (slug: string, fit: InputFit) => void, limit = 12): Promise<void> {
    const queue = models.slice(0, limit);
    const worker = async () => {
      for (let model = queue.shift(); model; model = queue.shift()) {
        try {
          onResult(model.slug, inputFit(await this.detail(model.slug), input));
        } catch {
          // Leave it unchecked; picking it checks again.
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  /** The first model, in Wiro's popularity order, that needs nothing but the clicked item. */
  async pickDefault(categories: string[], input: MediaKind | 'text' | 'url', options: ListOptions = {}): Promise<string | undefined> {
    const popular = await this.list(categories, 'popular', options);
    let partial: string | undefined;
    for (const model of popular.slice(0, 12)) {
      try {
        const fit = inputFit(await this.detail(model.slug), input);
        if (fit === 'full') return model.slug;
        if (fit === 'partial') partial ??= model.slug;
      } catch {
        // Try the next one.
      }
    }
    return partial ?? popular[0]?.slug;
  }
}
