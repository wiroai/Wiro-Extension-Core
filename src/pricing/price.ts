import type { ModelDetail, ModelParameter, ModelSummary, PriceRow } from '../types.js';

// The price shown before a run, worked out the way Wiro bills it and worded the
// way wiro.ai shows it.
//
// - The row: Wiro bills with the first row whose values all match the run's
//   settings. When any row counts files (QUANTITY:n), it bills with the valid
//   row that has the highest total count at or below what the run sends.
// - The charge per method: cpr is the price, cpo the price per output,
//   cp-promptlength per prompt character, cp-audiosecondslength per second of
//   input audio, cp-outputVideoLength per second of output video, cp-pixel per
//   1024 x 1024 block, and a run that matches no row is billed for its run time.
// - The sentence follows the model page on wiro.ai: a row's note, when it has
//   one, is shown instead of the sentence, and a discount shows the list price
//   struck through beside the new one.
//
// For a model without price rows, the quote reads the price summary that
// Wiro-MCP returns.

export interface PriceOption {
  /** "Resolution: 768P", "Input Image: Yes"; empty for a row that always applies. */
  conditions: string[];
  /** "$0.20 / run". */
  price: string;
  note?: string;
  /** The option these settings use. */
  current: boolean;
}

export interface PriceQuote {
  /** The price for these settings after any discount, when it is known up front. */
  amount?: number;
  /** True when the amount is an estimate or a starting price. */
  approximate: boolean;
  /** Short text for the button: "$0.20", "about $0.02", "from $0.10", "Free". */
  label: string;
  /** The line under the price: the row's note, or the model page's sentence. */
  note?: string;
  /** The caller's discount on this model, in percent. */
  discountPercent?: number;
  /** The list price before the discount, shown struck through. */
  listAmount?: number;
  listLabel?: string;
  /** Every price option, when the price depends on the settings. */
  options?: PriceOption[];
}

export interface QuoteContext {
  /** Characters of the prompt, for per-character prices. */
  promptChars?: number;
  /** Seconds of the input audio or video, when known. */
  mediaSeconds?: number;
}

const RUN_TIME = 'No fixed price for these settings. The charge follows the run time.';
const VARIES = 'Total cost varies with the run time.';
const PIXEL_BLOCK = '1024 x 1024';

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

