import { describe, expect, it } from 'vitest';
import { parsePanelCustomId, ROOM_PREFIX, roomPanel, type RoomPanelView } from './room-panel.js';

const view: RoomPanelView = {
  roomId: '123',
  ownerId: '42',
  locked: false,
  hidden: false,
  userLimit: 5,
};

function customIds(panel: ReturnType<typeof roomPanel>): string[][] {
  return panel.components.map((row) =>
    row.toJSON().components.map((c) => ('custom_id' in c ? c.custom_id : '')),
  );
}

describe('roomPanel', () => {
  it('names the owner and the current mode', () => {
    const description = roomPanel(view).embeds[0]!.toJSON().description!;
    expect(description).toContain('<@42>');
    expect(description).toContain('🔓 Aberta · 👁️ Visível · 👥 Até 5 pessoas');
  });

  it('shows the privacy action that is available now', () => {
    expect(customIds(roomPanel(view))).toEqual([
      ['room:lock:123', 'room:hide:123', 'room:limit:123'],
      ['room:rename:123', 'room:kick:123', 'room:claim:123'],
    ]);
    const closed = roomPanel({ ...view, locked: true, hidden: true, userLimit: 0 });
    expect(customIds(closed)[0]).toEqual(['room:unlock:123', 'room:unhide:123', 'room:limit:123']);
    expect(closed.embeds[0]!.toJSON().description).toContain(
      '🔒 Trancada · 🙈 Oculta · 👥 Sem limite',
    );
  });

  it('round-trips its custom ids', () => {
    expect(parsePanelCustomId('room:kick:123', ROOM_PREFIX)).toEqual({
      action: 'kick',
      roomId: '123',
    });
    expect(parsePanelCustomId('rsvp:1:yes', ROOM_PREFIX)).toBeUndefined();
    expect(parsePanelCustomId('room:kick', ROOM_PREFIX)).toBeUndefined();
  });
});
