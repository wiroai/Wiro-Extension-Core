import { describe, expect, it } from 'vitest';
import { readRefusal } from '../src/wiro/refusal.js';
import { toolError, WiroApi, WiroToolError } from '../src/wiro/api.js';
import { McpClient } from '../src/mcp/client.js';

// Tool errors as the hosted Wiro MCP server (@wiro-ai/wiro-mcp 1.9.0) sends them: Wiro's sentence, then the note it
// writes for AI assistants.
const KEY_RULE = 'This API key can\'t use Image Generation models, and ByteDance/seedream-5-5 is one of them. '
  + 'Model Access rules decide which models can run.';
const RUN_92 = `## Error\n\nFailed to run model: ${KEY_RULE} A Model Access rule of this workspace blocks this model, so nothing ran `
  + 'and nothing was charged. Do not try again, and do not work around the rule on your own, for example with another model. '
  + 'Tell the user which rule blocked the model (the refusal names it; check_model_access shows every rule that blocks it and '
  + 'why). The account owner, a team admin or the organization\'s owner can change the rule with manage_model_access after a '
  + 'change summary, or at https://wiro.ai/panel/controls/model-access, or the user can pick another model.';

const LEFT_LIMIT = 'The daily spend limit for the browser extensions has $3.10 left of $5.00, and this run costs $4.00. '
  + 'Runs in progress hold $1.20 of it. It resets at 00:00 UTC.';
const RUN_93_LEFT = `## Error\n\nFailed to run model: ${LEFT_LIMIT} A spend limit of this workspace has less left than this costs, so `
  + 'nothing ran and nothing was charged. The limit is not used up: cheaper work, such as a run at a lower resolution, a shorter '
  + 'length or fewer outputs, may fit what is left, but start it only with the user\'s yes. Work that is still running holds part '
  + 'of the limit. That part frees up when the work ends, and only what the work is charged counts, so this same work may fit '
  + 'then: try it again only after that work has ended, and only with the user\'s yes. Otherwise it stays refused until the '
  + 'limit resets or someone who can change it raises it (the account owner, a team admin or the organization\'s owner) on the '
  + 'Spend Limits page of the Wiro dashboard: https://wiro.ai/panel/controls/spend-limits. get_account lists the limits.';

const TEAM_LIMIT = 'This team\'s monthly spend limit is reached ($500.00 of $500.00). It resets on December 1, 2026 at 00:00 UTC.';
const STUDIO_93 = `## Error\n\n${TEAM_LIMIT}\n\nA spend limit of this workspace is used up, so nothing ran and nothing was charged. `
  + 'Do not try again until the limit resets or someone who can change it raises it (the account owner, a team admin or the '
  + 'organization\'s owner): get_controls shows the limit and when it resets, and manage_spend_limit changes it after the user '
  + 'confirms a change summary. Spend Limits page: https://wiro.ai/panel/controls/spend-limits.';

// Words for an assistant that a person should never read in the panel.
const ASSISTANT_WORDS = /\b(the user|do not|try again|get_account|get_controls|manage_\w+|check_model_access|tool)\b/i;

function fakeMcp(text: string): McpClient {
  return { callTool: async () => ({ text, isError: true }) } as unknown as McpClient;
}

