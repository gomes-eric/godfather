export type FetchJson = (url: string) => Promise<unknown>;

const USER_AGENT = 'Padrinho/0.1 (M4F1A Discord bot)';

/** GETs JSON from a public site (the game, shugo.gg, Steam); a bad status or a timeout throws. */
export async function fetchJson(url: string, timeoutMs = 10_000): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${new URL(url).host} answered HTTP ${response.status}`);
  return response.json();
}
