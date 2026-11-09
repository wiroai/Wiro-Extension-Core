import type { MediaKind, ModelDetail, ModelParameter } from '../types.js';

// The unified gateway. Models in one category name their parameters
// differently (inputImage, inputImageHuman, first_frame_image; duration,
// durationSeconds; resolution, quality). This module reads a model's schema,
// finds the common slots in it, and maps one set of common values onto the
// model's own parameter names. Whatever is left stays model specific and is
// shown under "More settings" with the model's defaults.

export type SlotName =
  | 'prompt' | 'negativePrompt' | 'duration' | 'resolution' | 'ratio'
  | 'count' | 'voice' | 'language' | 'sourceLanguage' | 'url';

export interface FileSlot {
  param: ModelParameter;
  kind: MediaKind;
  /** single: one URL; list: an array of URLs; multiple: comma-separated URLs in a paired text field. */
  mode: 'single' | 'list' | 'multiple';
  /** For `multiple`: the text field that takes the comma-separated URLs. */
  urlParam?: ModelParameter;
}

export interface ModelSlots {
  files: FileSlot[];
  named: Partial<Record<SlotName, ModelParameter>>;
  /** Parameters that are neither files nor named slots, in schema order. */
  rest: ModelParameter[];
}

/** One set of values the panel keeps across models of a category. */
export interface CommonValues {
  /** URLs by file kind, in the order the user added them. The clicked item comes first. */
  files: Partial<Record<MediaKind, string[]>>;
  prompt?: string;
  negativePrompt?: string;
  duration?: string;
  resolution?: string;
  ratio?: string;
  count?: string;
  voice?: string;
  language?: string;
  sourceLanguage?: string;
  url?: string;
}

const SLOT_PATTERNS: Array<[SlotName, RegExp]> = [
  ['negativePrompt', /^(negative_?prompt|negative)$/i],
  ['prompt', /^(prompt|text|script|lyrics|caption|captions|instruction|instructions|query|question|message|userprompt|user_prompt|inputtext|input_text)$/i],
  ['duration', /^(duration|durationseconds|duration_seconds|length|seconds|videolength|video_length|videoduration|clipduration)$/i],
  ['resolution', /^(resolution|quality|size|imagesize|image_size|outputresolution|output_resolution|outputsize|res|target)$/i],
  ['ratio', /^(ratio|aspectratio|aspect_ratio|aspect)$/i],
  ['count', /^(n|numberofimages|number_of_images|numimages|num_images|numoutputs|num_outputs|numberofoutputs|count|batchsize|batch_size|numberofvideos)$/i],
  ['voice', /^(voice|voiceid|voice_id|speaker|voicename|voice_name)$/i],
  ['sourceLanguage', /^(sourcelng|sourcelanguage|source_language|source_lang|sourcelang)$/i],
  ['language', /^(language|languagecode|language_code|targetlng|targetlanguage|target_language|target_lang|lang)$/i],
  ['url', /^(websiteurl|website_url|url|pageurl|page_url|youtubeurl|youtube_url|link|videourlyoutube)$/i],
];

const FILE_TYPES = new Set(['fileinput', 'combinefileinput', 'multifileinput']);

export function allParams(model: ModelDetail): ModelParameter[] {
  return (model.parameters ?? []).flatMap(group => group.items ?? []);
}

export function isFileParam(param: ModelParameter): boolean {
  return FILE_TYPES.has(param.type.toLowerCase());
}

/** The kind of file a file parameter takes, from its id, label and note. */
export function fileKind(param: ModelParameter): MediaKind {
  const text = `${param.id} ${param.label} ${param.placeholder ?? ''}`.toLowerCase();
  if (/video|clip|mp4|footage/.test(text)) return 'video';
  if (/audio|voice|speech|song|music|sound|mp3|wav|vocal/.test(text)) return 'audio';
  if (/image|photo|picture|face|portrait|frame|logo|mask|garment|cloth|human|person|product|reference|selfie|avatar|style/.test(text)) return 'image';
  return 'file';
}

