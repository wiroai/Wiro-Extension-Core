import { describe, expect, it } from 'vitest';
import { challengeFor, randomString } from '../src/auth/pkce.js';
import { parseSse, sseJsonMessages } from '../src/util/sse.js';
import { buildParams, fitValue, missingInputs, slotsFor, acceptsInput } from '../src/gateway/gateway.js';
import { quote, shortPricing, priceSortKey, formatUsd } from '../src/pricing/price.js';
import { validCatalog } from '../src/catalog/catalog.js';
import { DEFAULT_CATALOG } from '../src/catalog/default-catalog.js';
import { buildMenus, jobFromClick, type MenuItem } from '../src/background/menus.js';
import type { ModelDetail, ModelParameter } from '../src/types.js';

function param(id: string, type: string, extra: Partial<ModelParameter> = {}): ModelParameter {
  return { id, type, label: id, required: false, options: [], advanced: false, ...extra };
}

function model(params: ModelParameter[], extra: Partial<ModelDetail> = {}): ModelDetail {
  return { slug: 'x/y', title: 'X', categories: [], parameters: [{ title: '', items: params }], ...extra };
}

describe('pkce', () => {
  it('makes the RFC 7636 challenge', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('makes verifiers from the unreserved set', () => {
    expect(randomString(64)).toMatch(/^[A-Za-z0-9._~-]{64}$/);
  });
});

describe('sse', () => {
  it('reads data lines into messages', () => {
    const body = 'event: message\nid: 1\ndata: {"jsonrpc":"2.0","id":3,"result":{}}\n\n: keep-alive\n\n';
    expect(parseSse(body)[0]?.event).toBe('message');
    expect(sseJsonMessages(body)).toEqual([{ jsonrpc: '2.0', id: 3, result: {} }]);
  });
});

describe('gateway', () => {
  // MiniMax H3 Lite: first and last frame, prompt, duration (4-15), resolution.
  const h3 = model([
    param('inputImage', 'combinefileinput', { label: 'First Frame Image' }),
    param('prompt', 'textarea', { required: true }),
    param('duration', 'number', { required: true, min: 4, max: 15, default: '5' }),
    param('resolution', 'select', { required: true, options: [{ label: '480P', value: '480P' }, { label: '768P', value: '768P' }] }),
    param('inputImageLast', 'combinefileinput', { label: 'Last Frame Image', advanced: true }),
    param('ratio', 'select', { advanced: true, options: [{ label: '16:9', value: '16:9' }, { label: '9:16', value: '9:16' }] }),
  ]);
  // Hailuo-like: different names for the same ideas.
  const other = model([
    param('first_frame_image', 'fileinput', { required: true, label: 'Image' }),
    param('text', 'textarea'),
    param('durationSeconds', 'select', { options: [{ label: '6', value: '6' }, { label: '10', value: '10' }] }),
    param('quality', 'select', { options: [{ label: '768P', value: '768P' }, { label: '1080P', value: '1080P' }] }),
  ]);

  it('finds the common slots under different names', () => {
    const a = slotsFor(h3);
    expect(a.named.prompt?.id).toBe('prompt');
    expect(a.named.duration?.id).toBe('duration');
    expect(a.named.resolution?.id).toBe('resolution');
    expect(a.files.map(slot => [slot.param.id, slot.kind, slot.mode])).toEqual([['inputImage', 'image', 'list'], ['inputImageLast', 'image', 'list']]);
    const b = slotsFor(other);
    expect(b.named.prompt?.id).toBe('text');
    expect(b.named.duration?.id).toBe('durationSeconds');
    expect(b.named.resolution?.id).toBe('quality');
  });

  it('maps the same common values onto each model', () => {
    const common = { files: { image: ['https://cdn.example/dog.jpg'] }, prompt: 'the dog runs', duration: '5', resolution: '768P' };
    expect(buildParams(h3, common)).toEqual({ inputImage: ['https://cdn.example/dog.jpg'], prompt: 'the dog runs', duration: '5', resolution: '768P' });
    // 5 seconds snaps to 6, the nearest option; the last-frame field does not take the only image.
    expect(buildParams(other, common)).toEqual({ first_frame_image: 'https://cdn.example/dog.jpg', text: 'the dog runs', durationSeconds: '6', quality: '768P' });
  });

  it('fits values to ranges and options', () => {
    expect(fitValue(param('d', 'number', { min: 4, max: 15 }), '30')).toBe('15');
    expect(fitValue(param('r', 'select', { options: [{ label: '1K', value: '1K' }, { label: '2K', value: '2K' }] }), '1k')).toBe('1K');
  });

  it('puts multifileinput URLs in the paired UrlMultiple field', () => {
    const cv = model([param('inputDocumentMultiple', 'multifileinput', { required: true }), param('inputDocumentUrlMultiple', 'text')]);
    const params = buildParams(cv, { files: { file: ['https://a/1.pdf', 'https://a/2.pdf'] } });
    expect(params).toEqual({ inputDocumentUrlMultiple: 'https://a/1.pdf,https://a/2.pdf' });
    expect(missingInputs(cv, params)).toEqual([]);
  });

  it('knows what a model accepts', () => {
    expect(acceptsInput(h3, 'image')).toBe(true);
    expect(acceptsInput(h3, 'video')).toBe(false);
    expect(acceptsInput(other, 'text')).toBe(true);
  });
});

describe('price', () => {
  const h3Rows = model([], {
    priceList: [
      { inputs: { resolution: '480P', duration: '5' }, price: 0.125, priceMethod: 'cpr' },
      { inputs: { resolution: '768P', duration: '5' }, price: 0.2, priceMethod: 'cpr' },
    ],
  });
  it('picks the row for the chosen settings', () => {
    expect(quote(h3Rows, { resolution: '768P', duration: '5' }).label).toBe('$0.20');
    expect(quote(h3Rows, { resolution: '480P', duration: '5' }).amount).toBe(0.125);
  });
  it('prices per character', () => {
    const tts = model([], { priceList: [{ inputs: {}, price: 0.00004, priceMethod: 'cp-promptlength' }] });
    expect(quote(tts, {}, { promptChars: 66 }).label).toBe('$0.00264');
  });
  it('prices per output', () => {
    const nb = model([], { priceList: [{ inputs: { resolution: '1K' }, price: 0.067, priceMethod: 'cpo' }] });
    expect(quote(nb, { resolution: '1K', n: '2' }).label).toBe('$0.134');
  });
  it('falls back to the summary', () => {
    expect(quote(model([], { pricing: '$0.01 / per request' }), {}).label).toBe('$0.01');
    expect(quote(model([], { pricing: '~$0.022195 per run (estimated)', estimatedCostUsd: 0.022195 }), {}).label).toBe('about $0.022');
    expect(shortPricing({ slug: 'a', title: 'a', categories: [], pricing: '$0.1 to $0.6 / per request' })).toBe('$0.1 to $0.6 / run');
    expect(priceSortKey({ slug: 'a', title: 'a', categories: [], pricing: '$0.00004 / per prompt character' })).toBe(0.00004);
  });
  it('formats dollars', () => {
    expect(formatUsd(0.2)).toBe('$0.20');
    expect(formatUsd(1.5)).toBe('$1.50');
    expect(formatUsd(0.01)).toBe('$0.01');
  });
});

describe('catalog and menus', () => {
  it('validates the bundled catalog and uses categories only', () => {
    const catalog = validCatalog(DEFAULT_CATALOG);
    expect(catalog?.actions.length).toBe(DEFAULT_CATALOG.actions.length);
    for (const action of DEFAULT_CATALOG.actions) {
      expect(action.categories.length > 0 || action.agent === 'studio').toBe(true);
    }
  });
  it('builds one Wiro parent per kind and parses clicks', async () => {
    const items: MenuItem[] = [];
    await buildMenus({ removeAll: async () => { items.length = 0; }, create: item => { items.push(item); } }, DEFAULT_CATALOG);
    expect(items.filter(item => item.title === 'Wiro').map(item => item.contexts?.[0])).toEqual(['image', 'video', 'audio', 'selection', 'page']);
    const job = jobFromClick({ menuItemId: 'wiro:image:make-video', srcUrl: 'https://cdn.example/a.jpg', pageUrl: 'https://site.example/' });
    expect(job).toMatchObject({ kind: 'image', actionId: 'make-video', url: 'https://cdn.example/a.jpg' });
    expect(jobFromClick({ menuItemId: 'other' })).toBeUndefined();
  });
});