function positive(value: unknown): number | undefined {
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

/**
 * A sortable price for list ordering. Fixed prices sort by their first amount;
 * prices set when the run ends or billed by run time sort by their estimate,
 * or last when they have none (the rates in their notes are not run prices).
 */
export function priceSortKey(model: ModelSummary): number {
  const text = model.pricing ?? '';
  const estimate = typeof model.estimatedCostUsd === 'number' ? model.estimatedCostUsd : undefined;
  if (/^set by the run|^per second of run time|turn by turn|live session|^no fixed price/i.test(text)) {
    const listed = /listed estimate \$([0-9.]+)/i.exec(text);
    return listed ? Number(listed[1]) : (estimate ?? Number.POSITIVE_INFINITY);
  }
  const match = /\$\s*([0-9]*\.?[0-9]+(?:e-?\d+)?)/i.exec(text);
  if (match) return Number(match[1]);
  return estimate ?? Number.POSITIVE_INFINITY;
}

export function isLiveModel(model: ModelSummary): boolean {
  return /turn by turn|live session/i.test(model.pricing ?? '');
}

/** The summary line from search_models, made short for list rows. */
export function shortPricing(model: ModelSummary): string {
  const text = (model.pricing ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return typeof model.estimatedCostUsd === 'number' ? `about ${formatUsd(model.estimatedCostUsd)}` : 'price on Wiro';
  if (/^\$0 \/ per (request|output)/i.test(text)) return 'free';
  if (/^per second of run time|^no fixed price/i.test(text)) return 'by run time';
  if (/^set by the run/i.test(text)) {
    const estimate = /listed estimate \$([0-9.]+)/i.exec(text);
    return estimate ? `about $${estimate[1]}` : 'set when it ends';
  }
  if (isLiveModel(model)) return 'live, per turn';
  const estimated = /^~\$([0-9.]+) per run/i.exec(text);
  if (estimated) return `about ${formatUsd(Number(estimated[1]))}`;
  const rate = /^\$([0-9.]+(?:e-?\d+)?) per second of run time/i.exec(text);
  if (rate) return `${formatUsd(Number(rate[1]))} / second`;
  const range = /^\$([0-9.]+(?:e-?\d+)?) to \$[0-9.]+(?:e-?\d+)? \/ per (request|output|video second)/i.exec(text);
  if (range) return `from ${formatUsd(Number(range[1]))} / ${range[2] === 'request' ? 'run' : range[2]}`;
  const pixel = /^\$([0-9.]+(?:e-?\d+)?)(?: to \$[0-9.]+)? per run for an output image/i.exec(text);
  if (pixel) return `from ${formatUsd(Number(pixel[1]))} / image`;
  return text
    .replace(/ \/ per request/i, ' / run')
    .replace(/ \/ per output/i, ' / output')
    .replace(/ \/ per prompt character.*/i, ' / character')
    .replace(/ \/ per video second/i, ' / video second')
    .replace(/ \/ per second of audio.*/i, ' / audio second')
    .replace(/ \/ per input and output token.*/i, ' / token')
    .replace(/\. Every character.*$/i, '');
}

// ---------------------------------------------------------------------------
// Matching a row, the way Wiro bills a run.

function quantityOf(value: unknown): number | null {
  const match = /^QUANTITY:(\d+)$/.exec(String(value));
  return match ? Number(match[1]) : null;
}

/** How many items a setting sends: list entries, or 1 for any other value. */
function countOf(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  if (Array.isArray(value)) return value.filter(item => item !== undefined && item !== null && item !== '').length;
  return 1;
}

// Wiro compares loosely: 5 matches "5".
function sameValue(expected: unknown, actual: unknown): boolean {
  if (actual === undefined || actual === null) return false;
  if (typeof expected === 'number') return Number(actual) === expected;
  return String(actual) === String(expected);
}

const hasQuantity = (row: PriceRow): boolean => Object.values(row.inputs ?? {}).some(value => quantityOf(value) !== null);

/** The row Wiro bills these settings with, or undefined when none applies. */
export function matchingRow(rows: PriceRow[], params: Record<string, unknown>): PriceRow | undefined {
  if (!rows.some(hasQuantity)) {
    return rows.find(row => Object.entries(row.inputs ?? {}).every(([key, expected]) => sameValue(expected, params[key])));
  }
  let best: PriceRow | undefined;
  let bestScore = -1;
  for (const row of rows) {
    let score = 0;
    let valid = true;
    for (const [key, expected] of Object.entries(row.inputs ?? {})) {
      const quantity = quantityOf(expected);
      if (quantity === null ? !sameValue(expected, params[key]) : quantity > countOf(params[key])) {
        valid = false;
        break;
      }
      score += quantity ?? 0;
    }
    if (valid && score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// One row's price and sentence.

function countParam(params: Record<string, unknown>): number {
  for (const key of ['n', 'numberOfImages', 'numImages', 'numOutputs', 'numberOfOutputs', 'count', 'batchSize', 'numberOfVideos']) {
    const value = Number(params[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 1;
}

function durationParam(params: Record<string, unknown>): number | undefined {
  for (const key of ['duration', 'durationSeconds', 'length', 'seconds', 'videoLength', 'videoDuration']) {
    const value = Number(params[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function rowNote(row: PriceRow): string | undefined {
  const note = typeof row.note === 'string' ? row.note.replace(/\s+/g, ' ').trim() : '';
  return note || undefined;
}

function seconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function pixelSentence(row: PriceRow): string {
  const extra = positive(row.priceExtra);
  const input = hasQuantity(row) && Object.values(row.inputs ?? {}).some(value => (quantityOf(value) ?? 0) >= 1) ? positive(row.priceInput) : undefined;
  let text = `${formatUsd(Number(row.price) || 0)} for an output image up to ${PIXEL_BLOCK} pixels`;
  if (extra) text += `, plus ${formatUsd(extra)} for each further ${PIXEL_BLOCK} block`;
  if (input) text += `, plus ${formatUsd(input)} per ${PIXEL_BLOCK} block of each input image, at most 4 blocks per image`;
  return `${text}.`;
}

function runTimeQuote(model: ModelSummary, sentence: string, scale = 1): PriceQuote {
  const listed = positive(model.estimatedCostUsd);
  const estimate = listed === undefined ? undefined : listed * scale;
  return estimate !== undefined
    ? { amount: estimate, approximate: true, label: `about ${formatUsd(estimate)}`, note: `${sentence} Past runs averaged ${formatUsd(estimate)}.` }
    : { approximate: true, label: 'by run time', note: sentence };
}

function rowQuote(row: PriceRow, model: ModelSummary, params: Record<string, unknown>, context: QuoteContext): PriceQuote {
  const price = Number(row.price) || 0;
  const note = rowNote(row);
  const say = (sentence: string): string => note ?? sentence;

  switch (row.priceMethod) {
    case 'cpr':
      if (price === 0) return { amount: 0, approximate: false, label: 'Free', note: say('Free to run right now.') };
      return { amount: price, approximate: false, label: formatUsd(price), note: say(`Running this model on Wiro costs ${formatUsd(price)} in total.`) };
    case 'cpo': {
      if (price === 0) return { amount: 0, approximate: false, label: 'Free', note: say('Free to run right now.') };
      const count = countParam(params);
      const amount = price * count;
      return {
        amount,
        approximate: false,
        label: formatUsd(amount),
        note: say(count > 1
          ? `Your request will cost ${formatUsd(price)} per output, ${formatUsd(amount)} for ${count} outputs.`
          : `Your request will cost ${formatUsd(price)} per output.`),
      };
    }
    case 'cp-promptlength': {
      const chars = context.promptChars ?? 0;
      if (chars === 0) return { approximate: true, label: `${formatUsd(price)} / character`, note: say(`Your request will cost ${formatUsd(price)} per character in prompt.`) };
      const amount = price * chars;
      return { amount, approximate: false, label: formatUsd(amount), note: say(`Your request will cost ${formatUsd(amount)} for ${chars.toLocaleString('en-US')} characters in prompt.`) };
    }
    case 'cp-audiosecondslength': {
      const length = context.mediaSeconds;
      if (length === undefined) return { approximate: true, label: `${formatUsd(price)} / audio second`, note: say(`Your request will cost ${formatUsd(price)} per second of audio length.`) };
      const amount = price * length;
      return { amount, approximate: true, label: `about ${formatUsd(amount)}`, note: say(`Your request will cost ${formatUsd(amount)} for ${seconds(length)} seconds of audio.`) };
    }
    case 'cp-outputVideoLength': {
      const length = durationParam(params);
      if (length === undefined) return { approximate: true, label: `${formatUsd(price)} / video second`, note: say(`Your request will cost ${formatUsd(price)} per second of video.`) };
      const amount = price * length;
      return { amount, approximate: false, label: formatUsd(amount), note: say(`Your request will cost ${formatUsd(amount)} for ${seconds(length)} seconds of video, ${formatUsd(price)} per second.`) };
    }
    case 'cp-pixel':
      return { amount: price, approximate: true, label: `from ${formatUsd(price)}`, note: say(pixelSentence(row)) };
    case 'cps':
      return { approximate: true, label: `${formatUsd(price)} / second`, note: say(`Your request will cost ${formatUsd(price)} per second. ${VARIES}`) };
    case 'cpt':
      return { approximate: true, label: 'by tokens', note: say(`${formatUsd(price)} per input and output token. The total is known when the run ends.`) };
    case 'cp-readoutput':
      return price > 0
        ? { amount: price, approximate: true, label: `about ${formatUsd(price)}`, note: say('The exact charge shows when the run ends.') }
        : { approximate: true, label: 'set when it ends', note: say('The exact charge shows when the run ends.') };
    case 'cp-realtimeturn':
      return { approximate: true, label: 'live, per turn', note: note ? `Billed turn by turn during a live session. ${note}` : 'Billed turn by turn during a live session.' };
    default:
      return runTimeQuote(model, RUN_TIME);
  }
}

// ---------------------------------------------------------------------------
// The "All prices" list, like the model page's pricing options.

const UNITS: Record<string, string> = {
  cpr: 'run',
  cpo: 'output',
  cps: 'second',
  cpt: 'token',
  'cp-promptlength': 'character',
  'cp-audiosecondslength': 'audio second',
  'cp-outputVideoLength': 'video second',
};

function rowPriceText(row: PriceRow): string {
  const price = Number(row.price) || 0;
  if (row.priceMethod === 'cp-realtimeturn') return 'per turn';
  if (row.priceMethod === 'cp-readoutput') return price > 0 ? `about ${formatUsd(price)}` : 'set when it ends';
  if (row.priceMethod === 'cp-pixel') return `from ${formatUsd(price)} / image`;
  const unit = UNITS[row.priceMethod];
  if (!unit) return 'by run time';
  if (price === 0 && (row.priceMethod === 'cpr' || row.priceMethod === 'cpo')) return 'Free';
  return `${formatUsd(price)} / ${unit}`;
}

function paramIndex(model: ModelDetail): Map<string, ModelParameter> {
  const items = new Map<string, ModelParameter>();
  for (const group of model.parameters ?? []) for (const item of group.items ?? []) items.set(item.id, item);
  return items;
}

function keyLabel(key: string, param?: ModelParameter): string {
  if (param?.label && param.label !== key) return param.label;
  return key.replace(/([A-Z])/g, ' $1').replace(/[_-]+/g, ' ').replace(/^./, s => s.toUpperCase()).trim();
}

function priceOptions(model: ModelDetail, rows: PriceRow[], current: PriceRow | undefined): PriceOption[] | undefined {
  if (rows.length < 2) return undefined;
  const params = paramIndex(model);
  const quantities = new Map<string, number[]>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.inputs ?? {})) {
      const count = quantityOf(value);
      if (count !== null) quantities.set(key, [...(quantities.get(key) ?? []), count]);
    }
  }
  const valueLabel = (key: string, value: unknown): string => {
    const count = quantityOf(value);
    if (count === null) {
      const option = params.get(key)?.options.find(item => sameValue(value, item.value));
      return option?.label || String(value);
    }
    const known = [...new Set(quantities.get(key) ?? [])].sort((a, b) => a - b);
    if (count === 0) return 'No';
    if (known.length === 2 && known[0] === 0 && known[1] === 1) return 'Yes';
    return count === known[known.length - 1] ? `${count} or more` : String(count);
  };
  return rows.map(row => ({
    conditions: Object.entries(row.inputs ?? {}).map(([key, value]) => `${keyLabel(key, params.get(key))}: ${valueLabel(key, value)}`),
    price: rowPriceText(row),
    note: rowNote(row),
    current: row === current,
  }));
}

// ---------------------------------------------------------------------------

// A discount scales every price of the model, as the model page shows it: the
// sentence, the button and the "All prices" list carry the new amounts, and the
// list price is shown struck through beside the new one.
function scaleRow(row: PriceRow, scale: number): PriceRow {
  if (scale === 1) return row;
  const times = (value: unknown): number | undefined => (value === undefined || value === null ? undefined : Number(value) * scale);
  return { ...row, price: Number(row.price) * scale, priceExtra: times(row.priceExtra), priceInput: times(row.priceInput) };
}

function quoteAt(model: ModelDetail, params: Record<string, unknown>, context: QuoteContext, scale: number): PriceQuote {
  const rows = (model.priceList ?? []).filter(row => row && typeof row === 'object');
  if (rows.length === 0) return summaryQuote(model, params, context, scale);

  if (rows.some(row => row.priceMethod === 'cp-realtimeturn')) {
    const live = rows.find(row => row.priceMethod === 'cp-realtimeturn') as PriceRow;
    return rowQuote({ ...live, note: rows.map(rowNote).find(Boolean) }, model, params, context);
  }
  const row = matchingRow(rows, params);
  const scaled = rows.map(item => scaleRow(item, scale));
  const current = row ? scaled[rows.indexOf(row)] : undefined;
  const result = current ? rowQuote(current, model, params, context) : runTimeQuote(model, RUN_TIME, scale);
  return { ...result, options: priceOptions(model, scaled, current) };
}

export function quote(model: ModelDetail, params: Record<string, unknown>, context: QuoteContext = {}): PriceQuote {
  const percent = positive(model.discountPercent);
  const list = quoteAt(model, params, context, 1);
  if (percent === undefined || percent > 100) return list;
  const offer = quoteAt(model, params, context, 1 - percent / 100);
  if (list.amount === undefined || list.amount === 0 || offer.amount === undefined) return { ...offer, discountPercent: percent };
  return { ...offer, discountPercent: percent, listAmount: list.amount, listLabel: list.label };
}

const SUMMARY_METHODS: Array<[RegExp, string]> = [
  [/^per request\b/i, 'cpr'],
  [/^per output\b/i, 'cpo'],
  [/^per prompt character\b/i, 'cp-promptlength'],
  [/^per video second\b/i, 'cp-outputVideoLength'],
  [/^per second of audio\b/i, 'cp-audiosecondslength'],
];

/**
 * Without price rows: the price summary from search_models or get_model_schema
 * (Wiro-MCP formatPricing), and the notes of the model's rows.
 */
export function summaryQuote(model: ModelSummary & { pricingNotes?: string[] }, params: Record<string, unknown> = {}, context: QuoteContext = {}, scale = 1): PriceQuote {
  const text = (model.pricing ?? '').replace(/\s+/g, ' ').trim();
  const notes = model.pricingNotes ?? [];
  const onlyNote = notes.length === 1 ? notes[0] : undefined;
  const estimateListed = positive(model.estimatedCostUsd);
  const estimate = estimateListed === undefined ? undefined : estimateListed * scale;
  const usd = (value: string | undefined): number => Number(value) * scale;

  // "$0.2 / per request", "$0.00004 / per prompt character. Every character…"
  const single = /^\$([0-9.]+(?:e-?\d+)?) \/ (per [a-z ]+)/i.exec(text);
  if (single) {
    const unit = single[2] ?? '';
    const method = SUMMARY_METHODS.find(([pattern]) => pattern.test(unit))?.[1];
    if (method) return rowQuote({ price: usd(single[1]), priceMethod: method, note: onlyNote }, model, params, context);
  }
  const range = /^\$([0-9.]+(?:e-?\d+)?) to \$([0-9.]+(?:e-?\d+)?) \/ per (request|output|video second)/i.exec(text);
  if (range) {
    const low = usd(range[1]);
    const unit = range[3] === 'request' ? 'run' : range[3];
    return { amount: low, approximate: true, label: `from ${formatUsd(low)}`, note: onlyNote ?? `From ${formatUsd(low)} to ${formatUsd(usd(range[2]))} per ${unit}, depending on the settings.` };
  }
  const estimated = /^~\$([0-9.]+(?:e-?\d+)?) per run/i.exec(text);
  if (estimated) {
    const amount = usd(estimated[1]);
    return { amount, approximate: true, label: `about ${formatUsd(amount)}`, note: `Running this model on Wiro costs approximately ${formatUsd(amount)} in total. ${VARIES}` };
  }
  const rate = /^\$([0-9.]+(?:e-?\d+)?) per second of run time/i.exec(text);
  if (rate) {
    const perSecond = formatUsd(usd(rate[1]));
    return estimate !== undefined
      ? { amount: estimate, approximate: true, label: `about ${formatUsd(estimate)}`, note: `Your request will cost ${perSecond} per second, about ${formatUsd(estimate)} in total. ${VARIES}` }
      : { approximate: true, label: `${perSecond} / second`, note: `Your request will cost ${perSecond} per second. ${VARIES}` };
  }
  if (/^per second of run time|^no fixed price/i.test(text)) return runTimeQuote(model, RUN_TIME, scale);
  if (/^set by the run/i.test(text)) {
    const listed = /listed estimate \$([0-9.]+)/i.exec(text);
    const amount = listed ? usd(listed[1]) : estimate;
    const rates = /^set by the run when it ends(?: \([^)]*\))?: (.+)$/i.exec(text)?.[1];
    const note = rates ?? onlyNote ?? 'The exact charge shows when the run ends.';
    return amount !== undefined
      ? { amount, approximate: true, label: `about ${formatUsd(amount)}`, note }
      : { approximate: true, label: 'set when it ends', note };
  }
  if (isLiveModel(model)) return { approximate: true, label: 'live, per turn', note: text };
  const pixel = /^\$([0-9.]+(?:e-?\d+)?)(?: to \$[0-9.]+(?:e-?\d+)?)? per run for an output image/i.exec(text);
  if (pixel) {
    const amount = usd(pixel[1]);
    return { amount, approximate: true, label: `from ${formatUsd(amount)}`, note: onlyNote ?? `${(text.split(/\. Pixels are counted/i)[0] ?? text).replace(/\.$/, '')}.` };
  }
  if (estimate !== undefined) {
    return { amount: estimate, approximate: true, label: `about ${formatUsd(estimate)}`, note: `Running this model on Wiro costs approximately ${formatUsd(estimate)} in total. ${VARIES}` };
  }
  return { approximate: true, label: shortPricing(model), note: onlyNote ?? (text || undefined) };
}
