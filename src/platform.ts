// What the core needs from the browser. Each browser repo implements it once:
// chrome.* for Chrome, browser.* for Firefox and Safari.

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  /** Calls back with the keys that changed and their new values (undefined when removed). */
  onChanged(listener: (changes: Record<string, unknown>) => void): () => void;
}

export type BrowserName = 'chrome' | 'firefox' | 'safari';

export interface Platform {
  name: BrowserName;
  /** The extension version from the manifest. */
  version: string;
  /** Survives browser restarts: sign-in, settings, history cache, tray. */
  storage: KeyValueStore;
  /** Lives while the browser runs: the item the user just right-clicked. */
  session: KeyValueStore;
  /** The OAuth redirect URI this browser can catch. */
  redirectUri(): string;
  /** Shown on the Wiro consent page and in Connected apps. */
  clientName: string;
  /**
   * Opens the sign-in window at `url` and resolves with the URL the
   * authorization server redirected to (it carries the code). Resolves with
   * undefined when the browser finishes the sign-in elsewhere: Safari has no
   * identity API, so it opens a tab and its background catches the redirect.
   */
  launchAuth(url: string): Promise<string | undefined>;
  /** Opens a link in a new tab. */
  openTab(url: string): void;
}
