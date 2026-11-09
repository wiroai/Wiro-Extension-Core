import { useEffect, useState } from 'preact/hooks';
import type { Services } from '../services.js';
import { readHistory, readTray, removeFromTray } from '../services.js';
import type { Catalog, CatalogAction } from '../../catalog/catalog.js';
import { actionsFor } from '../../catalog/catalog.js';
import type { AgentTurn, ContentKind, HistoryEntry, Job, TaskOutput, TrayItem } from '../../types.js';
import { Icon, InputCard, Outputs, fileNameOf, hostOf, saveFile } from '../components/common.js';

export function SignInView(props: { services: Services; onSignedIn: () => void }) {
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string>();
  const inTab = props.services.platform.name === 'safari';
  async function signIn() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await props.services.oauth.signIn();
      if (result === 'done') props.onSignedIn();
      else setWaiting(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div class="signin wp" style="min-height:auto">
      <img src="icons/icon-128.png" alt="" />
      <h3>Sign in to Wiro</h3>
      <p>Run Wiro AI models on images, videos, audio and text from any page. You see the price before each run, and runs are paid from your Wiro wallet.</p>
      <button class="btn pri wide" disabled={busy} onClick={signIn}>{busy ? 'Waiting for wiro.ai…' : waiting ? 'Open the sign-in again' : 'Sign in with Wiro'}</button>
      {waiting && <div class="box" style="width:100%">Finish signing in on the wiro.ai tab. The Wiro panel signs in by itself when you are done.</div>}
      {error && <div class="box err" style="width:100%">{error}</div>}
      <p class="fine">Opens wiro.ai in {inTab ? 'a new tab' : 'a small window'}. New to Wiro? You can create an account there. No API key needed.</p>
    </div>
  );
}

const KIND_HINTS: Record<ContentKind, string> = {
  image: 'Right-click an image',
  video: 'Right-click a video with a direct file link',
  audio: 'Right-click an audio player',
  selection: 'Select text and right-click it',
  page: 'Right-click an empty spot on a page',
};

export function HomeView(props: { catalog?: Catalog; onHistory: () => void; onTray: () => void; onMore: (kind: ContentKind) => void }) {
  return (
    <>
      <div class="title">Wiro</div>
      <div class="card home-tip">
        <div style="font-weight:550">Start from the right-click menu</div>
        <ul>
          {(Object.keys(KIND_HINTS) as ContentKind[]).map(kind => (
            <li>{KIND_HINTS[kind]}, then <b>Wiro ▸</b>
              {props.catalog ? <span class="sub"> ({actionsFor(props.catalog, kind).length} actions)</span> : null}</li>
          ))}
        </ul>
      </div>
      <div class="btnrow">
        <button class="btn sm" onClick={props.onHistory}>History</button>
        <button class="btn sm" onClick={props.onTray}>Tray</button>
      </div>
      <p class="fine">Models come live from Wiro's categories, so new ones appear here without an update.</p>
    </>
  );
}

export function MoreView(props: { catalog: Catalog; job: Job; onPick: (action: CatalogAction) => void; onBack: () => void }) {
  const kind = props.job.kind;
  const actions = actionsFor(props.catalog, kind);
  const extra = (props.catalog.more[kind] ?? []).filter(entry => !actions.some(action => action.categories.length === 1 && action.categories[0] === entry.category));
  return (
    <>
      <button class="back" onClick={props.onBack}>← Home</button>
      <div class="title">Everything Wiro can do with this</div>
      <InputCard job={props.job} />
      <div class="list">
        {actions.map(action => (
          <button class="row" onClick={() => props.onPick(action)}>
            <span class="mi">{action.label.charAt(0)}</span>
            <span style="min-width:0"><div class="n">{action.label.replace(/…$/, '')}</div><div class="o">{action.agent === 'studio' ? 'Wiro Studio' : action.categories.join(', ')}</div></span>
            <span class="pr">›</span>
          </button>
        ))}
        {extra.map(entry => (
          <button class="row" onClick={() => props.onPick({ id: `category:${entry.category}`, kind, label: entry.label, categories: [entry.category], prompt: 'optional' })}>
            <span class="mi">{entry.label.charAt(0)}</span>
            <span style="min-width:0"><div class="n">{entry.label}</div><div class="o">{entry.category}</div></span>
            <span class="pr">›</span>
          </button>
        ))}
      </div>
      <p class="fine">Found from Wiro categories. New categories and models show up here on their own.</p>
    </>
  );
}

