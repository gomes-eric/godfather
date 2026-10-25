import { loadServerConfig } from './loader.js';
import type { ServerConfig } from './schema.js';

/**
 * Holds the current server.yaml. `reload` validates the file first, so a broken edit never
 * replaces a working configuration.
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
}
