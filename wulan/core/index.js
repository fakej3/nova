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
      if (state.agents.has(agent.id)) throw new Error(`Agent already registered: ${agent.id}`);
      state.agents.set(agent.id, { status: 'idle', ...agent });
      return state.agents.get(agent.id);
    },

    registerIntegration(integration) {
      if (!integration?.id || !integration?.name) throw new TypeError('Integration requires id and name');
      if (state.integrations.has(integration.id)) throw new Error(`Integration already registered: ${integration.id}`);
      state.integrations.set(integration.id, { status: 'disconnected', ...integration });
      return state.integrations.get(integration.id);
    },

    startAgent(agentId, meta = {}) {
      const agent = state.agents.get(agentId);
      if (!agent) throw new Error(`Unknown agent: ${agentId}`);
      if (agent.status === 'active') return agent;
      agent.status = 'active';
      events.emit(WULAN_EVENTS.AGENT_STARTED, { agentId, ...meta });
      return agent;
    },

    finishAgent(agentId, meta = {}) {
      const agent = state.agents.get(agentId);
      if (!agent) throw new Error(`Unknown agent: ${agentId}`);
      agent.status = 'idle';
      events.emit(WULAN_EVENTS.AGENT_FINISHED, { agentId, ...meta });
      return agent;
    },

    failAgent(agentId, error, meta = {}) {
      const agent = state.agents.get(agentId);
      if (!agent) throw new Error(`Unknown agent: ${agentId}`);
      agent.status = 'error';
      events.emit(WULAN_EVENTS.AGENT_FAILED, {
        agentId,
        error: error instanceof Error ? error.message : String(error),
        ...meta,
      });
      return agent;
    },

    async invokeCapability(capabilityId, input, context = {}) {
      const correlationId = context.correlationId ?? `cap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      events.emit(WULAN_EVENTS.TOOL_CALLED, { capabilityId, input }, { correlationId });
      try {
        const result = await capabilities.invoke(capabilityId, input, { ...context, core, correlationId });
        events.emit(WULAN_EVENTS.TOOL_FINISHED, { capabilityId, result }, { correlationId });
        return result;
      } catch (error) {
        events.emit(WULAN_EVENTS.TOOL_FAILED, {
          capabilityId,
          error: error instanceof Error ? error.message : String(error),
        }, { correlationId });
        throw error;
      }
    },

    boot() {
      if (state.status === 'ready') return state;
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
