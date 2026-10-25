import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { serverConfigSchema, type ServerConfig } from './schema.js';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function parseServerConfig(source: string, origin = 'server.yaml'): ServerConfig {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    throw new ConfigError(`${origin} is not valid YAML: ${(error as Error).message}`);
  }

  const result = serverConfigSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`${origin} is invalid:\n${details}`);
  }
  return result.data;
}

export function loadServerConfig(path: string): ServerConfig {
  return parseServerConfig(readFileSync(path, 'utf8'), path);
}
