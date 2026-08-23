import { createDefaultWulanCore } from './manifest.js';

describe('default Wulan core', () => {
  test('boots without duplicate capability registration failures', () => {
    const core = createDefaultWulanCore();
    expect(core.state.status).toBe('ready');
    expect(core.state.agents.size).toBe(4);
    expect(core.state.integrations.has('strategy-lab')).toBe(true);
    expect(core.capabilities.get('memory.search')).not.toBeNull();
    expect(core.capabilities.get('memory.remember')).not.toBeNull();
    expect(core.capabilities.get('system.status')).not.toBeNull();
    expect(core.capabilities.get('strategy-lab.inspect')).not.toBeNull();
    expect(core.neural.stats()).toMatchObject({ neurons: 5, synapses: 8, agents: 4 });
  });
});
