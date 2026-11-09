import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Services } from '../services.js';
import { addHistory, addToTray, lastModel, readTray, rememberModel } from '../services.js';
import type { CatalogAction } from '../../catalog/catalog.js';
import { actionInput, actionTitle } from '../../catalog/catalog.js';
import type { SortOrder } from '../../catalog/models.js';
import { acceptsInput, buildParams, fileFieldPositions, missingInputs, orderedFileSlots, slotsFor, withDefaults, type CommonValues, type InputFit } from '../../gateway/gateway.js';
import { formatUsd, quote, shortPricing } from '../../pricing/price.js';
import type { Account, Job, MediaKind, ModelDetail, ModelSummary, TaskResult, TrayItem } from '../../types.js';
import { CommonFields, SpecificFields } from '../components/fields.js';
import { Icon, InputCard, ModelButton, OfferBadge, Outputs, PriceBox, initials, ownerOf, saveFile } from '../components/common.js';

type Phase = 'form' | 'running' | 'done' | 'failed';

function initialValues(job: Job, input: MediaKind | 'text' | 'url'): CommonValues {
  const values: CommonValues = { files: {} };
  if (job.kind === 'selection') values.prompt = job.text ?? '';
  else if (input === 'url') values.url = job.url;
  else if (job.url) values.files[input === 'text' ? 'image' : input] = [job.url];
  return values;
}

