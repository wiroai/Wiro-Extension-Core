// Shapes shared by the background script and the panel. The Wiro shapes mirror
// the structured output of the Wiro MCP tools (@wiro-ai/wiro-mcp).

/** What the user right-clicked. */
export type ContentKind = 'image' | 'video' | 'audio' | 'selection' | 'page';

/** The file kinds a model parameter can take. */
export type MediaKind = 'image' | 'video' | 'audio' | 'file';

/** One right-click, handed from the background script to the panel. */
export interface Job {
  id: string;
  kind: ContentKind;
  /** The catalog action the user picked, or undefined for "More actions". */
  actionId?: string;
  /** The image, video or audio URL (srcUrl), or the link URL. */
  url?: string;
  /** The page the click happened on. */
  pageUrl?: string;
  pageTitle?: string;
  /** Selected text. */
  text?: string;
  createdAt: number;
}

/** A row of search_models. */
export interface ModelSummary {
  slug: string;
  title: string;
  description?: string;
  categories: string[];
  pricing?: string;
  estimatedCostUsd?: number | null;
  discountPercent?: number;
}

export interface ModelParameter {
  id: string;
  type: string;
  label: string;
  description?: string;
  default?: string;
  sample?: string;
  required: boolean;
  placeholder?: string;
  note?: string;
  options: Array<{ label: string; value: string }>;
  min?: number;
  max?: number;
  step?: number;
  advanced: boolean;
}

/** One row of a model's price list, as Wiro stores it (dynamicprice). */
export interface PriceRow {
  price: number;
  priceMethod: string;
  inputs?: Record<string, unknown>;
  note?: string;
  priceExtra?: number;
  priceInput?: number;
}

/** get_model_schema → model. `priceList` appears once Wiro-MCP returns raw rows. */
export interface ModelDetail extends ModelSummary {
  pricingNotes?: string[];
  parameters: Array<{ title: string; items: ModelParameter[] }>;
  priceList?: PriceRow[];
  /** Seconds a run usually takes, for models billed by run time. */
  averageSeconds?: number;
}

export type TaskState = 'submitted' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskOutput {
  name?: string;
  mimeType: string;
  sizeBytes: number | null;
  url?: string;
  kind: 'image' | 'video' | 'audio' | 'text' | 'file';
  text?: string;
}

export interface TaskReference {
  id?: string;
  token?: string;
  model?: string;
  status?: string;
  durationSeconds?: number | null;
  costUsd?: number | null;
  chargedUsd?: number | null;
}

export interface NextAction {
  tool: string;
  arguments: Record<string, unknown>;
  reason: string;
}

export interface TaskResult {
  state: TaskState;
  task: TaskReference;
  outputs: TaskOutput[];
  response?: string;
  error?: string;
  nextAction?: NextAction;
}

export interface Account {
  workspace: { kind: 'personal' | 'team' | 'unknown'; teamName?: string; organizationName?: string; role?: 'admin' | 'member' };
  balance: { currency: 'USD'; totalUsd: number; depositUsd: number; couponCreditUsd: number; storeRevenueUsd: number } | null;
}

export interface StudioRun {
  id: string;
  model?: string;
  modelTitle?: string;
  status: string;
  state: 'running' | 'completed' | 'failed' | 'cancelled';
  outputs: Array<{ url: string; name?: string; mimeType?: string; sizeBytes?: number | null }>;
  text?: string;
  costUsd?: number | null;
}

export interface AgentTurn {
  agent: string;
  session: string;
  done: boolean;
  message: {
    messageId: string;
    state: string;
    status: string;
    reply?: string;
    mediaUrls: string[];
    creditsUsed?: number | null;
  };
  partialReply?: string;
  llmCostUsd?: number | null;
  modelRuns?: StudioRun[];
  modelRunsPending?: boolean;
  notes: string[];
  nextAction?: NextAction;
}

/** An item kept in the tray to combine later. */
export interface TrayItem {
  id: string;
  kind: MediaKind | 'text';
  url?: string;
  text?: string;
  title: string;
  from?: string;
  addedAt: number;
}

/** A finished run, kept locally for the History view. */
export interface HistoryEntry {
  id: string;
  model: string;
  modelTitle?: string;
  actionLabel?: string;
  outputs: TaskOutput[];
  chargedUsd?: number | null;
  at: number;
}
