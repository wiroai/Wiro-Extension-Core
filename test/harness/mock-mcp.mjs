// A local stand-in for mcp.wiro.ai/v1 for UI tests. It serves Wiro's real public
// catalog (a Tool/List dump: categories, parameters, price rows) in the shape of
// the Wiro MCP tools, answers over SSE like the real server, and finishes runs
// with each model's own sample output. It logs every run_model call so a test
// can check how the gateway mapped the inputs.
//
// node test/harness/mock-mcp.mjs <tool-list.json> [port]
import http from 'node:http';
import fs from 'node:fs';

const [, , listFile, portArg] = process.argv;
const port = Number(portArg) || 8788;
const models = JSON.parse(fs.readFileSync(listFile, 'utf8')).tool;
const slugOf = m => `${m.cleanslugowner}/${m.cleanslugproject}`;
const bySlug = new Map(models.map(m => [slugOf(m), m]));
const FILE_TYPES = new Set(['fileinput', 'combinefileinput', 'multifileinput']);

function rows(m) {
  let dp = m.dynamicprice;
  if (typeof dp === 'string') { try { dp = JSON.parse(dp); } catch { dp = null; } }
  return Array.isArray(dp) ? dp : [];
}

// The same lines Wiro-MCP's formatPricing writes (src/utils/format.ts), for the
// methods the catalog uses.
const UNIT = { cpr: 'per request', cpo: 'per output', 'cp-promptlength': 'per prompt character', 'cp-outputVideoLength': 'per video second', 'cp-audiosecondslength': 'per second of audio in inputAudio', cpt: 'per input and output token' };
const usd = n => String(parseFloat(Number(n).toFixed(6)));
const oneLine = text => String(text || '').replace(/\s+/g, ' ').trim();

function pricing(m) {
  const list = rows(m);
  if (list.length) {
    if (list.some(r => r.priceMethod === 'cp-realtimeturn')) {
      const note = list.map(r => oneLine(r.note)).find(Boolean);
      return note ? `Billed turn by turn during the live session. Rates: ${note}` : 'Billed turn by turn during the live session. No fixed price per run.';
    }
    const parts = [];
    const unit = list.filter(r => UNIT[r.priceMethod]);
    if (unit.length) {
      const prices = unit.map(r => Number(r.price));
      const lo = Math.min(...prices); const hi = Math.max(...prices);
      parts.push(`${lo === hi ? `$${usd(lo)}` : `$${usd(lo)} to $${usd(hi)}`} / ${UNIT[unit[0].priceMethod]}`);
    }
    const pixel = list.filter(r => r.priceMethod === 'cp-pixel');
    if (pixel.length) parts.push(`$${usd(Math.min(...pixel.map(r => Number(r.price))))} per run for an output image up to 1024 x 1024 pixels`);
    for (const r of list.filter(row => row.priceMethod === 'cp-readoutput')) {
      const head = Number(r.price) > 0 ? `Set by the run when it ends (listed estimate $${usd(r.price)})` : 'Set by the run when it ends';
      parts.push(oneLine(r.note) ? `${head}: ${oneLine(r.note)}` : `${head}. The finished task shows the cost.`);
    }
    if (parts.length) return [...new Set(parts)].join('; ');
    return 'No fixed price: the charge follows the time the run takes and is set when it ends';
  }
  const ac = Number(m.approximatelycost);
  if (ac > 0) return `~$${usd(ac)} per run (estimated)`;
  const rate = Number(m.cps) > 0 ? Number(m.cps) : Number(m.quegroupcps);
  if (rate > 0) return `$${usd(rate)} per second of run time`;
  return 'per second of run time; `get_model_schema` gives the rate';
}

// MOCK_DISCOUNT="klingai/kling-v3:50" gives the caller an offer on a model.
const DISCOUNTS = new Map(String(process.env.MOCK_DISCOUNT || '').split(',').filter(Boolean).map(pair => { const [slug, pct] = pair.split(':'); return [slug, Number(pct)]; }));

function summary(m) {
  const ac = Number(m.approximatelycost);
  const list = rows(m);
  const metered = list.length && list.every(r => r.priceMethod === 'cp-readoutput') ? (Number(list[0].price) || null) : null;
  return {
    slug: slugOf(m), title: m.title, description: m.seodescription || m.description, categories: m.categories || [], pricing: pricing(m),
    estimatedCostUsd: list.length ? metered : (ac || null),
    ...(DISCOUNTS.has(slugOf(m)) ? { discountPercent: DISCOUNTS.get(slugOf(m)) } : {}),
  };
}

const num = v => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? undefined : Number(v));

function detail(m) {
  return {
    ...summary(m),
    parameters: (m.parameters || []).map(group => ({
      title: group.title || '',
      items: (group.items || []).map(i => {
        const type = String(i.type || 'text');
        const isFile = FILE_TYPES.has(type.toLowerCase());
        const isPrompt = /^(prompt|text)$/i.test(i.id);
        const def = !isFile && !isPrompt && i.defaultvalue !== undefined && i.defaultvalue !== '' ? String(i.defaultvalue) : undefined;
        return {
          id: i.id, type, label: i.label || i.id, required: Boolean(i.required), advanced: Boolean(i.advanced),
          default: def, placeholder: i.placeholder || undefined, note: i.note || undefined,
          options: (i.options || []).map(o => ({ label: String(o.text ?? o.label ?? o.value), value: String(o.value) })),
          min: num(i.minvalue), max: num(i.maxvalue), step: num(i.incrementby),
        };
      }),
    })),
    pricingNotes: [...new Set(rows(m).map(r => oneLine(r.note)).filter(Boolean))],
    // Price rows; MOCK_NO_PRICELIST=1 serves a model without them.
    ...(process.env.MOCK_NO_PRICELIST === '1' ? {} : { priceList: rows(m) }),
  };
}

