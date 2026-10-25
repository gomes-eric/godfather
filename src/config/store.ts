import { readFileSync, writeFileSync } from 'node:fs';
import { isMap, isScalar, isSeq, parseDocument, type YAMLMap } from 'yaml';
import { ConfigError, loadServerConfig, parseServerConfig } from './loader.js';
import type { EventTemplateConfig, ServerConfig } from './schema.js';

export type EventTemplatePatch = Partial<
  Pick<EventTemplateConfig, 'title' | 'time' | 'days' | 'enabled' | 'emoji' | 'description'>
>;

/**
 * Holds the current server.yaml. `reload` validates the file first, so a broken edit never
 * replaces a working configuration. Edits made by the bot (e.g. a template's time) are written
 * back to the file with comments and formatting preserved, so the file stays the source of truth.
 */
export class ConfigStore {
  private current: ServerConfig;

  constructor(private readonly path: string) {
    this.current = loadServerConfig(path);
  }

  get(): ServerConfig {
    return this.current;
  }

  /** Throws ConfigError (keeping the previous config) when the file is invalid. */
  reload(): ServerConfig {
    this.current = loadServerConfig(this.path);
    return this.current;
  }

  /** Updates one event template in server.yaml. Throws ConfigError if the result is invalid. */
  updateEventTemplate(key: string, patch: EventTemplatePatch): ServerConfig {
    const doc = parseDocument(readFileSync(this.path, 'utf8'));
    const templates = doc.get('eventTemplates');
    const node = isSeq(templates)
      ? (templates.items.find((item) => isMap(item) && item.get('key') === key) as
          YAMLMap | undefined)
      : undefined;
    if (!node) throw new ConfigError(`event template "${key}" not found in server.yaml`);

    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      const existing = node.get(field, true);
      if (isScalar(existing) && !Array.isArray(value)) {
        existing.value = value; // keeps the original quoting style
      } else {
        node.set(field, doc.createNode(value, { flow: true }));
      }
    }

    const text = doc.toString();
    const config = parseServerConfig(text, this.path); // validate before touching the file
    writeFileSync(this.path, text);
    this.current = config;
    return config;
  }
}
