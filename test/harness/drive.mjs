// Drives the panel harness in headless Chrome against the mock MCP server and
// saves a 2x screenshot per step. Chrome runs with a mock keychain so macOS
// shows no keychain prompt.
//
// node test/harness/drive.mjs <tool-list.json> <outDir> [scheme]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [, , listFile, outDir, scheme = 'light'] = process.argv;
// Chrome's side panel opens at 320px at its narrowest; 362 is a common width.
const WIDTH = Number(process.env.HARNESS_WIDTH ?? 362);
mkdirSync(outDir, { recursive: true });
const here = resolve(import.meta.dirname);
const page = `file://${join(here, 'out', 'index.html')}`;
// The page takes the full viewport width, like the browser's side panel.
writeFileSync(join(here, 'out', 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Wiro panel harness</title><link rel="stylesheet" href="harness.css"></head><body><div id="app"></div><script type="module" src="harness.js"></script></body></html>');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const mockLog = [];
const mock = spawn(process.execPath, [join(here, 'mock-mcp.mjs'), listFile, '8788'], { stdio: ['ignore', 'pipe', 'inherit'] });
mock.stdout.on('data', chunk => mockLog.push(...String(chunk).trim().split('\n')));
await sleep(600);

const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9351;
const profile = mkdtempSync(join(tmpdir(), 'wiro-harness-'));
const chrome = spawn(CH, ['--headless=new', '--use-mock-keychain', '--password-store=basic', '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });

let ws; let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((resolve_, reject) => { const m = ++id; pending.set(m, { resolve: resolve_, reject }); ws.send(JSON.stringify({ id: m, method, params })); });
const evaluate = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
const consoleErrors = [];
const overflows = [];
const checks = [];

// Any box that sticks out past the panel, or past a parent that does not clip it.
const OVERFLOW_CHECK = `(() => {
  const W = document.documentElement.clientWidth;
  const name = el => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
  const found = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const parent = el.parentElement;
    const pr = parent?.getBoundingClientRect();
    const clips = parent && getComputedStyle(parent).overflowX !== 'visible';
    if (r.right > W + 0.5) found.push(name(el) + ' right=' + Math.round(r.right) + ' > panel ' + W + ' :: ' + (el.innerText || '').slice(0, 50));
    else if (pr && !clips && r.right > pr.right + 0.5 && getComputedStyle(el).position !== 'absolute') found.push(name(el) + ' sticks out of ' + name(parent) + ' by ' + Math.round(r.right - pr.right) + 'px :: ' + (el.innerText || '').slice(0, 50));
  }
  return found;
})()`;

async function waitFor(expression, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(`Boolean(${expression})`)) return true;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${expression}`);
}
const hasText = text => `document.body.innerText.includes(${JSON.stringify(text)})`;
const click = async text => {
  const ok = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(e => e.innerText.trim().includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`);
  if (!ok) throw new Error(`no button "${text}"`);
};
async function shot(name) {
  await sleep(500);
  const height = await evaluate('Math.max(document.body.scrollHeight, 640)');
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: Math.min(height + 8, 1400), deviceScaleFactor: 2, mobile: false });
  await sleep(200);
  for (const line of (await evaluate(OVERFLOW_CHECK)) ?? []) overflows.push(`${name}: ${line}`);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(s.data, 'base64'));
  console.log(`saved ${name}`);
}
async function job(value) {
  await evaluate(`wiroJob(${JSON.stringify(value)})`);
}
// Picks a model from the open action's list by its title.
async function pick(title) {
  await click('Change');
  await waitFor(hasText('Choose a model'));
  await sleep(1200);
  const ok = await evaluate(`(() => { const row = [...document.querySelectorAll('button.row')].find(b => b.innerText.includes(${JSON.stringify(title)})); if (!row) return false; row.click(); return true; })()`);
  if (!ok) throw new Error(`no model "${title}"`);
  await waitFor(hasText('Paid from your Wiro wallet'));
  await sleep(1000);
}

