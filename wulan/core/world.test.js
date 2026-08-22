import { WulanWorldModel, seedWulanWorld } from './world.js';

describe('WulanWorldModel', () => {
  test('tracks projects and systems with fresh timestamps', () => {
    const world = new WulanWorldModel({ now: () => '2026-08-22T10:00:00.000Z' });
    world.upsertProject({ id: 'Sentinel', name: 'Sentinel' });
    world.upsertSystem({ id: 'Vercel', status: 'healthy' });

    expect(world.getProject('sentinel').name).toBe('Sentinel');
    expect(world.getSystem('vercel').status).toBe('healthy');
    expect(world.snapshot().projects).toHaveLength(1);
  });

  test('searches across known world entities', () => {
    const world = seedWulanWorld(new WulanWorldModel());
    expect(world.search('fakej3/Sentinel')[0].id).toBe('sentinel');
    expect(world.search('edgelab')[0].id).toBe('edgelab');
  });

  test('bounds observations', () => {
    const world = new WulanWorldModel({ now: () => 'now' });
    for (let i = 0; i < 205; i++) world.observe({ id: i });
    expect(world.snapshot().observations).toHaveLength(200);
    expect(world.snapshot().observations[0].id).toBe(5);
  });
});
