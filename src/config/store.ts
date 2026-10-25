import { readFileSync, writeFileSync } from 'node:fs';
import { isMap, isScalar, isSeq, parseDocument, type YAMLMap } from 'yaml';
import { ConfigError, loadServerConfig, parseServerConfig } from './loader.js';
import type { EventTemplateConfig, ServerConfig } from './schema.js';

export type VoiceGeneratorConfig = ServerConfig['voiceGenerators'][number];

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
    const doc = this.document();
    const node = findItem(doc.get('eventTemplates'), key);
    if (!node) throw new ConfigError(`event template "${key}" not found in server.yaml`);
    setFields(doc, node, patch);
    return this.save(doc);
  }

  /** Adds a voice generator, or updates the one with the same key. */
  upsertVoiceGenerator(generator: VoiceGeneratorConfig): ServerConfig {
    const doc = this.document();
    const list = doc.get('voiceGenerators');
    const node = findItem(list, generator.key);
    if (node) {
      setFields(doc, node, generator);
    } else if (isSeq(list)) {
      list.add(doc.createNode(generator, { flow: true }));
    } else {
      doc.set('voiceGenerators', doc.createNode([generator], { flow: false }));
    }
    return this.save(doc);
  }

  deleteVoiceGenerator(key: string): ServerConfig {
    const doc = this.document();
    const list = doc.get('voiceGenerators');
    const node = findItem(list, key);
    if (!node || !isSeq(list))
      throw new ConfigError(`voice generator "${key}" not found in server.yaml`);
    list.items.splice(list.items.indexOf(node), 1);
    return this.save(doc);
  }

  private document() {
    return parseDocument(readFileSync(this.path, 'utf8'));
  }

  /** Validates the edited document, then writes it and makes it current. */
  private save(doc: ReturnType<typeof parseDocument>): ServerConfig {
    const text = doc.toString();
    const config = parseServerConfig(text, this.path);
    writeFileSync(this.path, text);
    this.current = config;
    return config;
  }
}

function findItem(list: unknown, key: string): YAMLMap | undefined {
  return isSeq(list)
    ? (list.items.find((item) => isMap(item) && item.get('key') === key) as YAMLMap | undefined)
    : undefined;
}

function setFields(doc: ReturnType<typeof parseDocument>, node: YAMLMap, patch: object): void {
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const existing = node.get(field, true);
    if (isScalar(existing) && !Array.isArray(value)) {
      existing.value = value; // keeps the original quoting style
    } else {
      node.set(field, doc.createNode(value, { flow: true }));
    }
  }
}
