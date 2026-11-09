import { MCP_PROTOCOL_VERSION } from '../config.js';
import { sseJsonMessages } from '../util/sse.js';

// A small MCP client for the stateless Streamable HTTP endpoint at
// mcp.wiro.ai/v1. Every call is one POST of a JSON-RPC `tools/call`; the server
// answers with JSON or with a short SSE stream that ends after the result.

export class AuthRequiredError extends Error {
  constructor(message = 'Sign in to Wiro to continue.') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export class McpError extends Error {
  constructor(message: string, readonly code?: number | string, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = 'McpError';
  }
}

export interface ToolResult<T> {
  /** structuredContent, when the tool returns it. */
  structured?: T;
  /** The text content blocks joined, for errors and tools without structured output. */
  text: string;
  isError: boolean;
}

export interface TokenSource {
  /** A valid access token, refreshed when needed, or undefined when signed out. */
  accessToken(): Promise<string | undefined>;
  /** Called after a 401: refresh once and say whether a retry makes sense. */
  recoverFromUnauthorized(): Promise<boolean>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  error?: { code: number; message: string; data?: unknown };
}

export class McpClient {
  private nextId = 1;

  constructor(
    private readonly endpoint: string,
    private readonly tokens: TokenSource,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  async callTool<T = unknown>(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult<T>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.tokens.accessToken();
      if (!token) throw new AuthRequiredError();
      const id = this.nextId++;
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
        signal,
      });
      if (response.status === 401) {
        if (attempt === 0 && await this.tokens.recoverFromUnauthorized()) continue;
        throw new AuthRequiredError();
      }
      if (response.status === 429) {
        const retry = Number(response.headers.get('Retry-After')) || undefined;
        throw new McpError('Too many requests to Wiro. Wait a moment and try again.', 429, retry);
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new McpError(errorText(body) || `Wiro answered ${response.status}.`, response.status);
      }
      const message = await readMessage(response, id);
      if (message.error) throw new McpError(message.error.message, message.error.code);
      const result = message.result ?? {};
      const text = (result.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join('\n');
      return { structured: result.structuredContent as T | undefined, text, isError: result.isError === true };
    }
    throw new AuthRequiredError();
  }
}

async function readMessage(response: Response, id: number): Promise<JsonRpcResponse> {
  const type = response.headers.get('Content-Type') ?? '';
  const body = await response.text();
  const messages: unknown[] = type.includes('text/event-stream') ? sseJsonMessages(body) : [safeJson(body)];
  for (const message of messages) {
    const candidate = message as JsonRpcResponse | undefined;
    if (candidate && candidate.jsonrpc === '2.0' && candidate.id === id) return candidate;
  }
  throw new McpError('Wiro sent an answer the extension could not read.');
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function errorText(body: string): string {
  const parsed = safeJson(body) as { error?: unknown; error_description?: unknown } | undefined;
  if (parsed && typeof parsed.error === 'string') return parsed.error;
  if (parsed && typeof parsed.error_description === 'string') return parsed.error_description;
  return '';
}