export function slotsFor(model: ModelDetail): ModelSlots {
  const params = allParams(model);
  const files: FileSlot[] = [];
  const named: Partial<Record<SlotName, ModelParameter>> = {};
  const used = new Set<string>();

  for (const param of params) {
    if (!isFileParam(param)) continue;
    const type = param.type.toLowerCase();
    const slot: FileSlot = { param, kind: fileKind(param), mode: type === 'combinefileinput' ? 'list' : type === 'multifileinput' ? 'multiple' : 'single' };
    if (slot.mode === 'multiple') {
      slot.urlParam = params.find(candidate => candidate.id.toLowerCase() === urlMultipleId(param.id).toLowerCase());
      if (slot.urlParam) used.add(slot.urlParam.id);
    }
    files.push(slot);
    used.add(param.id);
  }
  // A text field that only repeats a file field as a URL (inputImage + inputImageUrl) is not shown:
  // the file field itself takes URLs.
  for (const slot of files) {
    const twin = params.find(candidate => candidate.id.toLowerCase() === `${slot.param.id}url`.toLowerCase());
    if (twin) used.add(twin.id);
  }

  for (const [name, pattern] of SLOT_PATTERNS) {
    if (named[name]) continue;
    const param = params.find(candidate => !used.has(candidate.id) && pattern.test(candidate.id));
    if (param) {
      named[name] = param;
      used.add(param.id);
    }
  }
  // No field named like a prompt: the first required text area is the prompt.
  if (!named.prompt) {
    const textarea = params.find(candidate => !used.has(candidate.id) && candidate.type.toLowerCase() === 'textarea' && candidate.required);
    if (textarea) {
      named.prompt = textarea;
      used.add(textarea.id);
    }
  }
  return { files, named, rest: params.filter(param => !used.has(param.id)) };
}

/** `inputDocumentMultiple` → `inputDocumentUrlMultiple`. */
function urlMultipleId(id: string): string {
  return /Multiple$/.test(id) ? id.replace(/Multiple$/, 'UrlMultiple') : `${id}UrlMultiple`;
}

/** Whether the model can take what the user clicked. */
export function acceptsInput(model: ModelDetail, input: MediaKind | 'text' | 'url'): boolean {
  const slots = slotsFor(model);
  if (input === 'text') return Boolean(slots.named.prompt);
  if (input === 'url') return Boolean(slots.named.url);
  return slots.files.some(slot => slot.kind === input || (input !== 'file' && slot.kind === 'file' && slot.mode !== 'multiple'));
}

/** The file slot the clicked item goes to: the first required one of its kind, else the first of its kind. */
export function primarySlot(slots: ModelSlots, kind: MediaKind): FileSlot | undefined {
  const ofKind = slots.files.filter(slot => slot.kind === kind);
  return ofKind.find(slot => slot.param.required) ?? ofKind[0] ?? slots.files.find(slot => slot.kind === 'file');
}

/** Fits a value to what the parameter accepts: the nearest option, or the min/max range. */
export function fitValue(param: ModelParameter, value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (param.options.length > 0) {
    if (param.options.some(option => option.value === value)) return value;
    const numeric = Number(value);
    const numericOptions = param.options.map(option => Number(option.value));
    if (Number.isFinite(numeric) && numericOptions.every(Number.isFinite)) {
      let best = 0;
      numericOptions.forEach((option, index) => {
        if (Math.abs(option - numeric) < Math.abs((numericOptions[best] ?? Infinity) - numeric)) best = index;
      });
      return param.options[best]?.value;
    }
    const lower = value.toLowerCase();
    return param.options.find(option => option.value.toLowerCase() === lower || option.label.toLowerCase() === lower)?.value;
  }
  const type = param.type.toLowerCase();
  if (type === 'number' || type === 'float') {
    let numeric = Number(value);
    if (!Number.isFinite(numeric)) return undefined;
    if (param.min !== undefined) numeric = Math.max(param.min, numeric);
    if (param.max !== undefined) numeric = Math.min(param.max, numeric);
    return String(numeric);
  }
  return value;
}