export function ActionView(props: {
  services: Services;
  job: Job;
  action: CatalogAction;
  account?: Account | null;
  onBack: () => void;
  onError: (error: unknown) => void;
  onBalanceChange: () => void;
}) {
  const { services, job, action } = props;
  const { platform, api, directory, config } = services;
  const input = actionInput(action);
  const actionKey = `${action.kind}:${action.id}`;

  const [sort, setSort] = useState<SortOrder>('popular');
  const [models, setModels] = useState<ModelSummary[] | null>(null);
  const [fits, setFits] = useState<Record<string, InputFit>>({});
  const [selected, setSelected] = useState<string>();
  const [explicitPick, setExplicitPick] = useState(false);
  const [detail, setDetail] = useState<ModelDetail>();
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState('');
  const [values, setValues] = useState<CommonValues>(() => initialValues(job, input));
  const [specific, setSpecific] = useState<Record<string, string | boolean>>({});
  const [phase, setPhase] = useState<Phase>('form');
  const [progress, setProgress] = useState<TaskResult>();
  const [result, setResult] = useState<TaskResult>();
  const [message, setMessage] = useState<string>();
  const [mediaSeconds, setMediaSeconds] = useState<number>();
  const [tray, setTray] = useState<TrayItem[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const abort = useRef<AbortController | undefined>(undefined);

  // The category's models, live from Wiro.
  useEffect(() => {
    let live = true;
    setModels(null);
    directory.list(action.categories, sort, { skipLive: action.skipLive, exclude: action.exclude })
      .then(async list => {
        if (!live) return;
        setModels(list);
        void directory.checkInputs(list, input, (slug, fit) => live && setFits(current => ({ ...current, [slug]: fit })));
        if (!selected) {
          const remembered = await lastModel(platform, actionKey);
          const pick = list.some(model => model.slug === remembered)
            ? remembered
            : await directory.pickDefault(action.categories, input, { skipLive: action.skipLive, exclude: action.exclude });
          if (live && pick) setSelected(pick);
        }
      })
      .catch(props.onError);
    return () => { live = false; };
  }, [action.id, sort]);

  // The picked model's schema. If it cannot take the clicked item, move on to the next one.
  useEffect(() => {
    if (!selected) return;
    let live = true;
    setDetail(undefined);
    directory.detail(selected)
      .then(model => {
        if (!live) return;
        if (!acceptsInput(model, input) && !explicitPick && models) {
          setFits(current => ({ ...current, [model.slug]: 'none' }));
          const next = models.find(candidate => candidate.slug !== model.slug && fits[candidate.slug] !== 'none' && models.indexOf(candidate) > models.findIndex(m => m.slug === model.slug));
          if (next) {
            setSelected(next.slug);
            return;
          }
        }
        setDetail(model);
      })
      .catch(props.onError);
    return () => { live = false; };
  }, [selected]);

  // Seconds of the clicked video or audio, for per-second prices.
  useEffect(() => {
    if ((job.kind !== 'video' && job.kind !== 'audio') || !job.url) return;
    const element = document.createElement(job.kind);
    element.preload = 'metadata';
    element.src = job.url;
    element.onloadedmetadata = () => Number.isFinite(element.duration) && setMediaSeconds(element.duration);
  }, [job.url]);

  useEffect(() => {
    void readTray(platform).then(setTray);
  }, []);

  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const slots = useMemo(() => (detail ? slotsFor(detail) : undefined), [detail]);
  const params = useMemo(() => (detail ? buildParams(detail, values, specific) : {}), [detail, values, specific]);
  const priceQuote = detail ? quote(detail, withDefaults(detail, params), { promptChars: (values.prompt ?? '').length, mediaSeconds }) : undefined;
  const missing = detail ? missingInputs(detail, params) : [];
  const balance = props.account?.balance?.totalUsd;
  // What the run is expected to take from the wallet, after any discount.
  const payable = priceQuote?.amount;
  const payLabel = priceQuote?.label ?? '';
  const tooLow = typeof balance === 'number' && payable !== undefined && balance < payable;
  const current = models?.find(model => model.slug === selected);
  const title = actionTitle(action);

  // File fields other than the one the clicked item fills (a last frame, a second clip, a garment).
  const extraFileFields = useMemo(() => {
    if (!slots) return [];
    const clickedKind = job.url && job.kind !== 'page' && job.kind !== 'selection' ? job.kind : undefined;
    const ordered = orderedFileSlots(slots);
    return fileFieldPositions(slots).filter(({ slot, position }) => {
      if (position !== 0) return true;
      const takesClicked = slot.kind === clickedKind
        || (slot.kind === 'file' && clickedKind !== undefined && !ordered.some(other => other.kind === clickedKind));
      return !takesClicked;
    });
  }, [slots, job]);

  function setExtraFile(kind: MediaKind, index: number, url: string) {
    const list = [...(values.files[kind] ?? [])];
    while (list.length < index) list.push('');
    list[index] = url;
    setValues({ ...values, files: { ...values.files, [kind]: list } });
  }

  async function run() {
    if (!detail) return;
    setPhase('running');
    setMessage(undefined);
    setProgress(undefined);
    setStartedAt(Date.now());
    const controller = new AbortController();
    abort.current = controller;
    try {
      const final = await api.runToEnd(detail.slug, params, setProgress, controller.signal);
      setResult(final);
      if (final.state === 'completed') {
        setPhase('done');
        await rememberModel(platform, actionKey, detail.slug);
        await addHistory(platform, {
          id: final.task.id ?? final.task.token ?? String(Date.now()),
          model: detail.slug,
          modelTitle: detail.title,
          actionLabel: title,
          outputs: final.outputs,
          chargedUsd: final.task.chargedUsd ?? final.task.costUsd ?? null,
          at: Date.now(),
        });
        props.onBalanceChange();
      } else {
        setPhase('failed');
        setMessage(final.error || (final.state === 'cancelled' ? 'The run was cancelled.' : 'The run failed. Failed runs are not charged.'));
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        setPhase('form');
        return;
      }
      setPhase('failed');
      setMessage(error instanceof Error ? error.message : String(error));
      props.onError(error);
    }
  }

  async function cancel() {
    const token = progress?.task.token;
    abort.current?.abort();
    if (token) {
      try {
        await api.cancelTask(token);
      } catch {
        // It may have finished already; History shows the result.
      }
    }
    setPhase('form');
  }

  if (picking) {
    const shown = (models ?? []).filter(model => fits[model.slug] !== 'none')
      .filter(model => !filter || `${model.title} ${model.slug}`.toLowerCase().includes(filter.toLowerCase()));
    return (
      <>
        <button class="back" onClick={() => setPicking(false)}>← Back</button>
        <div>
          <div class="title">Choose a model</div>
          <div class="sub mono">{action.categories.join(' + ')} · {models ? `${shown.length} shown` : 'loading'}</div>
        </div>
        <input type="text" placeholder={`Search ${action.categories[0] ?? ''} models`} value={filter} onInput={event => setFilter((event.currentTarget as HTMLInputElement).value)} />
        <div class="chips">
          {(['price', 'popular', 'newest'] as SortOrder[]).map(order => (
            <button class="chip" aria-pressed={sort === order} onClick={() => setSort(order)}>
              {order === 'price' ? 'Lowest price' : order === 'popular' ? 'Popular' : 'Newest'}
            </button>
          ))}
        </div>
        {!models && <div class="empty">Loading models from Wiro…</div>}
        {models && shown.length === 0 && <div class="empty">No model in this category takes this yet.</div>}
        <div class="list">
          {shown.map(model => (
            <button class="row" aria-selected={model.slug === selected}
              onClick={() => { setExplicitPick(true); setSelected(model.slug); setPicking(false); }}>
              <span class="mi">{initials(model.title)}</span>
              <span style="min-width:0"><div class="n">{model.title}</div><div class="o">{ownerOf(model.slug)}{fits[model.slug] === 'partial' ? ' · needs another file' : ''} <OfferBadge percent={model.discountPercent} /></div></span>
              <span class="pr" title={model.pricing}>{shortPricing(model)}</span>
            </button>
          ))}
        </div>
        <p class="fine">Live from Wiro's {action.categories.join(' and ')} {action.categories.length > 1 ? 'categories' : 'category'}. New models show up here on their own.</p>
      </>
    );
  }

  if (phase === 'running') {
    const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
    return (
      <>
        <div class="title">{title}</div>
        <InputCard job={job} />
        <div class="run">
          <div class="spin" />
          <div>
            <div style="font-weight:550">{progress?.state === 'running' ? 'Running on Wiro' : 'Starting'}</div>
            <div class="sub mono">{detail?.title} · {seconds} s</div>
          </div>
        </div>
        <div class="bar"><span /></div>
        <button class="btn sm" onClick={cancel}>Stop</button>
        <p class="fine">You can close this panel. Finished runs stay under History and in your Wiro task history.</p>
      </>
    );
  }

  if (phase === 'done' && result) {
    const charged = result.task.chargedUsd ?? result.task.costUsd;
    const first = result.outputs.find(output => output.url);
    return (
      <>
        <div class="title">{title}</div>
        <Outputs outputs={result.outputs} />
        <div class="meta"><span>{detail?.title}</span><span class="mono">{result.task.durationSeconds ? `${Math.round(result.task.durationSeconds)} s` : ''}</span></div>
        <div class="btnrow">
          {first?.url && <button class="btn pri sm" onClick={() => saveFile(first.url as string, first.name)}><Icon.download />Download</button>}
          {first?.url && <button class="btn sm" onClick={() => navigator.clipboard.writeText(first.url as string)}><Icon.link />Copy link</button>}
          {first?.url && <button class="btn sm" onClick={() => addToTray(platform, { kind: first.kind === 'text' ? 'text' : (first.kind as MediaKind), url: first.url, title: first.name || title, from: 'Wiro result' })}>Add to tray</button>}
        </div>
        <div class="box ok">Done{typeof charged === 'number' ? ` · charged ${formatUsd(charged)}` : ''}</div>
        <div class="btnrow">
          <button class="btn sm" onClick={() => setPhase('form')}>Run again</button>
          <button class="btn sm" onClick={() => platform.openTab(`${config.site}/panel/task-history`)}>Task history <Icon.external /></button>
        </div>
      </>
    );
  }

  return (
    <>
      <button class="back" onClick={props.onBack}>← Home</button>
      <div class="title">{title}</div>
      {job.kind !== 'page' || input === 'url' ? <InputCard job={job} /> : null}
      {phase === 'failed' && message && <div class="box err">{message}</div>}
      <div class="fld">
        <div class="l">Model <em>{action.categories.join(' + ')}{models ? ` · ${models.length} models` : ''}</em></div>
        <ModelButton model={current} onClick={() => setPicking(true)} hint={models ? 'No model yet' : 'Loading models…'} />
      </div>
      {models && models.length === 0 && (
        <div class="box warn">Wiro has no models in the {action.categories.join(' or ')} {action.categories.length > 1 ? 'categories' : 'category'} yet. They show up here as soon as they are added.</div>
      )}
      {!detail && selected && <div class="empty">Loading the model…</div>}
      {detail && slots && (
        <>
          <CommonFields slots={slots} values={values} onChange={setValues} promptMode={action.prompt ?? 'optional'} promptHint={action.promptHint} />
          {extraFileFields.map(({ slot, position: index }) => {
            const fromTray = tray.filter(item => (item.kind === slot.kind || slot.kind === 'file') && item.url);
            return (
              <div class="fld">
                <div class="l">{slot.param.label} <em>{slot.param.required ? 'required' : 'optional'}</em></div>
                <input type="url" placeholder={`Link to the ${slot.kind}`} value={values.files[slot.kind]?.[index] ?? ''}
                  onInput={event => setExtraFile(slot.kind, index, (event.currentTarget as HTMLInputElement).value)} />
                {fromTray.length > 0 && (
                  <select value="" onChange={event => setExtraFile(slot.kind, index, (event.currentTarget as HTMLSelectElement).value)}>
                    <option value="">From the tray…</option>
                    {fromTray.map(item => <option value={item.url}>{item.title}</option>)}
                  </select>
                )}
              </div>
            );
          })}
          <SpecificFields params={slots.rest} values={specific} onChange={setSpecific} />
          {priceQuote && <PriceBox quote={priceQuote} />}
          {missing.length > 0 && <div class="box warn">Fill in: {missing.map(param => param.label).join(', ')}.</div>}
          {tooLow && (
            <div class="box warn">
              <span>Your Wiro balance is ${balance?.toFixed(2)} and this run costs {payLabel}.</span>
              {/* The Mac App Store version may not point to a purchase outside the app (App Store guideline 3.1.3(f)). */}
              {platform.name !== 'safari' && (
                <button class="btn sm" onClick={() => platform.openTab(`${config.site}/panel/wallet/deposit/credit-card`)}>Add funds on wiro.ai <Icon.external /></button>
              )}
            </div>
          )}
          <button class="btn pri wide" disabled={missing.length > 0 || tooLow} onClick={run}>
            {title} · {payLabel}
          </button>
          <p class="fine">Paid from your Wiro wallet. Failed runs are not charged.</p>
        </>
      )}
    </>
  );
}
