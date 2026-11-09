import type { WiroApi } from '../wiro/api.js';
import type { MediaKind, ModelDetail, ModelSummary } from '../types.js';
import { acceptsInput } from '../gateway/gateway.js';
import { isLiveModel, priceSortKey } from '../pricing/price.js';

// Model lists for an action, straight from Wiro's categories.

export type SortOrder = 'price' | 'popular' | 'newest';

const LIST_TTL_MS = 10 * 60_000;
const PAGE = 100;
const MAX_PER_CATEGORY = 300;

/** Models the extension never lists. The Web Store does not allow sexual content. */
export function isHiddenFromExtension(model: ModelSummary): boolean {
  return /uncensored|nsfw/i.test(`${model.slug} ${model.title}`);
}

export class ModelDirectory {
  private lists = new Map<string, { at: number; models: ModelSummary[] }>();
  private details = new Map<string, Promise<ModelDetail>>();

  constructor(private readonly api: WiroApi) {}

  /** Every model of these categories (any of them), deduplicated, in Wiro's order for the sort. */
  async list(categories: string[], sort: SortOrder = 'price', options: { skipLive?: boolean } = {}): Promise<ModelSummary[]> {
    const wiroSort = sort === 'popular' ? 'ratedusercount' : sort === 'newest' ? 'time' : 'relevance';
    const seen = new Map<string, ModelSummary>();
    for (const category of categories) {
      for (const model of await this.category(category, wiroSort)) {
        if (!seen.has(model.slug)) seen.set(model.slug, model);
      }
    }
    let models = [...seen.values()].filter(model => !isHiddenFromExtension(model));
    if (options.skipLive) models = models.filter(model => !isLiveModel(model));
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
  async checkInputs(models: ModelSummary[], input: MediaKind | 'text' | 'url', onResult: (slug: string, ok: boolean) => void, limit = 12): Promise<void> {
    const queue = models.slice(0, limit);
    const worker = async () => {
      for (let model = queue.shift(); model; model = queue.shift()) {
        try {
          onResult(model.slug, acceptsInput(await this.detail(model.slug), input));
        } catch {
          // Leave it unchecked; picking it checks again.
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }
}
