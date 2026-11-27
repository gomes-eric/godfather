export function customId(prefix: string, ...parts: (string | number)[]): string {
  return `${prefix}${parts.join(':')}`;
}

export function parseCustomId(id: string, prefix: string): string[] | undefined {
  return id.startsWith(prefix) ? id.slice(prefix.length).split(':') : undefined;
}

export function numericPart(part: string | undefined): number | undefined {
  const value = Number(part);
  return part && Number.isInteger(value) ? value : undefined;
}
