import { WAIT_SECONDS } from '../config.js';
import { McpError, type McpClient } from '../mcp/client.js';
import type { Account, AgentTurn, ModelDetail, ModelSummary, TaskResult } from '../types.js';

// The Wiro MCP tools the extension uses, with the structured output each one
// returns. A tool error (isError) becomes an exception with the tool's message.

export class WiroToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WiroToolError';
  }
}

function cleanToolText(text: string): string {
  return text.replace(/^#+\s*Error\s*/i, '').trim() || 'Wiro could not do that.';
}

export interface SearchOptions {
  categories?: string[];
  search?: string;
  sort?: 'relevance' | 'time' | 'ratedusercount' | 'commentcount' | 'averagepoint';
  start?: number;
  limit?: number;
}

export class WiroApi {
  constructor(private readonly mcp: McpClient) {}

  private async call<T>(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const result = await this.mcp.callTool<T>(name, args, signal);
    if (result.isError) throw new WiroToolError(cleanToolText(result.text));
    if (result.structured === undefined) throw new McpError(`${name} returned no data.`);
    return result.structured;
  }

  async searchModels(options: SearchOptions, signal?: AbortSignal): Promise<{ models: ModelSummary[]; total: number; nextStart: number | null }> {
    const args: Record<string, unknown> = { limit: options.limit ?? 100, start: options.start ?? 0, sort: options.sort ?? 'relevance' };
    if (options.categories?.length) args['categories'] = options.categories;
    if (options.search) args['search'] = options.search;
    return this.call('search_models', args, signal);
  }

  async getModel(slug: string, signal?: AbortSignal): Promise<ModelDetail> {
    const result = await this.call<{ model: ModelDetail }>('get_model_schema', { model: slug }, signal);
    return result.model;
  }

  /** Starts a run and waits a bounded time. A pending result carries nextAction. */
  runModel(model: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<TaskResult> {
    return this.call('run_model', { model, params, wait: true, timeout_seconds: WAIT_SECONDS }, signal);
  }

  waitForTask(tasktoken: string, signal?: AbortSignal): Promise<TaskResult> {
    return this.call('wait_for_task', { tasktoken, timeout_seconds: WAIT_SECONDS }, signal);
  }

  getTask(tasktoken: string, signal?: AbortSignal): Promise<TaskResult> {
    return this.call('get_task', { tasktoken }, signal);
  }

  async cancelTask(tasktoken: string): Promise<void> {
    await this.mcp.callTool('cancel_task', { tasktoken });
  }

  getAccount(signal?: AbortSignal): Promise<Account> {
    return this.call('get_account', {}, signal);
  }

  listTasks(limit = 20, signal?: AbortSignal): Promise<{ tasks: Array<{ state: string; task: TaskResult['task']; outputs: TaskResult['outputs'] }> }> {
    return this.call('list_tasks', { limit }, signal);
  }

  /**
   * Runs a model to the end: one run_model call, then wait_for_task calls while
   * the task is still going. `onUpdate` sees every intermediate state. The
   * original request is never sent twice: that would start and bill a second run.
   */
  async runToEnd(model: string, params: Record<string, unknown>, onUpdate: (result: TaskResult) => void, signal?: AbortSignal): Promise<TaskResult> {
    let result = await this.runModel(model, params, signal);
    onUpdate(result);
    while (!isTerminal(result.state)) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      const token = result.task.token ?? stringArg(result.nextAction?.arguments['tasktoken']);
      if (!token) throw new WiroToolError('The task started but Wiro did not send its token. It is in History once it ends.');
      result = await this.waitForTask(token, signal);
      onUpdate(result);
    }
    return result;
  }

  /** Sends one message to Wiro Studio. Every call is a new billed turn. */
  sendToStudio(message: string, attachmentUrls: string[] = [], session?: string, signal?: AbortSignal): Promise<AgentTurn> {
    const args: Record<string, unknown> = { agent: 'studio', message, wait_seconds: WAIT_SECONDS };
    if (attachmentUrls.length) args['attachment_urls'] = attachmentUrls.slice(0, 8);
    if (session) args['session'] = session;
    return this.call('send_agent_message', args, signal);
  }

  getStudioMessage(messageId: string, session: string, signal?: AbortSignal): Promise<AgentTurn> {
    return this.call('get_agent_message', { agent: 'studio', message_id: messageId, session, wait_seconds: WAIT_SECONDS }, signal);
  }
}

export function isTerminal(state: string): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}
