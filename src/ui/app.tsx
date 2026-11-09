import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Platform } from '../platform.js';
import type { WiroConfig } from '../config.js';
import { AuthRequiredError } from '../mcp/client.js';
import { findAction, type Catalog, type CatalogAction } from '../catalog/catalog.js';
import { JOB_KEY, TRAY_ID, MORE_ID } from '../background/menus.js';
import type { Account, Job } from '../types.js';
import { addToTray, createServices, type Services } from './services.js';
import { Header } from './components/common.js';
import { ActionView } from './views/action.js';
import { HistoryView, HomeView, MoreView, SignInView, StudioView, TrayView } from './views/others.js';

type Route =
  | { name: 'home' }
  | { name: 'history' }
  | { name: 'tray' }
  | { name: 'more'; job: Job }
  | { name: 'action'; job: Job; action: CatalogAction }
  | { name: 'studio'; job: Job };

function App({ services }: { services: Services }) {
  const { platform, oauth, api } = services;
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [account, setAccount] = useState<Account | null>();
  const [catalog, setCatalog] = useState<Catalog>();
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [notice, setNotice] = useState<string>();

  const refreshAccount = () => void api.getAccount().then(setAccount).catch(() => setAccount(null));

  async function openJob(job: Job) {
    const loaded = catalog ?? await services.catalog();
    if (job.actionId === TRAY_ID) {
      await addToTray(platform, {
        kind: job.kind === 'selection' ? 'text' : job.kind === 'page' ? 'file' : job.kind,
        url: job.url,
        text: job.text,
        title: job.kind === 'selection' ? (job.text ?? '').slice(0, 60) : (job.url ?? '').split('/').pop() || 'Item',
        from: job.pageUrl,
      });
      setRoute({ name: 'tray' });
      return;
    }
    if (job.actionId === MORE_ID) {
      setRoute({ name: 'more', job });
      return;
    }
    const action = findAction(loaded, job.kind, job.actionId);
    if (!action) setRoute({ name: 'more', job });
    else if (action.agent === 'studio') setRoute({ name: 'studio', job });
    else setRoute({ name: 'action', job, action });
  }

  useEffect(() => {
    void services.catalog().then(setCatalog);
    void oauth.isSignedIn().then(setSignedIn);
    void platform.session.get<Job>(JOB_KEY).then(job => job && openJob(job));
    return platform.session.onChanged(changes => {
      const job = changes[JOB_KEY] as Job | undefined;
      if (job) void openJob(job);
    });
  }, []);

  useEffect(() => {
    if (signedIn) refreshAccount();
  }, [signedIn]);

  function onError(error: unknown) {
    if (error instanceof AuthRequiredError) {
      setSignedIn(false);
      return;
    }
    setNotice(error instanceof Error ? error.message : String(error));
  }

  if (signedIn === null) return <div class="wp"><div class="empty">Loading…</div></div>;
  if (!signedIn) return <SignInView services={services} onSignedIn={() => setSignedIn(true)} />;

  const home = () => setRoute({ name: 'home' });
  return (
    <div class="wp" style="position:relative">
      <Header account={account} onHome={home} onHistory={() => setRoute({ name: 'history' })} onTray={() => setRoute({ name: 'tray' })}
        onSignOut={async () => { await oauth.signOut(); setSignedIn(false); }} />
      {notice && <div class="box err" onClick={() => setNotice(undefined)}>{notice}</div>}
      {route.name === 'home' && <HomeView catalog={catalog} onHistory={() => setRoute({ name: 'history' })} onTray={() => setRoute({ name: 'tray' })} onMore={() => undefined} />}
      {route.name === 'history' && <HistoryView services={services} onBack={home} />}
      {route.name === 'tray' && <TrayView services={services} onBack={home} onUse={job => setRoute({ name: 'more', job })} />}
      {route.name === 'more' && catalog && (
        <MoreView catalog={catalog} job={route.job} onBack={home}
          onPick={action => setRoute(action.agent === 'studio' ? { name: 'studio', job: route.job } : { name: 'action', job: route.job, action })} />
      )}
      {route.name === 'action' && (
        <ActionView key={`${route.job.id}:${route.action.id}`} services={services} job={route.job} action={route.action} account={account}
          onBack={home} onError={onError} onBalanceChange={refreshAccount} />
      )}
      {route.name === 'studio' && <StudioView key={route.job.id} services={services} job={route.job} onBack={home} onError={onError} />}
    </div>
  );
}

/**
 * Text cut short with an ellipsis shows its full value in a tooltip on hover.
 * One listener covers every truncated line, so new views need no extra code.
 */
export function showFullTextOnHover(root: HTMLElement): void {
  root.addEventListener('mouseover', event => {
    let el = event.target instanceof HTMLElement ? event.target : null;
    for (let depth = 0; el && el !== root && depth < 4; depth++, el = el.parentElement) {
      const style = getComputedStyle(el);
      const clamped = !['', 'none'].includes(style.getPropertyValue('-webkit-line-clamp'));
      if (style.textOverflow !== 'ellipsis' && !clamped) continue;
      // A title the view set on purpose stays.
      if (el.title && el.dataset.autoTitle !== '1') return;
      const cut = clamped ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth;
      if (cut) {
        el.title = (el.textContent ?? '').trim();
        el.dataset.autoTitle = '1';
      } else if (el.dataset.autoTitle === '1') {
        el.removeAttribute('title');
        delete el.dataset.autoTitle;
      }
      return;
    }
  });
}

/** Mounts the panel into `root`. Each browser's panel page calls this with its platform. */
export function mountPanel(root: HTMLElement, platform: Platform, config?: WiroConfig): void {
  showFullTextOnHover(root);
  render(<App services={createServices(platform, config)} />, root);
}
