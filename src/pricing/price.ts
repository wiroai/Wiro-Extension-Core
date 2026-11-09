import type { ModelDetail, ModelSummary, PriceRow } from '../types.js';

// The price shown on the run button. With the model's price rows (Wiro's
// dynamicprice) it is exact for the chosen settings; without them it is the
// model's price summary. The rules follow Wiro-MCP's price formatting.

export interface PriceQuote {
  /** A number when the price for these settings is known up front. */
  amount?: number;
  /** True when the amount is an estimate (billed by run time, or set when the run ends). */
  approximate: boolean;
  /** Short text for the button: "$0.20", "about $0.02", "from $0.10". */
  label: string;
  /** One line under the price. */
  note?: string;
}

export interface QuoteContext {
  /** Characters of the prompt, for per-character prices. */
  promptChars?: number;
  /** Seconds of the input audio or video, when known. */
  mediaSeconds?: number;
}

const LIVE = 'cp-realtimeturn';
const READ_OUTPUT = 'cp-readoutput';

export function formatUsd(amount: number): string {
  if (amount === 0) return '$0';
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  if (amount >= 0.01) return `$${trimZeros(amount.toFixed(3))}`;
  return `$${trimZeros(amount.toPrecision(3))}`;
}

function trimZeros(value: string): string {
  if (!value.includes('.')) return value;
  const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
  // Keep cents readable: 0.2 → 0.20.
  return /\.\d$/.test(trimmed) ? `${trimmed}0` : trimmed;
}

/** A sortable price for list ordering: the first dollar amount in the summary. */
export function priceSortKey(model: ModelSummary): number {
  const match = /\$\s*([0-9]*\.?[0-9]+(?:e-?\d+)?)/i.exec(model.pricing ?? '');
  if (match) return Number(match[1]);
  if (typeof model.estimatedCostUsd === 'number') return model.estimatedCostUsd;
  return Number.POSITIVE_INFINITY;
}

export function isLiveModel(model: ModelSummary): boolean {
  return /turn by turn|live session/i.test(model.pricing ?? '');
}

