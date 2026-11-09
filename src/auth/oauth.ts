import { endpoints, type WiroConfig } from '../config.js';
import type { Platform } from '../platform.js';
import type { TokenSource } from '../mcp/client.js';
import { createPkce, randomString } from './pkce.js';

// Sign-in with the Wiro account through the OAuth 2.1 server at mcp.wiro.ai,
// the same one ChatGPT and Claude use. The user picks a project and a
// connection lifetime on wiro.ai; the extension never sees an API key.

const CLIENT_KEY = 'wiro.oauth.client';
const TOKENS_KEY = 'wiro.oauth.tokens';
const PENDING_KEY = 'wiro.oauth.pending';
/** Refresh this long before the access token runs out. */
const EXPIRY_SKEW_MS = 60_000;
/** A sign-in started longer ago than this has to start again. */
const PENDING_MAX_AGE_MS = 15 * 60_000;

interface StoredClient {
  clientId: string;
  redirectUri: string;
  issuer: string;
}

interface PendingSignIn {
  state: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
  startedAt: number;
}

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  clientId: string;
  issuer: string;
}

export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignInError';
  }
}

export class OAuth implements TokenSource {
  private refreshing: Promise<StoredTokens | undefined> | undefined;

  constructor(
    private readonly platform: Platform,
    private readonly config: WiroConfig,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  async isSignedIn(): Promise<boolean> {
    const tokens = await this.platform.storage.get<StoredTokens>(TOKENS_KEY);
    return Boolean(tokens && tokens.issuer === this.config.issuer && (tokens.refreshToken || tokens.expiresAt > Date.now()));
  }

  /**
   * Runs the whole flow: register if needed, open wiro.ai, trade the code for
   * tokens. Resolves 'pending' when the browser finishes the sign-in elsewhere
   * (Safari: the background catches the redirect in a tab); the tokens then
   * show up through onSignInChanged.
   */
  async signIn(): Promise<'done' | 'pending'> {
    const url = await this.beginSignIn();
    let finalUrl: string | undefined;
    try {
      finalUrl = await this.platform.launchAuth(url);
    } catch (error) {
      await this.platform.session.remove(PENDING_KEY);
      throw new SignInError(error instanceof Error && /cancel|closed|did not approve/i.test(error.message)
        ? 'The sign-in window was closed before it finished.'
        : 'The sign-in window could not be opened.');
    }
    if (finalUrl === undefined) return 'pending';
    await this.completeSignIn(finalUrl);
    return 'done';
  }

  /**
   * First half of the flow: the authorize URL to open. The PKCE verifier and
   * state wait in session storage, so the second half can run in another
   * page, such as the background after a popup closed.
   */
  async beginSignIn(): Promise<string> {
    const client = await this.client();
    const pkce = await createPkce();
    const state = randomString(32);
    const pending: PendingSignIn = { state, verifier: pkce.verifier, clientId: client.clientId, redirectUri: client.redirectUri, startedAt: Date.now() };
    await this.platform.session.set(PENDING_KEY, pending);
    const url = new URL(endpoints(this.config).authorize);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      state,
      scope: this.config.scope,
      resource: this.config.resource,
    }).toString();
    return url.toString();
  }

  /** Second half: checks the redirect wiro.ai sent back and trades its code for tokens. */
  async completeSignIn(finalUrl: string): Promise<void> {
    const pending = await this.platform.session.get<PendingSignIn>(PENDING_KEY);
    if (!pending || Date.now() - pending.startedAt > PENDING_MAX_AGE_MS) {
      throw new SignInError('This sign-in has expired. Start it again from the Wiro panel.');
    }
    const answer = new URL(finalUrl).searchParams;
    if (answer.get('state') !== pending.state) throw new SignInError('The sign-in answer did not match. Try again.');
    await this.platform.session.remove(PENDING_KEY);
    const iss = answer.get('iss');
    if (iss && iss !== this.config.issuer) throw new SignInError('The sign-in answer came from an unexpected server.');
    const error = answer.get('error');
    if (error) {
      if (error === 'invalid_client' || error === 'unauthorized_client') await this.platform.storage.remove(CLIENT_KEY);
      throw new SignInError(error === 'access_denied' ? 'Sign-in was cancelled on wiro.ai.' : (answer.get('error_description') || error));
    }
    const code = answer.get('code');
    if (!code) throw new SignInError('wiro.ai did not send a sign-in code.');

    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      client_id: pending.clientId,
      code_verifier: pending.verifier,
      resource: this.config.resource,
    }, pending.clientId);
    if (!tokens) throw new SignInError('wiro.ai did not accept the sign-in code. Try again.');
  }

  /** Calls back when this browser signs in or out, from any page of the extension. */
  onSignInChanged(listener: (signedIn: boolean) => void): () => void {
    return this.platform.storage.onChanged(changes => {
      if (TOKENS_KEY in changes) listener(Boolean(changes[TOKENS_KEY]));
    });
  }

  async signOut(): Promise<void> {
    const tokens = await this.platform.storage.get<StoredTokens>(TOKENS_KEY);
    await this.platform.storage.remove(TOKENS_KEY);
    if (!tokens) return;
    const revoke = async (token: string, hint: string) => {
      try {
        await this.fetchImpl(endpoints(this.config).revoke, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token, token_type_hint: hint, client_id: tokens.clientId }).toString(),
        });
      } catch {
        // Signing out locally is what matters; the grant also ends in Connected apps.
      }
    };
    if (tokens.refreshToken) await revoke(tokens.refreshToken, 'refresh_token');
    await revoke(tokens.accessToken, 'access_token');
  }

  async accessToken(): Promise<string | undefined> {
    const tokens = await this.platform.storage.get<StoredTokens>(TOKENS_KEY);
    if (!tokens || tokens.issuer !== this.config.issuer) return undefined;
    if (tokens.expiresAt - EXPIRY_SKEW_MS > Date.now()) return tokens.accessToken;
    const fresh = await this.refresh(tokens);
    return fresh?.accessToken;
  }

  async recoverFromUnauthorized(): Promise<boolean> {
    const tokens = await this.platform.storage.get<StoredTokens>(TOKENS_KEY);
    if (!tokens?.refreshToken) {
      await this.platform.storage.remove(TOKENS_KEY);
      return false;
    }
    return Boolean(await this.refresh({ ...tokens, expiresAt: 0 }));
  }

  /** One refresh at a time: a second caller waits for the first one's answer. */
  private refresh(tokens: StoredTokens): Promise<StoredTokens | undefined> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        if (!tokens.refreshToken) {
          await this.platform.storage.remove(TOKENS_KEY);
          return undefined;
        }
        const fresh = await this.tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken,
          client_id: tokens.clientId,
          resource: this.config.resource,
        }, tokens.clientId);
        if (!fresh) await this.platform.storage.remove(TOKENS_KEY);
        return fresh;
      })().finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  private async tokenRequest(form: Record<string, string>, clientId: string): Promise<StoredTokens | undefined> {
    const response = await this.fetchImpl(endpoints(this.config).token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
    });
    const body = await response.json().catch(() => ({})) as {
      access_token?: string; refresh_token?: string; expires_in?: number; error?: string;
    };
    if (!response.ok || !body.access_token) {
      if (body.error === 'invalid_client') await this.platform.storage.remove(CLIENT_KEY);
      return undefined;
    }
    const tokens: StoredTokens = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? form['refresh_token'],
      expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
      clientId,
      issuer: this.config.issuer,
    };
    await this.platform.storage.set(TOKENS_KEY, tokens);
    return tokens;
  }

  /**
   * The OAuth client of this install. Registered once with Dynamic Client
   * Registration; registered again when the redirect URI or issuer changes.
   */
  private async client(): Promise<StoredClient> {
    const redirectUri = this.platform.redirectUri();
    const stored = await this.platform.storage.get<StoredClient>(CLIENT_KEY);
    if (stored && stored.redirectUri === redirectUri && stored.issuer === this.config.issuer) return stored;

    const response = await this.fetchImpl(endpoints(this.config).register, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_name: this.platform.clientName,
        client_uri: this.config.site,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        software_id: `wiro-${this.platform.name}-extension`,
        software_version: this.platform.version,
      }),
    });
    const body = await response.json().catch(() => ({})) as { client_id?: string; error_description?: string };
    if (!response.ok || !body.client_id) {
      throw new SignInError(body.error_description || 'wiro.ai could not register this browser. Try again later.');
    }
    const client: StoredClient = { clientId: body.client_id, redirectUri, issuer: this.config.issuer };
    await this.platform.storage.set(CLIENT_KEY, client);
    return client;
  }
}