const SAMPLES = {
  dog: 'https://cdn.wiro.ai/uploads/sampleinputs/minimax-h3-lite-sampleinput-1.webp',
  bear: 'https://cdn.wiro.ai/uploads/sampleinputs/alibaba-qwen-image-3-sampleinput-2.jpeg',
  road: 'https://cdn.wiro.ai/uploads/sampleinputs/pruna-p-video-edit-sampleinput-1.mp4',
};
const BRIEF = "A photo of a glossy fashion magazine cover. The cover has the large bold words 'FUTURE WEAR' in a modern, metallic sans-serif font that fills the top third of the view.";

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page'); } catch {} if (!target) await sleep(250); }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: `${page}?signedin=1` });
  await waitFor(hasText('Start from the right-click menu'));
  await shot('01-home');

  await job({ kind: 'image', actionId: 'make-video', url: SAMPLES.dog, pageUrl: 'https://studio-notes.example/journal' });
  await waitFor(hasText('Paid from your Wiro wallet'));
  await shot('02-image-make-video');
  if (await evaluate(`(() => { const d = document.querySelector('details.price-options'); if (!d) return false; d.open = true; return true; })()`)) {
    await shot('02b-all-prices');
    await evaluate(`document.querySelector('details.price-options').open = false`);
  }
  await click('Change');
  await waitFor(hasText('Choose a model'));
  await sleep(1500);
  await shot('03-image-video-models');
  await click('Back');
  await waitFor(hasText('Paid from your Wiro wallet'));
  await evaluate(`(() => { const b = [...document.querySelectorAll('button.btn.pri')].pop(); b.click(); return true; })()`);
  await waitFor(hasText('Done'), 20000);
  await shot('04-image-video-done');

  await job({ kind: 'image', actionId: 'edit-image', url: SAMPLES.bear, pageUrl: 'https://studio-notes.example/journal' });
  await waitFor(hasText('Paid from your Wiro wallet'));
  await evaluate(`(() => { const t = document.querySelector('textarea'); t.value = 'Add two small bear cubs on the right bank.'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(300);
  await shot('05-image-edit');
  // A cut-off model name shows in full on hover.
  checks.push('model title tooltip: ' + await evaluate(`(() => { const b = document.querySelector('.mbtn .mt b'); b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return (b.scrollWidth > b.clientWidth ? 'cut, ' : 'fits, ') + 'title=' + JSON.stringify(b.title); })()`));

  await job({ kind: 'selection', actionId: 'generate-image', text: BRIEF, pageUrl: 'https://briefboard.example/briefs/42' });
  await waitFor(hasText('Paid from your Wiro wallet'));
  await shot('06-text-generate-image');

  await job({ kind: 'selection', actionId: 'read-aloud', text: 'Take a deep breath in. Hold it for a moment, and slowly let it go.', pageUrl: 'https://calmdesk.example/' });
  await waitFor(hasText('Paid from your Wiro wallet'));
  await shot('07-text-read-aloud');

  await job({ kind: 'video', actionId: 'edit-video', url: SAMPLES.road, pageUrl: 'https://trail-notes.example/rides' });
  await waitFor(hasText('Paid from your Wiro wallet'));
  await shot('08-video-edit');

  await job({ kind: 'video', actionId: 'video-tools', url: SAMPLES.road, pageUrl: 'https://trail-notes.example/rides' });
  await waitFor(hasText('Paid from your Wiro wallet'));
  await click('Change');
  await waitFor(hasText('Choose a model'));
  await sleep(1500);
  await shot('09-video-tools-list');

  await job({ kind: 'image', actionId: 'remove-background', url: SAMPLES.dog, pageUrl: 'https://studio-notes.example/journal' });
  await waitFor(hasText('No model yet') + ' || ' + hasText('Paid from your Wiro wallet'));
  await shot('10-remove-background-before-category');

  await job({ kind: 'page', actionId: 'page-video', url: 'https://trail-notes.example/rides/ridge-trail', pageUrl: 'https://trail-notes.example/rides/ridge-trail', pageTitle: 'Morning laps on the ridge trail' });
  await waitFor(hasText('Send to Studio'));
  await shot('11-page-studio');
  await click('Send to Studio');
  await waitFor(hasText('Open in Wiro Studio'), 20000);
  await sleep(1000);
  await shot('12-page-studio-done');

  await job({ kind: 'image', actionId: 'more', url: SAMPLES.dog, pageUrl: 'https://studio-notes.example/journal' });
  await waitFor(hasText('Everything Wiro can do'));
  await shot('13-image-more');

  // Price rows with notes: the note is shown instead of the sentence.
  await job({ kind: 'image', actionId: 'generate-3d', url: SAMPLES.bear, pageUrl: 'https://studio-notes.example/journal' });
  await waitFor(hasText('Paid from your Wiro wallet'));
  await pick('Pixal3D');
  await shot('14-3d-row-note');

  await job({ kind: 'selection', actionId: 'read-aloud', text: 'Take a deep breath in. Hold it for a moment, and slowly let it go.', pageUrl: 'https://calmdesk.example/' });
  await waitFor(hasText('Paid from your Wiro wallet'));
  await pick('MiMo 2.5 TTS');
  await shot('15-tts-free');

  await job({ kind: 'image', actionId: 'make-video', url: SAMPLES.dog, pageUrl: 'https://studio-notes.example/journal' });
  await waitFor(hasText('Paid from your Wiro wallet'));
  await pick('Sulphur 2 Base');
  await shot('16-video-per-second');
} catch (error) {
  console.error('DRIVE ERROR', error.message);
  try { await shot('zz-error'); } catch {}
} finally {
  writeFileSync(join(outDir, 'mock-log.txt'), mockLog.join('\n'));
  writeFileSync(join(outDir, 'console-errors.txt'), consoleErrors.join('\n'));
  writeFileSync(join(outDir, 'overflow.txt'), overflows.join('\n'));
  writeFileSync(join(outDir, 'checks.txt'), checks.join('\n'));
  try { ws?.close(); } catch {}
  chrome.kill('SIGTERM'); mock.kill('SIGTERM');
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(0); }, 800);
}
