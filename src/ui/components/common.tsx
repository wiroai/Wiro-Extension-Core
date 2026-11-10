import { useState } from 'preact/hooks';
import type { Account, Job, ModelSummary, TaskOutput } from '../../types.js';
import { shortPricing } from '../../pricing/price.js';
import type { PriceQuote } from '../../pricing/price.js';

export const Icon = {
  dots: () => <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>,
  download: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>,
  link: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>,
  external: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>,
};

export function initials(text: string): string {
  return text.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map(word => word.charAt(0)).join('').slice(0, 2);
}

export function ownerOf(slug: string): string {
  return slug.split('/')[0] ?? slug;
}

export function hostOf(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function fileNameOf(url?: string): string {
  if (!url) return '';
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    return name || hostOf(url);
  } catch {
    return url.slice(0, 60);
  }
}

export function Header(props: { account?: Account | null; onHistory: () => void; onTray: () => void; onAccount: () => void; onSignOut: () => void; onHome: () => void }) {
  const [open, setOpen] = useState(false);
  const balance = props.account?.balance?.totalUsd;
  const workspace = props.account?.workspace;
  const name = workspace?.kind === 'team' ? (workspace.teamName || workspace.organizationName || 'Team') : 'Personal';
  return (
    <div class="top">
      <button class="back" style="font-weight:550;color:var(--ink)" onClick={props.onHome} title="Home">{name}</button>
      {typeof balance === 'number' && <span class={`bal${balance < 1 ? ' low' : ''}`} title="Wiro wallet balance">${balance.toFixed(2)}</span>}
      <button class="icon-btn" aria-label="Menu" onClick={() => setOpen(!open)}><Icon.dots /></button>
      {open && (
        <div class="menu-pop" onClick={() => setOpen(false)}>
          <button onClick={props.onHistory}>History</button>
          <button onClick={props.onTray}>Tray</button>
          {/* Opens the account page on wiro.ai, where the account can also be deleted (App Store guideline 5.1.1(v)). */}
          <button onClick={props.onAccount}>Account and deletion</button>
          <button onClick={props.onSignOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}

export function InputCard({ job }: { job: Job }) {
  if (job.kind === 'selection') {
    return (
      <div class="card quote">
        <div class="label">Selected text</div>
        <q>{job.text}</q>
        <div class="meta"><span>{(job.text ?? '').length.toLocaleString('en-US')} characters</span><span>{hostOf(job.pageUrl)}</span></div>
      </div>
    );
  }
  const media = job.kind === 'image'
    ? <img src={job.url} alt="" />
    : job.kind === 'video'
      ? <video src={job.url} muted preload="metadata" />
      : <span class="thumb">{job.kind === 'audio' ? '♪' : 'WWW'}</span>;
  return (
    <div class="card src">
      {media}
      <div style="min-width:0">
        <div class="n">{job.kind === 'page' ? (job.pageTitle || hostOf(job.url)) : fileNameOf(job.url)}</div>
        <div class="s">{job.kind === 'page' ? job.url : hostOf(job.pageUrl)}</div>
      </div>
    </div>
  );
}

export function ModelButton({ model, onClick, hint }: { model?: ModelSummary; onClick: () => void; hint?: string }) {
  return (
    <button class="mbtn" onClick={onClick}>
      <span class="mi">{initials(model?.title ?? '?')}</span>
      <span class="mt">
        <b>{model?.title ?? 'Choose a model'}</b>
        <span>{model ? <>{ownerOf(model.slug)} · {shortPricing(model)} <OfferBadge percent={model.discountPercent} /></> : hint}</span>
      </span>
      <span class="ch">Change ▾</span>
    </button>
  );
}

/** The caller's offer on a model, as wiro.ai shows it beside the name. */
export function OfferBadge({ percent }: { percent?: number }) {
  if (!percent) return null;
  return <span class="offer" title="Your discount comes off the part of a charge paid from deposits.">{Number(percent.toFixed(2))}% off</span>;
}

/** The price before a run: the struck list price beside the new one when there is an offer. */
export function PriceBox({ quote }: { quote: PriceQuote }) {
  const options = quote.options ?? [];
  return (
    <div class="price">
      <div class="row">
        <span>Price <OfferBadge percent={quote.discountPercent} /></span>
        {quote.listLabel
          ? <strong><s>{quote.listLabel}</s> <ins>{quote.label}</ins></strong>
          : <strong>{quote.label}</strong>}
      </div>
      {quote.note && <p>{quote.note}</p>}
      {options.length > 1 && (
        <details class="price-options">
          <summary>All prices ({options.length})</summary>
          <ul>
            {options.map((option, index) => (
              <li key={index} class={option.current ? 'cur' : undefined} aria-current={option.current ? 'true' : undefined}>
                <span class="c">{option.conditions.length > 0 ? option.conditions.join(' · ') : 'Any settings'}{option.note ? <small>{option.note}</small> : null}</span>
                <span class="p">{option.price}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Saves a file from the Wiro CDN (it allows any origin) without the downloads permission. */
export async function saveFile(url: string, name?: string): Promise<void> {
  const response = await fetch(url);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = name || fileNameOf(url) || 'wiro-output';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

export function Outputs({ outputs, transparentHint }: { outputs: TaskOutput[]; transparentHint?: boolean }) {
  if (outputs.length === 0) return <div class="empty">The run finished without files.</div>;
  return (
    <>
      {outputs.map((output, index) => {
        const key = `${output.url ?? ''}${index}`;
        if (output.kind === 'text') return <div class="res" key={key}><pre>{output.text ?? ''}</pre></div>;
        if (!output.url) return null;
        if (output.kind === 'image') return <div class={`res${transparentHint || output.mimeType === 'image/png' ? ' cut' : ''}`} key={key}><img src={output.url} alt="" /></div>;
        if (output.kind === 'video') return <div class="res" key={key}><video src={output.url} controls autoplay muted loop playsInline /></div>;
        if (output.kind === 'audio') return <div class="res" key={key}><audio src={output.url} controls /></div>;
        return <div class="res" key={key}><div class="file"><b>{output.name || fileNameOf(output.url)}</b><span class="sub">{output.mimeType}</span></div></div>;
      })}
    </>
  );
}
