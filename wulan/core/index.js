import { WulanEventBus, WULAN_EVENTS } from './event-bus.js';
import { CapabilityRegistry } from './capabilities.js';

export function createWulanCore() {
  const events = new WulanEventBus();
  const capabilities = new CapabilityRegistry();

  const state = {
    status: 'booting',
    agents: new Map(),
    integrations: new Map(),
  };

  const core = {
    events,
    capabilities,
    state,

    registerAgent(agent) {
      if (!agent?.id || !agent?.name) throw new TypeError('Agent requires id and name');
      state.agents.set(agent.id, { status: 'idle', ...agent });
      return state.agents.get(agent.id);
    },

    registerIntegration(integration) {
      if (!integration?.id || !integration?.name) throw new TypeError('Integration requires id and name');
      state.integrations.set(integration.id, { status: 'disconnected', ...integration });
      return state.integrations.get(integration.id);
    },

    boot() {
      state.status = 'ready';
      events.emit(WULAN_EVENTS.SYSTEM_READY, {
        agents: [...state.agents.keys()],
        integrations: [...state.integrations.keys()],
      });
      return state;
    },
  };

  return core;
}