/** The summary line from search_models, made short for list rows. */
export function shortPricing(model: ModelSummary): string {
  const text = (model.pricing ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return typeof model.estimatedCostUsd === 'number' ? `about ${formatUsd(model.estimatedCostUsd)}` : 'price on Wiro';
  if (/^per second of run time/i.test(text)) return 'by run time';
  if (/^set by the run/i.test(text)) {
    const estimate = /listed estimate \$([0-9.]+)/i.exec(text);
    return estimate ? `about $${estimate[1]}` : 'set when it ends';
  }
  if (isLiveModel(model)) return 'live, per turn';
  const estimated = /^~\$([0-9.]+) per run/i.exec(text);
  if (estimated) return `about ${formatUsd(Number(estimated[1]))}`;
  return text
    .replace(/ \/ per request/i, ' / run')
    .replace(/ \/ per output/i, ' / output')
    .replace(/ \/ per prompt character.*/i, ' / character')
    .replace(/ \/ per video second/i, ' / video second')
    .replace(/ \/ per second of audio.*/i, ' / audio second')
    .replace(/\. Every character.*$/i, '');
}

function rowMatches(row: PriceRow, params: Record<string, unknown>): number {
  const inputs = Object.entries(row.inputs ?? {});
  let score = 0;
  for (const [key, expected] of inputs) {
    const actual = params[key];
    const quantity = /^QUANTITY:(\d+)$/.exec(String(expected));
    if (quantity) {
      const count = Array.isArray(actual) ? actual.length : (actual ? 1 : 0);
      if (count < Number(quantity[1])) return -1;
      score += 1;
      continue;
    }
    if (actual === undefined || actual === '') return -1;
    const same = typeof expected === 'number' ? Number(actual) === expected : String(actual) === String(expected);
    if (!same) return -1;
    score += 1;
  }
  return score;
}

/** The row that applies to these params: the most specific match. */
export function matchingRow(rows: PriceRow[], params: Record<string, unknown>): PriceRow | undefined {
  let best: PriceRow | undefined;
  let bestScore = -1;
  for (const row of rows) {
    const score = rowMatches(row, params);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}

function countParam(params: Record<string, unknown>): number {
  for (const key of ['n', 'numberOfImages', 'numImages', 'numOutputs', 'numberOfOutputs', 'count', 'batchSize']) {
    const value = Number(params[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 1;
}

function durationParam(params: Record<string, unknown>): number | undefined {
  for (const key of ['duration', 'durationSeconds', 'length', 'seconds', 'videoLength']) {
    const value = Number(params[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

export function quote(model: ModelDetail, params: Record<string, unknown>, context: QuoteContext = {}): PriceQuote {
  const rows = (model.priceList ?? []).filter(row => row && typeof row === 'object');
  if (rows.length === 0) return summaryQuote(model);

  if (rows.some(row => row.priceMethod === LIVE)) {
    return { approximate: true, label: 'live, per turn', note: 'Billed turn by turn during a live session.' };
  }
  const row = matchingRow(rows, params);
  if (!row) return summaryQuote(model);
  const price = Number(row.price) || 0;
  const discount = model.discountPercent ? ` Your discount: ${model.discountPercent}%.` : '';

  switch (row.priceMethod) {
    case 'cpr':
      return { amount: price, approximate: false, label: formatUsd(price), note: `Fixed price for these settings.${discount}` };
    case 'cpo': {
      const count = countParam(params);
      const amount = price * count;
      return { amount, approximate: false, label: formatUsd(amount), note: `${formatUsd(price)} per output${count > 1 ? ` × ${count}` : ''}.${discount}` };
    }
    case 'cp-promptlength': {
      const chars = context.promptChars ?? 0;
      const amount = price * chars;
      return { amount, approximate: false, label: formatUsd(amount), note: `${chars.toLocaleString('en-US')} characters × ${formatUsd(price)}.${discount}` };
    }
    case 'cp-outputVideoLength': {
      const seconds = durationParam(params);
      if (seconds === undefined) return { approximate: true, label: `${formatUsd(price)} / second`, note: 'Billed per second of output video.' };
      const amount = price * seconds;
      return { amount, approximate: false, label: formatUsd(amount), note: `${seconds} seconds × ${formatUsd(price)}.${discount}` };
    }
    case 'cp-audiosecondslength': {
      if (context.mediaSeconds === undefined) return { approximate: true, label: `${formatUsd(price)} / second`, note: 'Billed per second of the input audio.' };
      const amount = price * Math.ceil(context.mediaSeconds);
      return { amount, approximate: true, label: `about ${formatUsd(amount)}`, note: `${Math.ceil(context.mediaSeconds)} seconds × ${formatUsd(price)}.${discount}` };
    }
    case 'cp-pixel':
      return { amount: price, approximate: true, label: `from ${formatUsd(price)}`, note: 'Priced by image size; larger outputs cost more.' };
    case 'cps':
      return { approximate: true, label: 'by run time', note: 'Billed per second of run time. The exact charge shows when it ends.' };
    case READ_OUTPUT: {
      const note = row.note ? row.note.replace(/\s+/g, ' ').trim() : 'The exact charge shows when it ends.';
      return price > 0
        ? { amount: price, approximate: true, label: `about ${formatUsd(price)}`, note }
        : { approximate: true, label: 'set when it ends', note };
    }
    default:
      return summaryQuote(model);
  }
}

/** Without price rows: the summary from search_models or get_model_schema. */
export function summaryQuote(model: ModelSummary): PriceQuote {
  const text = model.pricing ?? '';
  const single = /^\$([0-9.]+(?:e-?\d+)?) \/ per (request|output)\b/i.exec(text);
  if (single) {
    const amount = Number(single[1]);
    return { amount, approximate: false, label: formatUsd(amount), note: single[2] === 'output' ? 'Per output.' : 'Fixed price per run.' };
  }
  const estimate = typeof model.estimatedCostUsd === 'number' ? model.estimatedCostUsd : undefined;
  if (estimate !== undefined) {
    return { amount: estimate, approximate: true, label: `about ${formatUsd(estimate)}`, note: 'Average of past runs. The exact charge shows when it ends.' };
  }
  return { approximate: true, label: shortPricing(model), note: text || undefined };
}
