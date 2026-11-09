import { describe, expect, it } from 'vitest';
import { challengeFor, randomString } from '../src/auth/pkce.js';
import { parseSse, sseJsonMessages } from '../src/util/sse.js';
import { buildParams, fitValue, missingInputs, slotsFor, acceptsInput, inputFit, withDefaults } from '../src/gateway/gateway.js';
import { quote, shortPricing, priceSortKey, formatUsd } from '../src/pricing/price.js';
import { validCatalog } from '../src/catalog/catalog.js';
import { DEFAULT_CATALOG } from '../src/catalog/default-catalog.js';
import { buildMenus, jobFromClick, type MenuItem } from '../src/background/menus.js';
import type { ModelDetail, ModelParameter } from '../src/types.js';
import { OAuth } from '../src/auth/oauth.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { KeyValueStore, Platform } from '../src/platform.js';

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

function memoryStore(): KeyValueStore {
  const data = new Map<string, unknown>();
  const listeners = new Set<(changes: Record<string, unknown>) => void>();
  const tell = (changes: Record<string, unknown>) => listeners.forEach(listener => listener(changes));
  return {
    get: async <T>(key: string) => data.get(key) as T | undefined,
    set: async (key, value) => { data.set(key, value); tell({ [key]: value }); },
    remove: async key => { data.delete(key); tell({ [key]: undefined }); },
    onChanged: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

describe('oauth', () => {
  it('finishes a sign-in in another page, once', async () => {
    let opened = '';
    const platform: Platform = {
      name: 'safari', version: '0.1.0', storage: memoryStore(), session: memoryStore(), clientName: 'Wiro for Safari',
      redirectUri: () => 'https://wiro.ai/extension/callback',
      launchAuth: async url => { opened = url; return undefined; },
      openTab: () => {},
    };
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/register')) return new Response(JSON.stringify({ client_id: 'c1' }), { status: 201 });
      if (String(url).endsWith('/token')) {
        const form = new URLSearchParams(String(init?.body));
        if (form.get('code') !== 'abc' || !form.get('code_verifier')) return new Response('{"error":"invalid_grant"}', { status: 400 });
        return new Response(JSON.stringify({ access_token: 'wiro_at_x', refresh_token: 'wiro_rt_y', expires_in: 3600 }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const panel = new OAuth(platform, DEFAULT_CONFIG, fetchImpl);
    const seen: boolean[] = [];
    panel.onSignInChanged(value => seen.push(value));
    expect(await panel.signIn()).toBe('pending');

    // The background has its own OAuth object; only storage is shared.
    const background = new OAuth(platform, DEFAULT_CONFIG, fetchImpl);
    const state = new URL(opened).searchParams.get('state') ?? '';
    await expect(background.completeSignIn('https://wiro.ai/extension/callback?code=abc&state=wrong')).rejects.toThrow('did not match');
    const callback = `https://wiro.ai/extension/callback?code=abc&state=${state}&iss=${encodeURIComponent(DEFAULT_CONFIG.issuer)}`;
    await background.completeSignIn(callback);
    expect(await panel.isSignedIn()).toBe(true);
    expect(seen).toEqual([true]);
    await expect(background.completeSignIn(callback)).rejects.toThrow('expired');
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

  it('sends a clicked image to a document field', () => {
    // dots.ocr takes images through a document list.
    const ocr = model([param('inputDocumentMultiple', 'multifileinput', { required: true }), param('inputDocumentUrlMultiple', 'text')]);
    expect(acceptsInput(ocr, 'image')).toBe(true);
    expect(inputFit(ocr, 'image')).toBe('full');
    expect(buildParams(ocr, { files: { image: ['https://a/scan.png'] } })).toEqual({ inputDocumentUrlMultiple: 'https://a/scan.png' });
  });

  it('knows what a model accepts', () => {
    expect(acceptsInput(h3, 'image')).toBe(true);
    expect(acceptsInput(h3, 'video')).toBe(false);
    expect(acceptsInput(other, 'text')).toBe(true);
  });

  it('tells a full fit from one that needs another file', () => {
    // A reference-to-video model: takes images, but a reference video is required too.
    const r2v = model([param('inputImageReference', 'combinefileinput'), param('inputVideo', 'combinefileinput', { required: true, label: 'reference_videos' })]);
    expect(inputFit(h3, 'image')).toBe('full');
    expect(inputFit(r2v, 'image')).toBe('partial');
    expect(inputFit(r2v, 'audio')).toBe('none');
  });

  it('fills defaults for pricing', () => {
    const kling = model([param('mode', 'select', { default: 'std', options: [{ label: 'std', value: 'std' }] }), param('duration', 'select', { default: '5', options: [] })],
      { priceList: [{ inputs: { mode: 'std', duration: '5' }, price: 0.42, priceMethod: 'cpr' }, { inputs: { mode: 'pro', duration: '5' }, price: 0.56, priceMethod: 'cpr' }] });
    expect(quote(kling, withDefaults(kling, {})).label).toBe('$0.42');
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
    expect(shortPricing({ slug: 'a', title: 'a', categories: [], pricing: '$0.1 to $0.6 / per request' })).toBe('from $0.10 / run');
    expect(priceSortKey({ slug: 'a', title: 'a', categories: [], pricing: 'Set by the run when it ends: $0.0021 per 1000 tokens' })).toBe(Number.POSITIVE_INFINITY);
    expect(priceSortKey({ slug: 'a', title: 'a', categories: [], pricing: '$0.00004 / per prompt character' })).toBe(0.00004);
  });
  it('formats dollars', () => {
    expect(formatUsd(0.2)).toBe('$0.20');
    expect(formatUsd(1.5)).toBe('$1.50');
    expect(formatUsd(0.01)).toBe('$0.01');
  });
  it('picks the row Wiro bills: the valid row with the highest file count', () => {
    const edit = model([], { priceList: [
      { inputs: { inputImage: 'QUANTITY:0' }, price: 0.03, priceMethod: 'cpr' },
      { inputs: { inputImage: 'QUANTITY:1' }, price: 0.04, priceMethod: 'cpr' },
      { inputs: { inputImage: 'QUANTITY:3' }, price: 0.05, priceMethod: 'cpr' },
    ] });
    expect(quote(edit, {}).amount).toBe(0.03);
    expect(quote(edit, { inputImage: ['a', 'b'] }).amount).toBe(0.04);
    expect(quote(edit, { inputImage: ['a', 'b', 'c', 'd'] }).amount).toBe(0.05);
    expect(quote(edit, { inputImage: ['a'] }).options?.map(option => [option.conditions[0], option.current])).toEqual([
      ['Input Image: No', false], ['Input Image: 1', true], ['Input Image: 3 or more', false],
    ]);
  });
  it('takes the first row whose values all match, like Wiro', () => {
    const rows = model([], { priceList: [
      { inputs: { quality: 'high' }, price: 0.78, priceMethod: 'cpr' },
      { inputs: {}, price: 0.52, priceMethod: 'cpr' },
    ] });
    expect(quote(rows, { quality: 'high' }).amount).toBe(0.78);
    expect(quote(rows, { quality: 'standard' }).amount).toBe(0.52);
  });
  it('shows a row note instead of the sentence', () => {
    const sulphur = model([], { priceList: [{ inputs: { resolution: '1080P' }, price: 0.06, priceMethod: 'cp-outputVideoLength', note: 'Per second $0.06 for 1080P' }] });
    const result = quote(sulphur, { resolution: '1080P', duration: '5' });
    expect([result.label, result.note]).toEqual(['$0.30', 'Per second $0.06 for 1080P']);
    const free = model([], { priceList: [{ inputs: {}, price: 0, priceMethod: 'cpr', note: 'Free for now.' }] });
    expect([quote(free, {}).label, quote(free, {}).note]).toEqual(['Free', 'Free for now.']);
  });
  it('bills by run time when no row matches', () => {
    const rows = model([], { estimatedCostUsd: 0.05, priceList: [{ inputs: { resolution: '1K' }, price: 0.1, priceMethod: 'cpr' }] });
    expect(quote(rows, { resolution: '4K' }).label).toBe('about $0.05');
  });
  it('shows the offer price beside the list price', () => {
    const offer = model([], { discountPercent: 50, priceList: [{ inputs: {}, price: 0.52, priceMethod: 'cpr' }] });
    const result = quote(offer, {});
    expect([result.listLabel, result.label, result.amount, result.note]).toEqual(['$0.52', '$0.26', 0.26, 'Running this model on Wiro costs $0.26 in total.']);
    // Without rows the summary's amounts are scaled the same way.
    const summary = quote(model([], { discountPercent: 50, pricing: '$0.42 to $6.3 / per request' }), {});
    expect([summary.listLabel, summary.label, summary.note]).toEqual(['from $0.42', 'from $0.21', 'From $0.21 to $3.15 per run, depending on the settings.']);
  });
  it('reads the summary when there are no rows', () => {
    expect(quote(model([], { pricing: '$0.00004 / per prompt character. Every character of the `prompt` value counts.' }), {}, { promptChars: 66 }).label).toBe('$0.00264');
    expect(quote(model([], { pricing: '$0.0012 per second of run time', estimatedCostUsd: 0.03 }), {}).label).toBe('about $0.03');
    expect(quote(model([], { pricing: 'Set by the run when it ends (listed estimate $0.02): $1 per 1M input tokens' }), {}).note).toBe('$1 per 1M input tokens');
    const video = quote(model([], { pricing: '$0.06 / per video second', pricingNotes: ['Per second $0.06 for 1080P'] }), { duration: 10 });
    expect([video.label, video.note]).toEqual(['$0.60', 'Per second $0.06 for 1080P']);
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
    // A selected text item and a media item can show together, so their titles differ.
    expect(items.filter(item => !item.parentId).map(item => [item.contexts?.[0], item.title])).toEqual([
      ['image', 'Wiro'],
      ['video', 'Wiro'],
      ['audio', 'Wiro'],
      ['selection', 'Wiro: selected text'],
      ['page', 'Wiro'],
    ]);
    const job = jobFromClick({ menuItemId: 'wiro:image:make-video', srcUrl: 'https://cdn.example/a.jpg', pageUrl: 'https://site.example/' });
    expect(job).toMatchObject({ kind: 'image', actionId: 'make-video', url: 'https://cdn.example/a.jpg' });
    expect(jobFromClick({ menuItemId: 'other' })).toBeUndefined();
  });
});
