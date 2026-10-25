import { describe, expect, it } from 'vitest';
import {
  itemLabel,
  matchClass,
  parseEquipment,
  parseProfile,
  parseSearch,
  sameLegion,
} from './game-character.js';

// Trimmed copies of real responses (names replaced).
const search = {
  list: [
    {
      characterId: 'AbC%2Bd%3D',
      name: '<strong>Padrinho</strong>',
      race: 2,
      pcId: 32,
      level: 45,
      serverId: 2403,
      serverName: 'Triniel',
      region: 'la',
    },
    { characterId: 'other', name: 'Padrinho', serverId: 2404 },
  ],
  pagination: { page: 1, size: 20, total: 2, endPage: 1 },
};

const info = {
  profile: {
    characterId: 'AbC+d=',
    characterLevel: 45,
    characterName: 'Padrinho',
    className: 'Clérigo',
    combatPower: 143232,
    profileImage: 'https://profileimg.plaync.com/x.png',
    raceName: 'Asmodiano',
    regionName: 'M4F1A',
    serverId: 2403,
    serverName: 'Triniel',
    titleName: 'Pisando em Asas Brancas',
  },
  stat: {
    statList: [
      { name: 'Poder', type: 'STR', value: 60 },
      { name: '아이템레벨', type: 'ItemLevel', value: 2656 },
    ],
  },
};

const equipment = {
  equipment: {
    equipmentList: [
      {
        slotPosName: 'Torso',
        name: 'Peitoral de Nuakum',
        enchantLevel: 10,
        exceedLevel: 0,
        grade: 'Unique',
      },
      {
        slotPosName: 'MainHand',
        name: 'Martelo de Combate',
        enchantLevel: 15,
        exceedLevel: 3,
        grade: 'Unique',
      },
      {
        slotPosName: 'Ring1',
        name: 'Anel de Kromede',
        enchantLevel: 10,
        exceedLevel: 0,
        grade: 'Unique',
      },
      {
        slotPosName: 'Arcana1',
        name: 'Cálice do Vigor',
        enchantLevel: 2,
        exceedLevel: 0,
        grade: 'Unique',
      },
      { slotPosName: 'SomethingNew', name: 'Mistério', enchantLevel: 1 },
    ],
    skinList: [{ slotPosName: 'Torso', name: 'Roupa bonita' }],
  },
};

describe('game character API parsing', () => {
  it('finds the exact name on the configured server only', () => {
    expect(parseSearch(search, 'padrinho', 2403)).toEqual({
      id: 'AbC+d=',
      name: 'Padrinho',
      serverId: 2403,
    });
    expect(parseSearch(search, 'Padrinh', 2403)).toBeNull();
    expect(parseSearch({ unexpected: true }, 'Padrinho', 2403)).toBeNull();
  });

  it('reads the profile, including item level and legion', () => {
    expect(parseProfile(info)).toMatchObject({
      name: 'Padrinho',
      className: 'Clérigo',
      level: 45,
      combatPower: 143232,
      itemLevel: 2656,
      legion: 'M4F1A',
      title: 'Pisando em Asas Brancas',
    });
    expect(parseProfile({ profile: { ...info.profile, regionName: '' } })?.legion).toBe('');
    expect(parseProfile({})).toBeNull();
  });

  it('groups and orders equipment, leaving skins and unknown slots out', () => {
    const items = parseEquipment(equipment);
    expect(items.map((i) => [i.group, i.name])).toEqual([
      ['weapons', 'Martelo de Combate'],
      ['armor', 'Peitoral de Nuakum'],
      ['accessories', 'Anel de Kromede'],
      ['arcana', 'Cálice do Vigor'],
    ]);
    expect(itemLabel(items[0]!)).toBe('+15 Martelo de Combate ✦3');
    expect(parseEquipment(null)).toEqual([]);
  });

  it('matches class roles and legions ignoring accents and case', () => {
    const roles = [{ name: 'Clérigo' }, { name: 'Templário' }];
    expect(matchClass('CLERIGO', roles)).toBe(roles[0]);
    expect(matchClass('Bardo', roles)).toBeUndefined();
    expect(sameLegion('m4f1a', 'M4F1A')).toBe(true);
    expect(sameLegion('', 'M4F1A')).toBe(false);
  });
});
