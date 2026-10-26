// Buttons, forms and menus carry what a click needs in their custom id: `<prefix><part>:<part>`,
// e.g. `party:join:12`. Each feature owns its prefix (ending in ":").

export function customId(prefix: string, ...parts: (string | number)[]): string {
  return `${prefix}${parts.join(':')}`;
}

/** The parts after the prefix, or undefined when the id belongs to something else. */
export function parseCustomId(id: string, prefix: string): string[] | undefined {
  return id.startsWith(prefix) ? id.slice(prefix.length).split(':') : undefined;
}

/** A numeric id from a custom id part (a party, an application...), or undefined. */
export function numericPart(part: string | undefined): number | undefined {
  const value = Number(part);
  return part && Number.isInteger(value) ? value : undefined;
}
