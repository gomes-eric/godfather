// Finds a Discord object from what a person or an AI typed: a mention, an id or a name
// (accents, case and a leading # or @ ignored). Pure, so it is testable without Discord.

export interface Candidate {
  id: string;
  /** Every name the object answers to, e.g. username, display name, nickname. */
  names: string[];
  /** How to show it when listing options. */
  label: string;
}

export type Resolution =
  { ok: true; id: string } | { ok: false; reason: 'none' | 'ambiguous'; options: string[] };

export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[#@]/, '')
    .trim();
}

const MENTION = /^<(?:@!?|@&|#)(\d{17,20})>$/;
const SNOWFLAKE = /^\d{17,20}$/;
const MAX_OPTIONS = 5;

/** Exact id/mention, then exact name, then a unique partial match. */
export function resolveCandidate(input: string, candidates: Candidate[]): Resolution {
  const trimmed = input.trim();
  const id = trimmed.match(MENTION)?.[1] ?? (SNOWFLAKE.test(trimmed) ? trimmed : undefined);
  if (id) {
    return candidates.some((c) => c.id === id)
      ? { ok: true, id }
      : { ok: false, reason: 'none', options: [] };
  }

  const needle = normalizeName(trimmed);
  if (!needle) return { ok: false, reason: 'none', options: [] };

  const pick = (matches: Candidate[]): Resolution | null => {
    if (matches.length === 1) return { ok: true, id: matches[0]!.id };
    if (matches.length > 1) {
      return {
        ok: false,
        reason: 'ambiguous',
        options: matches.slice(0, MAX_OPTIONS).map((c) => c.label),
      };
    }
    return null;
  };

  return (
    pick(candidates.filter((c) => c.names.some((n) => normalizeName(n) === needle))) ??
    pick(candidates.filter((c) => c.names.some((n) => normalizeName(n).includes(needle)))) ?? {
      ok: false,
      reason: 'none',
      options: [],
    }
  );
}