describe('controls refusals', () => {
  it('keeps Wiro\'s sentence of a Model Access refusal and drops the assistant note', () => {
    const error = toolError(RUN_92);
    const refusal = error.refusal;
    expect(refusal?.code).toBe(92);
    expect(refusal?.message).toBe(KEY_RULE);
    expect(refusal?.path).toBe('/panel/controls/model-access');
    expect(refusal?.label).toBe('Open Model Access');
    // The panel never showed a key, so the line says which one it is.
    expect(refusal?.help).toBe('This extension runs with the API key of the project you chose when you signed in. '
      + 'Nothing was charged. The account owner, a team admin or the organization owner can change this rule on the Model Access page.');
    expect(error.message).not.toMatch(ASSISTANT_WORDS);
  });

  it('keeps the left, held and reset parts of a spend-limit refusal and offers a cheaper setting', () => {
    const error = toolError(RUN_93_LEFT);
    expect(error.refusal?.code).toBe(93);
    expect(error.refusal?.message).toBe(LEFT_LIMIT);
    expect(error.refusal?.path).toBe('/panel/controls/spend-limits');
    expect(error.refusal?.label).toBe('Open Spend Limits');
    expect(error.refusal?.help).toBe('Nothing was charged. A cheaper setting may fit what is left, or the account owner, a team admin '
      + 'or the organization owner can raise this limit on the Spend Limits page.');
    expect(error.message).toBe(`${LEFT_LIMIT} ${error.refusal?.help}`);
    expect(error.message).not.toMatch(ASSISTANT_WORDS);
  });

  it('reads a refused Studio message, whose note follows a blank line', () => {
    const error = toolError(STUDIO_93);
    expect(error.refusal?.code).toBe(93);
    expect(error.refusal?.message).toBe(TEAM_LIMIT);
    expect(error.refusal?.help).toBe('Nothing was charged. The account owner, a team admin or the organization owner can raise this '
      + 'limit on the Spend Limits page.');
    expect(error.message).not.toMatch(ASSISTANT_WORDS);
  });

  it('knows Wiro\'s own sentences when no note follows them', () => {
    const limit = readRefusal('Failed to run model: Your monthly spend limit in this team is reached ($10.00 of $10.00). '
      + 'It resets on December 1, 2026 at 00:00 UTC. Something else the server added.');
    expect(limit?.code).toBe(93);
    expect(limit?.message).toBe('Your monthly spend limit in this team is reached ($10.00 of $10.00). It resets on December 1, 2026 at 00:00 UTC.');
    const rule = readRefusal('Failed to run model: You can\'t use openai/sora-2 in this team. Model Access rules decide which models can run.');
    expect(rule?.code).toBe(92);
    expect(rule?.message).toBe('You can\'t use openai/sora-2 in this team. Model Access rules decide which models can run.');
    expect(rule?.help).not.toContain('API key');
  });

  it('leaves every other error as it came', () => {
    const text = '## Error\n\nFailed to run model: Insufficient balance. Add funds and try again.';
    expect(readRefusal(text)).toBeUndefined();
    const error = toolError(text);
    expect(error.refusal).toBeUndefined();
    expect(error.message).toBe('Failed to run model: Insufficient balance. Add funds and try again.');
  });

  it('throws the refusal from a refused run', async () => {
    const api = new WiroApi(fakeMcp(RUN_92));
    const failure = await api.runModel('bytedance/seedream-5-5', {}).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WiroToolError);
    expect((failure as WiroToolError).refusal?.code).toBe(92);
    expect((failure as WiroToolError).message.startsWith(KEY_RULE)).toBe(true);
    expect((failure as WiroToolError).message).not.toMatch(ASSISTANT_WORDS);
  });

  // Wiro names the work in a known-price refusal: a run, an agent purchase or a workflow.
  it.each(['run', 'purchase', 'workflow'])('offers a cheaper setting whatever the work is called (%s)', what => {
    const limit = `This team's monthly spend limit has $2.00 left of $50.00, and this ${what} costs $5.00. It resets on December 1, 2026 at 00:00 UTC.`;
    const refusal = readRefusal(`Failed to run model: ${limit}`);
    expect(refusal?.code).toBe(93);
    expect(refusal?.message).toBe(limit);
    expect(refusal?.help).toContain('A cheaper setting may fit what is left');
  });
});

// Wiro's own error items, as a Wiro MCP server attaches them to a tool error: _meta['ai.wiro/errors'] = [{ code, message }],
// the message being Wiro's sentence without the note for assistants.
const ERRORS_META = 'ai.wiro/errors';

// Wordings the extension does not know: neither the note's first words nor the endings of Wiro's sentences.
const NEW_LIMIT = 'This team\'s monthly spend cap is used up ($500.00 of $500.00). It opens again on December 1, 2026.';
const NEW_93 = `## Error\n\n${NEW_LIMIT}\n\nThe cap stopped this work. Do not try again; get_controls shows the cap.`;
const NEW_RULE = 'This API key may not run ByteDance/seedream-5-5.';
const NEW_92 = `## Error\n\nFailed to run model: ${NEW_RULE} Tell the user which rule blocked it, and do not run another model.`;

