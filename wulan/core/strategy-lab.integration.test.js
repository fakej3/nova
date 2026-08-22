import { createWulanCore } from './index.js';

describe('Strategy Lab runtime integration', () => {
  test('registers Strategy Lab in the world model and capability registry', () => {
    const core = createWulanCore();
    core.boot();

    expect(core.world.getProject('strategy-lab')).toMatchObject({
      repository: 'fakej3/strategy-lab',
      facade: 'lab/'
    });
    expect(core.capabilities.get('strategy-lab.inspect')).toMatchObject({
      risk: 'read',
      permissions: ['github:read']
    });
  });

  test('capability execution feeds the shared world observation layer', async () => {
    const core = createWulanCore();
    const inspector = async () => ({ project: 'Strategy Lab', branch: { sha: 'test-sha' } });
    core.capabilities.capabilities.delete('strategy-lab.inspect');
    const { registerStrategyLab } = await import('./strategy-lab.js');
    registerStrategyLab(core, { inspector });

    const before = core.world.snapshot().observations.length;
    await core.invokeCapability('strategy-lab.inspect', { subject: 'strategy-lab' });
    const observation = core.world.snapshot().observations.at(-1);

    expect(core.world.snapshot().observations.length).toBe(before + 1);
    expect(observation).toMatchObject({
      source: 'strategy-lab.inspect',
      subject: 'strategy-lab',
      kind: 'capability-result'
    });
  });
});