export function TrayView(props: { services: Services; onUse: (job: Job) => void; onBack: () => void }) {
  const { platform } = props.services;
  const [items, setItems] = useState<TrayItem[]>([]);
  const load = () => void readTray(platform).then(setItems);
  useEffect(load, []);
  return (
    <>
      <button class="back" onClick={props.onBack}>← Home</button>
      <div class="top"><div class="title">Tray</div><span class="sub" style="margin-left:auto">{items.length} items</span></div>
      {items.length === 0 && <div class="empty">Right-click an image, video, audio clip or text and choose Wiro ▸ Add to tray. Models that take two inputs, like merging clips or a video from two images, pick them from here.</div>}
      <div class="tray">
        {items.map(item => (
          <div class="it" title={item.title}>
            {item.kind === 'image' && item.url ? <img src={item.url} alt="" /> : <div class="ph">{item.kind === 'text' ? 'TXT' : item.kind.toUpperCase()}</div>}
            <span class="tag">{item.kind}</span>
            <button class="x" aria-label="Remove" onClick={async () => { await removeFromTray(platform, item.id); load(); }}>×</button>
          </div>
        ))}
      </div>
      <div class="list">
        {items.map(item => (
          <button class="row" onClick={() => props.onUse({
            id: item.id,
            kind: item.kind === 'text' ? 'selection' : item.kind === 'file' ? 'image' : item.kind,
            url: item.url,
            text: item.text,
            pageUrl: item.from,
            createdAt: Date.now(),
          })}>
            <span class="mi">{item.kind.slice(0, 2)}</span>
            <span style="min-width:0"><div class="n">{item.title}</div><div class="o">{item.from ? hostOf(item.from) || item.from : ''}</div></span>
            <span class="pr">Use ›</span>
          </button>
        ))}
      </div>
    </>
  );
}

export function HistoryView(props: { services: Services; onBack: () => void }) {
  const { platform, config } = props.services;
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [open, setOpen] = useState<HistoryEntry>();
  useEffect(() => void readHistory(platform).then(setEntries), []);
  if (open) {
    const first = open.outputs.find(output => output.url);
    return (
      <>
        <button class="back" onClick={() => setOpen(undefined)}>← History</button>
        <div class="title">{open.actionLabel ?? open.modelTitle}</div>
        <Outputs outputs={open.outputs} />
        <div class="meta"><span>{open.modelTitle}</span><span>{new Date(open.at).toLocaleString()}</span></div>
        {first?.url && <button class="btn pri sm" onClick={() => saveFile(first.url as string, first.name)}><Icon.download />Download</button>}
      </>
    );
  }
  return (
    <>
      <button class="back" onClick={props.onBack}>← Home</button>
      <div class="title">History</div>
      {entries.length === 0 && <div class="empty">Runs you start here show up in this list.</div>}
      <div class="list">
        {entries.map(entry => {
          const thumb = entry.outputs.find(output => output.kind === 'image' && output.url);
          return (
            <button class="row" onClick={() => setOpen(entry)}>
              {thumb?.url ? <img src={thumb.url} alt="" style="width:28px;height:28px;border-radius:6px;object-fit:cover" /> : <span class="mi">{(entry.modelTitle ?? '?').charAt(0)}</span>}
              <span style="min-width:0"><div class="n">{entry.actionLabel ?? entry.modelTitle}</div><div class="o">{entry.modelTitle} · {new Date(entry.at).toLocaleDateString()}</div></span>
              <span class="pr">{typeof entry.chargedUsd === 'number' ? `$${entry.chargedUsd.toFixed(entry.chargedUsd < 0.01 ? 4 : 2)}` : ''}</span>
            </button>
          );
        })}
      </div>
      <button class="btn sm" onClick={() => platform.openTab(`${config.site}/panel/task-history`)}>All runs on wiro.ai <Icon.external /></button>
    </>
  );
}

const LENGTHS = ['30 s', '60 s', '90 s'];
const FORMATS = ['9:16', '16:9', '1:1'];

