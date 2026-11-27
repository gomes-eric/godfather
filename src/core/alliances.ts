import { sameLegion } from './game-character.js';
import { fold } from './text.js';

// Pure rules for allied legions (server.yaml `alliances`).

export interface Alliance {
  key: string;
  legion: string;
}

/** The alliance with this legion, ignoring case and accents. */
export function findAlliance<T extends Alliance>(
  alliances: readonly T[],
  legion: string,
): T | undefined {
  return alliances.find((alliance) => sameLegion(alliance.legion, legion));
}

/** A key for a new alliance: "ally-" and the legion in kebab-case, unique among `taken`. */
export function allianceKey(legion: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const slug =
    fold(legion)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'legion';
  const base = `ally-${slug}`;
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
  return key;
}
