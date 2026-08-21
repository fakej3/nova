// Wulan Orchestrator — turns intent into work across agents and real capabilities.
// It is deliberately model-agnostic. A model can propose a plan later; this layer
// owns execution, permissions, activity and world state.

const ROUTES = [
  { test: /github|repo|repository|commit|branch|codebase/i, agent: 'leon', capability: 'github.repo.snapshot' },
  { test: /sentinel|trade|trading|market/i, agent: 'oracle', entity: 'sentinel' },
  { test: /edgelab|research|experiment|strategy/i, agent: 'atlas', entity: 'edgelab' },
  { test: /design|ui|visual|image|creative/i, agent: 'pixel' },
];

export class WulanOrchestrator {
  constructor({ core, world }) {
    this.core = core;
    this.world = world;
  }

  classify(text) {
    const route = ROUTES.find(candidate => candidate.test.test(text));
    return route ? { ...route } : { agent: 'atlas', capability: null };
  }

  async inspect(text, context = {}) {
    const route = this.classify(text);
    const agent = this.core.state.agents.get(route.agent);
    if (agent) this.core.startAgent(route.agent, { reason: 'intent_route' });
    this.world.observe('orchestrator', { text, route });

    try {
      let result = { route, status: 'planned' };
      if (route.capability) {
        result = { ...result, status: 'executing', result: await this.world.invoke(route.capability, context.input ?? {}, { agentId: route.agent, text }) };
      }
      if (route.entity) {
        const entity = this.world.entities.get(route.entity);
        result = { ...result, target: entity ? { id: entity.id, name: entity.name, status: entity.status } : null };
      }
      this.world.observe('orchestrator', { text, result });
      return result;
    } finally {
      if (agent) this.core.finishAgent(route.agent, { reason: 'intent_route_complete' });
    }
  }
}
