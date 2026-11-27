import { describe, expect, it } from 'vitest';
import { planAutoRoles, type AutoRoles, type MemberSnapshot } from './auto-roles.js';

const PADRINHO = '500';
const roles: AutoRoles = {
  visitor: 'visitor',
  bot: 'bots',
  placed: new Set(['soldier', 'officer', 'visitor', 'ally', 'alliance-x', 'asSoldier']),
};
const person = (id: string, ...roleIds: string[]): MemberSnapshot => ({ id, bot: false, roleIds });
const bot = (id: string, ...roleIds: string[]): MemberSnapshot => ({ id, bot: true, roleIds });

describe('planAutoRoles', () => {
  it.each([
    ['a person with no role gets the visitor role', person('1'), [['1', 'visitor', 'visitor']]],
    [
      'a person with an unrelated role gets it too',
      person('1', 'music'),
      [['1', 'visitor', 'visitor']],
    ],
    ['a person with a standing role keeps their place', person('1', 'officer'), []],
    ['a person in an alliance keeps their place', person('1', 'alliance-x'), []],
    ['a person with a soldier-like role keeps their place', person('1', 'asSoldier'), []],
    ['a visitor is left alone', person('1', 'visitor'), []],
    ['a bot gets the bot role', bot('2'), [['2', 'bots', 'bot']]],
    ['a bot that has it is left alone', bot('2', 'bots'), []],
    [
      'a bot with a standing role still gets the bot role',
      bot('2', 'soldier'),
      [['2', 'bots', 'bot']],
    ],
    ['Padrinho gives itself nothing', bot(PADRINHO), []],
  ])('%s', (_, member, grants) => {
    expect(planAutoRoles([member], roles, PADRINHO)).toEqual(
      grants.map(([memberId, roleId, kind]) => ({ memberId, roleId, kind })),
    );
  });

  it('plans nothing for a role server.yaml does not have', () => {
    const members = [person('1'), bot('2')];
    expect(planAutoRoles(members, { placed: new Set() }, PADRINHO)).toEqual([]);
    expect(planAutoRoles(members, { ...roles, bot: undefined }, PADRINHO)).toEqual([
      { memberId: '1', roleId: 'visitor', kind: 'visitor' },
    ]);
  });
});