function fakeMcpWithMeta(text: string, meta: Record<string, unknown>): McpClient {
  return { callTool: async () => ({ text, isError: true, meta }) } as unknown as McpClient;
}

describe('controls refusals from Wiro\'s error items', () => {
  it('takes the code and Wiro\'s sentence from the items, whatever the text says', () => {
    const error = toolError(NEW_93, { [ERRORS_META]: [{ code: 93, message: NEW_LIMIT }] });
    expect(error.refusal?.code).toBe(93);
    expect(error.refusal?.message).toBe(NEW_LIMIT);
    expect(error.refusal?.path).toBe('/panel/controls/spend-limits');
    expect(error.refusal?.help).toBe('Nothing was charged. The account owner, a team admin or the organization owner can raise this '
      + 'limit on the Spend Limits page.');
    expect(error.message).toBe(`${NEW_LIMIT} ${error.refusal?.help}`);
    expect(error.message).not.toMatch(ASSISTANT_WORDS);
  });

  it('reads a Model Access item whose code comes as a string, after another error', () => {
    const error = toolError(NEW_92, { [ERRORS_META]: [{ code: 0, message: 'Something else.' }, { code: '92', message: NEW_RULE }] });
    expect(error.refusal?.code).toBe(92);
    expect(error.refusal?.message).toBe(NEW_RULE);
    expect(error.refusal?.path).toBe('/panel/controls/model-access');
    expect(error.refusal?.help).toContain('This extension runs with the API key of the project you chose when you signed in.');
    expect(error.message).not.toMatch(ASSISTANT_WORDS);
  });

  it('takes Wiro\'s sentence from the text when an item has none', () => {
    const error = toolError(RUN_92, { [ERRORS_META]: [{ code: 92 }] });
    expect(error.refusal?.code).toBe(92);
    expect(error.refusal?.message).toBe(KEY_RULE);
  });

  it('keeps an error with another code as it came', () => {
    const text = '## Error\n\nFailed to run model: Insufficient balance. Add funds and try again.';
    const error = toolError(text, { [ERRORS_META]: [{ code: 97, message: 'Insufficient balance. Add funds and try again.' }] });
    expect(error.refusal).toBeUndefined();
    expect(error.message).toBe('Failed to run model: Insufficient balance. Add funds and try again.');
  });

  it('reads the text when the items are missing or not what Wiro sends', () => {
    for (const meta of [{}, { [ERRORS_META]: 'x' }, { [ERRORS_META]: [] }, { [ERRORS_META]: [null, 'x', { message: 'no code' }] }]) {
      const error = toolError(RUN_93_LEFT, meta);
      expect(error.refusal?.code).toBe(93);
      expect(error.refusal?.message).toBe(LEFT_LIMIT);
    }
  });

  it('throws the refusal of a refused run from its items', async () => {
    const api = new WiroApi(fakeMcpWithMeta(NEW_93, { [ERRORS_META]: [{ code: 93, message: NEW_LIMIT }] }));
    const failure = await api.runModel('bytedance/seedream-5-5', {}).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WiroToolError);
    expect((failure as WiroToolError).refusal?.code).toBe(93);
    expect((failure as WiroToolError).message.startsWith(NEW_LIMIT)).toBe(true);
    expect((failure as WiroToolError).message).not.toMatch(ASSISTANT_WORDS);
  });

  it('passes a tool result\'s _meta on from the MCP answer', async () => {
    const items = [{ code: 93, message: NEW_LIMIT }];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const { id } = JSON.parse(String(init?.body)) as { id: number };
      const result = { content: [{ type: 'text', text: NEW_93 }], isError: true, _meta: { [ERRORS_META]: items } };
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`,
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch;
    const client = new McpClient('https://mcp.example.test/v1', { accessToken: async () => 'wiro_at_x', recoverFromUnauthorized: async () => false }, fetchImpl);
    const result = await client.callTool('run_model', {});
    expect(result.isError).toBe(true);
    expect(result.text).toBe(NEW_93);
    expect(result.meta?.[ERRORS_META]).toEqual(items);
  });
});
