/** Lowercase, accents removed and trimmed, for matching what people type ("Sáb" → "sab"). */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Loose readers for JSON from outside APIs: a missing or wrong-typed field becomes empty. */
export type Json = Record<string, unknown>;
export const obj = (value: unknown): Json =>
  typeof value === 'object' && value !== null ? (value as Json) : {};
export const str = (value: unknown): string => (typeof value === 'string' ? value : '');
