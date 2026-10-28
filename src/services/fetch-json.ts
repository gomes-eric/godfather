import { Impit } from 'impit';

export type FetchJson = (url: string) => Promise<unknown>;

const USER_AGENT = 'Padrinho/0.1 (M4F1A Discord bot)';

/** GETs JSON from a public site (the game, questlog.gg, Steam); a bad status or a timeout throws. */
export async function fetchJson(url: string, timeoutMs = 10_000): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${new URL(url).host} answered HTTP ${response.status}`);
  return response.json();
}

let browser: Impit | undefined;

/**
 * Like `fetchJson`, but with Chrome's TLS (JA3/JA4) and HTTP/2 fingerprint and headers, for sites
 * behind a Cloudflare bot check that turns away Node's own handshake (questlog.gg).
 */
export async function fetchJsonAsBrowser(url: string, timeoutMs = 15_000): Promise<unknown> {
  browser ??= new Impit({ browser: 'chrome' });
  const response = await browser.fetch(url, {
    headers: { Accept: 'application/json' },
    timeout: timeoutMs,
  });
  if (!response.ok) throw new Error(`${new URL(url).host} answered HTTP ${response.status}`);
  return response.json();
}
