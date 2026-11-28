import { describe, expect, it } from 'vitest';
import { PRICE_LIST_META, WiroApi } from '../src/wiro/api.js';
import { McpClient } from '../src/mcp/client.js';
import { withDefaults } from '../src/gateway/gateway.js';
import { quote } from '../src/pricing/price.js';
import type { ModelDetail, ModelParameter, PriceRow } from '../src/types.js';

// Wiro's own rows for two live models (Tool/Detail dynamicprice, 2026-11-28).
const VEO_ROWS: PriceRow[] = [
  { inputs: { durationSeconds: '4', resolution: '720p' }, price: 1.6, priceMethod: 'per-run' },
  { inputs: { durationSeconds: '6', resolution: '720p' }, price: 2.4, priceMethod: 'per-run' },
  { inputs: { durationSeconds: '8', resolution: '720p' }, price: 3.2, priceMethod: 'per-run' },
  { inputs: { durationSeconds: '4', resolution: '1080p' }, price: 1.6, priceMethod: 'per-run' },
  { inputs: { durationSeconds: '6', resolution: '1080p' }, price: 2.4, priceMethod: 'per-run' },
  { inputs: { durationSeconds: '8', resolution: '1080p' }, price: 3.2, priceMethod: 'per-run' },
  { inputs: { durationSeconds: '4', resolution: '4k' }, price: 2.4, priceMethod: 'per-run' },
  { inputs: { durationSeconds: '6', resolution: '4k' }, price: 3.6, priceMethod: 'per-run' },
  { inputs: { durationSeconds: '8', resolution: '4k' }, price: 4.8, priceMethod: 'per-run' },
];
const VSR_ROWS: PriceRow[] = [
  { inputs: { resolution: '720p' }, price: 0.015, priceMethod: 'per-input-video-second', maxSeconds: 60 },
  { inputs: { resolution: '1080p' }, price: 0.025, priceMethod: 'per-input-video-second', maxSeconds: 60 },
  { inputs: { resolution: '2160p' }, price: 0.1, priceMethod: 'per-input-video-second', maxSeconds: 20 },
];

function select(id: string, values: string[], extra: Partial<ModelParameter> = {}): ModelParameter {
  return { id, type: 'select', label: id, required: false, options: values.map(value => ({ label: value, value })), advanced: false, ...extra };
}

// get_model_schema's model, as Wiro-MCP writes it: a required select gets a sample, not a default.
const veo: ModelDetail = {
  slug: 'google/veo3-1', title: 'Veo 3.1', categories: [], pricing: '$1.6 to $4.8 / per run',
  parameters: [{ title: '', items: [select('resolution', ['720p', '1080p', '4k'], { default: '720p' }), select('durationSeconds', ['4', '6', '8'], { required: true, sample: '4' })] }],
};
const vsr: ModelDetail = {
  slug: 'kandinskylab/kandinsky-6-0-vsr-2-0', title: 'Kandinsky 6.0 VSR 2.0', categories: [],
  pricing: '$0.015 to $0.1 / per second of input video. Every video input counts for its length: `inputVideo`, `inputVideoUrl` and each file of `inputVideoMultiple` and `inputVideoUrlMultiple`. Each input counts at most 20 or 60 seconds, depending on the settings.',
  parameters: [{ title: '', items: [select('resolution', ['720p', '1080p', '2160p'], { required: true, sample: '1080p' })] }],
};

function fakeMcp(result: { structured?: unknown; meta?: Record<string, unknown>; isError?: boolean; text?: string }, calls: unknown[][] = []): McpClient {
  return {
    callTool: async (...args: unknown[]) => {
      calls.push(args);
      return { text: result.text ?? 'ok', isError: result.isError ?? false, structured: result.structured, meta: result.meta };
    },
  } as unknown as McpClient;
}

