# Wiro Extension Core

Shared code of the Wiro AI browser extensions for Chrome, Firefox and Safari. Each browser repo includes it as the `core/` git submodule and adds a small platform adapter.

- `src/auth`: sign-in with a Wiro account through the OAuth 2.1 server at mcp.wiro.ai (PKCE, refresh, revoke). No API key in the browser.
- `src/mcp`, `src/wiro`: a small client for the stateless MCP endpoint `https://mcp.wiro.ai/v1` and the Wiro tools the extension uses.
- `src/catalog`: the right-click actions. Every action points at Wiro model categories, never at fixed models; the list loads from wiro.ai and the models come live from each category.
- `src/gateway`: maps one set of inputs (the clicked file, the prompt, length, quality, shape) onto each model's own parameter names, so every model in a category works with the same panel.
- `src/pricing`: the price on the run button, from the model's price rows or its price summary.
- `src/ui`: the side panel (Preact).

```bash
npm install
npm test
npm run typecheck
```
