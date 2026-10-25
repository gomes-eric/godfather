import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from './client.js';
import { auditLog } from './schema.js';

describe('openDatabase', () => {
  let handle: DatabaseHandle | undefined;

  afterEach(() => {
    handle?.close();
    handle = undefined;
  });

  it('applies migrations so the schema is usable', () => {
    handle = openDatabase(':memory:');

    handle.db
      .insert(auditLog)
      .values({ actorId: '1', actorTier: 'system', source: 'system', action: 'boot', result: 'ok' })
      .run();

    const rows = handle.db.select().from(auditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.at).toBeInstanceOf(Date);
  });

  it('reports health and stops being healthy after close', () => {
    handle = openDatabase(':memory:');
    expect(handle.isHealthy()).toBe(true);

    handle.close();
    expect(handle.isHealthy()).toBe(false);
    handle = undefined;
  });
});