export function StudioView(props: { services: Services; job: Job; onBack: () => void; onError: (error: unknown) => void }) {
  const { api, platform, config } = props.services;
  const url = props.job.url ?? props.job.pageUrl ?? '';
  const [message, setMessage] = useState(`Generate a video of this website: ${url}`);
  const [length, setLength] = useState('60 s');
  const [format, setFormat] = useState('9:16');
  const [extras, setExtras] = useState<Record<string, boolean>>({ Captions: true, Voiceover: true, Music: true });
  const [turn, setTurn] = useState<AgentTurn>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const base = message.trim();
  const fullMessage = `${/[.!?]$/.test(base) ? base : `${base}.`} Keep it about ${length.replace(' s', ' seconds')}, ${format} format${
    Object.entries(extras).filter(([, on]) => on).length ? `, with ${Object.entries(extras).filter(([, on]) => on).map(([name]) => name.toLowerCase()).join(', ')}` : ''}.`;

  async function send() {
    setBusy(true);
    setError(undefined);
    try {
      let current = await api.sendToStudio(fullMessage);
      setTurn(current);
      while (!current.done || current.modelRunsPending) {
        current = await api.getStudioMessage(current.message.messageId, current.session);
        setTurn(current);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      props.onError(failure);
    } finally {
      setBusy(false);
    }
  }

  const outputs: TaskOutput[] = (turn?.modelRuns ?? []).flatMap(run => run.outputs.map(output => ({
    url: output.url,
    name: output.name,
    mimeType: output.mimeType ?? '',
    sizeBytes: output.sizeBytes ?? null,
    kind: (output.mimeType ?? '').startsWith('video') ? 'video' : (output.mimeType ?? '').startsWith('audio') ? 'audio' : (output.mimeType ?? '').startsWith('image') ? 'image' : 'file',
  } as TaskOutput)));

  if (turn) {
    const steps = turn.modelRuns ?? [];
    return (
      <>
        <button class="back" onClick={props.onBack}>← Home</button>
        <div class="title">{busy ? 'Studio is working' : 'Studio'}</div>
        {busy && <div class="bar"><span /></div>}
        {turn.message.reply && <div class="card" style="padding:10px 12px;white-space:pre-wrap;font-size:12.5px">{turn.message.reply}</div>}
        {steps.length > 0 && (
          <div class="card steps">
            {steps.map(run => (
              <div class={`step${run.state === 'completed' ? ' done' : ''}`}>
                <span class="dot">{run.state === 'completed' ? '✓' : run.state === 'running' ? '…' : '×'}</span>
                <span>{run.modelTitle ?? run.model ?? 'Model run'}</span>
              </div>
            ))}
          </div>
        )}
        {outputs.length > 0 && <Outputs outputs={outputs} />}
        {error && <div class="box err">{error}</div>}
        <div class="btnrow">
          <button class="btn sm" onClick={() => platform.openTab(`${config.site}/studio`)}>Open in Wiro Studio <Icon.external /></button>
          {outputs[0]?.url && <button class="btn sm" onClick={() => saveFile(outputs[0]?.url as string, fileNameOf(outputs[0]?.url))}><Icon.download />Download</button>}
        </div>
        <p class="fine">The chat is also in Wiro Studio on wiro.ai.</p>
      </>
    );
  }

  return (
    <>
      <button class="back" onClick={props.onBack}>← Home</button>
      <div class="title">Make a video with Studio</div>
      <InputCard job={props.job} />
      <div class="fld">
        <div class="l">Message to Studio <em>edit freely</em></div>
        <textarea value={message} onInput={event => setMessage((event.currentTarget as HTMLTextAreaElement).value)} />
      </div>
      <div class="fld"><div class="l">Length</div><div class="chips">{LENGTHS.map(item => <button class="chip" aria-pressed={length === item} onClick={() => setLength(item)}>{item}</button>)}</div></div>
      <div class="fld"><div class="l">Format</div><div class="chips">{FORMATS.map(item => <button class="chip" aria-pressed={format === item} onClick={() => setFormat(item)}>{item}</button>)}</div></div>
      <div class="fld"><div class="l">Extras</div><div class="chips">{Object.keys(extras).map(name => <button class="chip" aria-pressed={extras[name]} onClick={() => setExtras({ ...extras, [name]: !extras[name] })}>{name}</button>)}</div></div>
      <div class="price">
        <div class="row"><span>Price</span><strong style="font-size:14px">By what Studio runs</strong></div>
        <p>Studio picks the models, makes AI clips and code-made scenes, then joins and captions them. It is billed after the turn and needs at least $10 in your wallet to start.</p>
      </div>
      {error && <div class="box err">{error}</div>}
      <button class="btn pri wide" disabled={busy || !message.trim()} onClick={send}>Send to Studio</button>
      <p class="fine">Every message is a new, billed Studio turn.</p>
    </>
  );
}