function kindOf(url) {
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return ['video', 'video/mp4'];
  if (/\.(mp3|wav|m4a|ogg)(\?|$)/i.test(url)) return ['audio', 'audio/mpeg'];
  if (/\.(png)(\?|$)/i.test(url)) return ['image', 'image/png'];
  if (/\.(jpe?g|webp|gif)(\?|$)/i.test(url)) return ['image', 'image/webp'];
  return ['file', 'application/octet-stream'];
}

const runs = new Map();
let taskId = 1000;

function tool(name, args) {
  switch (name) {
    case 'search_models': {
      const cats = args.categories || [];
      let list = models.filter(m => !cats.length || cats.some(c => (m.categories || []).includes(c)));
      if (args.search) list = list.filter(m => `${m.title} ${slugOf(m)} ${m.description}`.toLowerCase().includes(String(args.search).toLowerCase()));
      if (args.sort === 'ratedusercount') list = [...list].sort((a, b) => Number(b.ratedusercount || 0) - Number(a.ratedusercount || 0));
      const start = args.start || 0; const limit = args.limit || 20;
      const page = list.slice(start, start + limit).map(summary);
      return { models: page, total: list.length, start, limit, nextStart: start + limit < list.length ? start + limit : null };
    }
    case 'get_model_schema': {
      const m = bySlug.get(args.model);
      if (!m) return { error: `Model "${args.model}" not found.` };
      return { model: detail(m) };
    }
    case 'get_account':
      return { workspace: { kind: 'personal' }, balance: { currency: 'USD', totalUsd: 12.4, depositUsd: 12.4, couponCreditUsd: 0, storeRevenueUsd: 0 }, authMode: 'apikey-only' };
    case 'run_model': {
      const m = bySlug.get(args.model);
      const id = String(++taskId); const token = `tok-${id}`;
      console.log(JSON.stringify({ run_model: args.model, params: args.params }));
      runs.set(token, { id, model: args.model, m });
      return { state: 'running', task: { id, token, model: args.model, status: 'task_running' }, outputs: [], nextAction: { tool: 'wait_for_task', arguments: { tasktoken: token }, reason: 'still running' } };
    }
    case 'wait_for_task': case 'get_task': {
      const run = runs.get(args.tasktoken);
      if (!run) return { error: 'Task not found.' };
      const samples = (run.m && run.m.samples) || [];
      const outputs = samples.slice(0, 1).map(url => { const [kind, mimeType] = kindOf(url); return { url, kind, mimeType, sizeBytes: null, name: url.split('/').pop() }; });
      const list = rows(run.m || {});
      const cost = list.length ? Number(list[0].price) : Number((run.m || {}).approximatelycost) || 0;
      return { state: 'completed', task: { id: run.id, token: args.tasktoken, model: run.model, status: 'task_postprocess_end', durationSeconds: 12, costUsd: cost, chargedUsd: cost }, outputs };
    }
    case 'cancel_task': return { ok: true };
    case 'list_tasks': return { tasks: [], total: 0, start: 0, limit: 20, nextStart: null };
    case 'send_agent_message':
      console.log(JSON.stringify({ studio: args.message }));
      return { agent: 'studio', agentKind: 'studio', session: 's-1', done: false, message: { messageId: 'm-1', state: 'running', status: 'running', reply: '', mediaUrls: [], toolsUsed: [], attachments: [] }, modelRuns: [{ id: 'r1', model: 'minimax/h3-lite', modelTitle: 'MiniMax H3 Lite', status: 'running', state: 'running', outputs: [] }], modelRunsPending: true, notes: [] };
    case 'get_agent_message':
      return { agent: 'studio', agentKind: 'studio', session: 's-1', done: true, message: { messageId: 'm-1', state: 'done', status: 'done', reply: 'Here is a 45 second vertical video of the page, with captions and calm music.', mediaUrls: [], toolsUsed: [], attachments: [] },
        modelRuns: [{ id: 'r1', model: 'minimax/h3-lite', modelTitle: 'MiniMax H3 Lite', status: 'done', state: 'completed', outputs: [{ url: 'https://cdn.wiro.ai/uploads/models/minimax-h3-lite-sample-1.mp4', mimeType: 'video/mp4' }] },
          { id: 'r2', model: 'wiro/video-caption', modelTitle: 'Video Caption', status: 'done', state: 'completed', outputs: [] }], modelRunsPending: false, notes: [] };
    default:
      return { error: `Unknown tool ${name}` };
  }
}

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, MCP-Protocol-Version');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(404); res.end(); return; }
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const message = JSON.parse(body);
    if (!String(req.headers.authorization || '').startsWith('Bearer wiro_at_')) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return; }
    const out = tool(message.params.name, message.params.arguments || {});
    const result = out.error
      ? { content: [{ type: 'text', text: `## Error\n\n${out.error}` }], isError: true }
      : { content: [{ type: 'text', text: 'ok' }], structuredContent: out };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    setTimeout(() => res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`), message.params.name === 'wait_for_task' ? 1500 : 60);
  });
}).listen(port, '127.0.0.1', () => console.log(`mock MCP on http://127.0.0.1:${port}/v1 with ${models.length} models`));
