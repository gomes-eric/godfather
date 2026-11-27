export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export type Json = Record<string, unknown>;
export const obj = (value: unknown): Json =>
  typeof value === 'object' && value !== null ? (value as Json) : {};
export const str = (value: unknown): string => (typeof value === 'string' ? value : '');
