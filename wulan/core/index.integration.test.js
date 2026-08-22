import { createWulanCore } from './index.js';

describe('Wulan runtime wiring', () => {
  test('boots with world model, observation ingestion and Sentinel capability connected', () => {
    const core = createWulanCore();
    const state = core.boot();

    expect(state.status).toBe('ready');
    expect(core.world.getProject('sentinel')).toMatchObject({
      repository: 'fakej3/Sentinel',
      branch: 'main'
    });
    expect(core.capabilities.get('sentinel.inspect')).toBeTruthy();
    expect(core.capabilities.observationIngestor).toBe(core.observationIngestor);
    expect(state.world.projects).toBeGreaterThanOrEqual(2);
  });

  test('capability execution updates the same world instance', async () => {
    const core = createWulanCore();
    const before = core.world.snapshot().observations.length;
    core.capabilities.register({
      id: 'test.observe',
      name: 'Test Observe',
      execute: async () => ({ ok: true })
    });

    await core.invokeCapability('test.observe', { subject: 'sentinel' });
    expect(core.world.snapshot().observations.length).toBe(before + 1);
    expect(core.world.snapshot().observations.at(-1)).toMatchObject({
      source: 'test.observe',
      subject: 'sentinel'
    });
  });
});
