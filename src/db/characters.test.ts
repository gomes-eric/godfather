import { describe, expect, it } from 'vitest';
import { openDatabase } from './client.js';
import { CharacterStore } from './characters.js';

describe('CharacterStore', () => {
  it('saves a registration and replaces it on the next one', () => {
    const db = openDatabase(':memory:');
    const store = new CharacterStore(db.db);
    const entry = { userId: 'u1', characterId: 'c1', name: 'Padrinho', serverId: 2403 };

    store.save({ ...entry, classKey: 'class-cleric' });
    store.save({ ...entry, characterId: 'c2', classKey: 'class-chanter' });

    expect(store.get('u1')).toMatchObject({ characterId: 'c2', classKey: 'class-chanter' });
    expect(store.get('nobody')).toBeUndefined();
    db.close();
  });
});