/**
 * The params object for run_model: common values mapped onto this model's
 * names, then the model-specific values. Empty fields are left out, so the
 * model's defaults apply (Wiro fills them).
 */
export function buildParams(model: ModelDetail, common: CommonValues, specific: Record<string, string | boolean> = {}): Record<string, unknown> {
  const slots = slotsFor(model);
  const params: Record<string, unknown> = {};

  // Required file fields first, so an optional one (a last frame) never takes the only image.
  const ordered = orderedFileSlots(slots);
  for (const { slot, position } of fileFieldPositions(slots)) {
    let pool = common.files[slot.kind] ?? [];
    // A field of unknown kind takes the clicked media when the model has no field of that kind.
    if (slot.kind === 'file' && !pool.some(Boolean)) {
      const kind = (['image', 'video', 'audio'] as MediaKind[]).find(candidate =>
        !ordered.some(other => other.kind === candidate) && (common.files[candidate] ?? []).some(Boolean));
      if (kind) pool = common.files[kind] ?? [];
    }
    // A list field takes every URL only when it is the model's one field of that kind
    // (reference images); with first and last frame fields, each takes its own.
    const alone = ordered.filter(other => other.kind === slot.kind).length === 1;
    const picked = pool[position];
    const urls = slot.mode !== 'single' && alone ? pool.filter(Boolean) : (picked ? [picked] : []);
    if (urls.length === 0) continue;
    if (slot.mode === 'single') params[slot.param.id] = urls[0];
    else if (slot.mode === 'list') params[slot.param.id] = urls;
    else if (slot.urlParam) params[slot.urlParam.id] = urls.join(',');
  }

  const set = (name: SlotName, value: string | undefined) => {
    const param = slots.named[name];
    if (!param) return;
    const fitted = name === 'prompt' || name === 'negativePrompt' || name === 'url' ? (value?.trim() || undefined) : fitValue(param, value);
    if (fitted !== undefined) params[param.id] = fitted;
  };
  set('prompt', common.prompt);
  set('negativePrompt', common.negativePrompt);
  set('duration', common.duration);
  set('resolution', common.resolution);
  set('ratio', common.ratio);
  set('count', common.count);
  set('voice', common.voice);
  set('language', common.language);
  set('sourceLanguage', common.sourceLanguage);
  set('url', common.url);

  for (const param of slots.rest) {
    const value = specific[param.id];
    if (value === undefined || value === '') continue;
    if (param.type.toLowerCase() === 'checkbox') {
      if (value === true) params[param.id] = param.default || param.sample || 'true';
      continue;
    }
    const fitted = fitValue(param, String(value));
    if (fitted !== undefined) params[param.id] = fitted;
  }
  return params;
}

/** File fields in the order URLs are handed out: required ones first, then schema order. */
export function orderedFileSlots(slots: ModelSlots): FileSlot[] {
  return [...slots.files].sort((a, b) => Number(b.param.required) - Number(a.param.required));
}

/** Each file field with its position among the fields of its kind: CommonValues.files[kind][position]. */
export function fileFieldPositions(slots: ModelSlots): Array<{ slot: FileSlot; position: number }> {
  const counters: Partial<Record<MediaKind, number>> = {};
  return orderedFileSlots(slots).map(slot => {
    const position = counters[slot.kind] ?? 0;
    counters[slot.kind] = position + 1;
    return { slot, position };
  });
}

/** What is still missing before the model can run. */
export function missingInputs(model: ModelDetail, params: Record<string, unknown>): ModelParameter[] {
  const slots = slotsFor(model);
  return allParams(model).filter(param => {
    if (!param.required) return false;
    if (param.default !== undefined && param.default !== '') return false;
    const fileSlot = slots.files.find(slot => slot.param.id === param.id);
    if (fileSlot?.mode === 'multiple' && fileSlot.urlParam) return !params[fileSlot.urlParam.id];
    const value = params[param.id];
    return value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
  });
}
