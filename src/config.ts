// Where the extension talks to Wiro. Everything goes through the hosted MCP
// server: it accepts the OAuth access token and serves CORS to any origin, so
// the extension needs no host permissions.

export interface WiroConfig {
  /** The MCP endpoint (JSON-RPC over HTTP, stateless). */
  mcpUrl: string;
  /** The OAuth 2.1 authorization server (issuer). */
  issuer: string;
  /** The resource the access token is for (RFC 8707). */
  resource: string;
  scope: string;
  /** The Wiro website, for links. */
  site: string;
  /** Remote action catalog. It overrides the bundled one when it loads. */
  catalogUrl: string;
}

export const DEFAULT_CONFIG: WiroConfig = {
  mcpUrl: 'https://mcp.wiro.ai/v1',
  issuer: 'https://mcp.wiro.ai',
  resource: 'https://mcp.wiro.ai/v1',
  scope: 'mcp',
  site: 'https://wiro.ai',
  catalogUrl: 'https://wiro.ai/extension/actions.json',
};

export const MCP_PROTOCOL_VERSION = '2025-06-18';

/** How long a tool call that waits for a task may hold the request, in seconds. */
export const WAIT_SECONDS = 45;

export function endpoints(config: WiroConfig) {
  return {
    authorize: `${config.issuer}/authorize`,
    token: `${config.issuer}/token`,
    register: `${config.issuer}/register`,
    revoke: `${config.issuer}/revoke`,
  };
}
