import { createWulanCore } from '../wulan/core/index.js';

let persisted = null;
const persistence = {
  available: () => true,
  load: () => persisted,
  saveCore: core => {
    persisted = {
      version: 5,
      savedAt: new Date().toISOString(),
      memories: core.memory.list({ limit: 5000 }),
      learning: core.learning.recent(5000),
      neural: core.neural.exportState(),
      semantic: core.semantic.exportState(),
      tasks: core.cognition?.orchestrator?.recent(100) ?? [],
      teamRuns: core.agentSupervisor?.recentTeams?.(100) ?? [],
      teamContexts: core.teamContext?.recent?.(100) ?? [],
    };
    return true;
  },
};
const fail = message => { throw new Error(`[nova-team-context-smoke] ${message}`); };
const assert = (condition, message) => { if (!condition) fail(message); };

const core = createWulanCore({ persistence });
core.registerAgent({ id: 'atlas', name: 'ATLAS', role: 'research' });
core.registerAgent({ id: 'leon', name: 'LEON', role: 'engineering' });
core.registerAgent({ id: 'oracle', name: 'ORACLE', role: 'analysis' });
core.boot();

core.agentRuntime.configure('atlas', { capabilities: ['memory.remember'] });
core.agentRuntime.configure('leon', { capabilities: ['memory.remember', 'memory.search'] });
core.agentRuntime.configure('oracle', { capabilities: ['memory.search'] });

const team = await core.agentSupervisor.coordinate({
  name: 'shared blackboard verification',
  tasks: [
    {
      id: 'research',
      agentId: 'atlas',
      capabilityId: 'memory.remember',
      input: { content: 'Shared blackboard research evidence.', type: 'fact', tags: ['team-context-smoke'] },
      publish: ['facts', 'artifacts'],
    },
    {
      id: 'decision',
      agentId: 'leon',
      capabilityId: 'memory.remember',
      dependsOn: ['research'],
      input: { content: '$result.research.result.content', type: 'fact', tags: ['team-context-smoke-decision'] },
      publish: ['decisions'],
    },
    {
      id: 'verification',
      agentId: 'oracle',
      capabilityId: 'memory.search',
      dependsOn: ['decision'],
      input: { query: 'Shared blackboard research evidence.', limit: 3 },
      publish: ['warnings'],
    },
  ],
});

assert(team.status === 'completed', `team ended in ${team.status}`);
assert(team.tasks.every(task => task.status === 'success'), 'not every blackboard team step succeeded');

const context = core.agentSupervisor.context(team.id, 'read');
assert(context.facts.length === 1, `expected one shared fact, got ${context.facts.length}`);
assert(context.decisions.length === 1, `expected one shared decision, got ${context.decisions.length}`);
assert(context.warnings.length === 1, `expected one shared warning, got ${context.warnings.length}`);
assert(context.artifacts.length === 1, `expected one shared artifact, got ${context.artifacts.length}`);
assert(context.facts[0].source === 'atlas', 'fact source was not preserved');
assert(context.decisions[0].source === 'leon', 'decision source was not preserved');
assert(context.warnings[0].source === 'oracle', 'warning source was not preserved');
assert(context.artifacts[0].source === 'atlas', 'artifact source was not preserved');
assert(persisted?.teamContexts?.some(item => item.id === team.id), 'team context was not persisted');

const restored = createWulanCore({ persistence });
const restoredContext = restored.agentSupervisor.context(team.id, 'read');
assert(restoredContext.facts.length === 1, 'restored context lost facts');
assert(restoredContext.decisions.length === 1, 'restored context lost decisions');
assert(restoredContext.warnings.length === 1, 'restored context lost warnings');
assert(restoredContext.artifacts.length === 1, 'restored context lost artifacts');
assert(restoredContext.facts[0].value.content === 'Shared blackboard research evidence.', 'restored fact content changed');

console.log(JSON.stringify({
  ok: true,
  teamId: team.id,
  teamStatus: team.status,
  facts: restoredContext.facts.length,
  decisions: restoredContext.decisions.length,
  warnings: restoredContext.warnings.length,
  artifacts: restoredContext.artifacts.length,
  persistence: 'restored',
}, null, 2));