describe('price rows from get_model_schema', () => {
  it('asks for the rows and reads them from the result _meta', async () => {
    const calls: unknown[][] = [];
    const withRows = await new WiroApi(fakeMcp({ structured: { model: veo }, meta: { [PRICE_LIST_META]: VEO_ROWS } }, calls)).getModel('google/veo3-1');
    expect(withRows.priceList).toEqual(VEO_ROWS);
    // Wiro-MCP sends the rows only to a call that asks with `true` under the key in its _meta.
    expect(calls).toEqual([['get_model_schema', { model: 'google/veo3-1' }, undefined, { 'ai.wiro/priceList': true }]]);
    const without = await new WiroApi(fakeMcp({ structured: { model: veo } })).getModel('google/veo3-1');
    expect(without.priceList).toBeUndefined();
    await expect(new WiroApi(fakeMcp({ isError: true, text: '## Error\n\nModel "a/b" not found.' })).getModel('a/b')).rejects.toThrow('Model "a/b" not found.');
  });

  it('puts the ask in the tools/call params as _meta, and adds no _meta without one', async () => {
    const sent: Array<{ params: Record<string, unknown> }> = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const message = JSON.parse(String(init?.body)) as { id: number; params: Record<string, unknown> };
      sent.push(message);
      const result = { content: [{ type: 'text', text: 'ok' }], structuredContent: { model: veo }, _meta: { [PRICE_LIST_META]: VEO_ROWS } };
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`,
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch;
    const client = new McpClient('https://mcp.example.test/v1', { accessToken: async () => 'wiro_at_x', recoverFromUnauthorized: async () => false }, fetchImpl);
    const model = await new WiroApi(client).getModel('google/veo3-1');
    expect(model.priceList).toEqual(VEO_ROWS);
    expect(sent[0]?.params).toEqual({ name: 'get_model_schema', arguments: { model: 'google/veo3-1' }, _meta: { 'ai.wiro/priceList': true } });
    await client.callTool('search_models', { limit: 1 });
    expect(sent[1]?.params).toEqual({ name: 'search_models', arguments: { limit: 1 } });
    expect('_meta' in (sent[1]?.params ?? {})).toBe(false);
  });

  it('prices the chosen settings, and shows the range until a required one is chosen', () => {
    const model = { ...veo, priceList: VEO_ROWS };
    const before = quote(model, withDefaults(model, {}));
    expect([before.label, before.note]).toEqual(['from $1.60', 'From $1.60 to $4.80 per run, depending on the settings.']);
    expect(before.options?.length).toBe(9);
    expect(quote(model, withDefaults(model, { durationSeconds: '4' })).label).toBe('$1.60');
    expect(quote(model, withDefaults(model, { resolution: '4k', durationSeconds: '8' })).label).toBe('$4.80');
    expect(quote(model, withDefaults(model, { resolution: '1080p', durationSeconds: '8' })).label).toBe('$3.20');
  });

  it('prices input video by the clicked file, each input at most the row maxSeconds', () => {
    const model = { ...vsr, priceList: VSR_ROWS };
    const unchosen = quote(model, withDefaults(model, {}), { mediaSeconds: 12 });
    expect([unchosen.label, unchosen.note]).toEqual(['from $0.18', 'From $0.18 to $1.20 for this 12-second video, depending on the settings.']);
    const hd = quote(model, { resolution: '1080p' }, { mediaSeconds: 12 });
    expect([hd.label, hd.note]).toEqual(['about $0.30', 'Your request will cost $0.30 for 12 seconds of input video.']);
    const long = quote(model, { resolution: '1080p' }, { mediaSeconds: 75 });
    expect([long.label, long.note]).toEqual(['about $1.50', 'Your request will cost $1.50 for 60 seconds of input video. Only the first 60 seconds of each input are processed and billed.']);
    expect(quote(model, { resolution: '2160p' }, { mediaSeconds: 75 }).label).toBe('about $2.00');
  });
});
