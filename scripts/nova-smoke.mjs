import { createWulanCore } from '../wulan/core/index.js';

let persisted = null;
const persistence = {
  available: () => true,
  load: () => persisted,
  save: ({ core, memories = [] } = {}) => {
    persisted = core ? {
      version: 4,
      savedAt: new Date().toISOString(),
      memories: core.memory.list({ limit: 5000 }),
      learning: core.learning.recent(5000),
      neural: core.neural.exportState(),
      semantic: core.semantic.exportState(),
      tasks: core.cognition?.orchestrator?.recent(100) ?? [],
    } : { version: 4, savedAt: new Date().toISOString(), memories };
    return true;
  },
};
const fail = message => { throw new Error(`[nova-smoke] ${message}`); };
const assert = (condition, message) => { if (!condition) fail(message); };

const core = createWulanCore({ persistence });
for (const [id, name, role] of [['atlas', 'ATLAS', 'research'], ['leon', 'LEON', 'engineering'], ['oracle', 'ORACLE', 'analysis'], ['pixel', 'PIXEL', 'interface']]) core.registerAgent({ id, name, role });
core.registerIntegration({ id: 'smoke', name: 'Smoke Integration', kind: 'test' });
core.boot();

const health = core.health?.check?.();
assert(health?.overall === 'healthy', `runtime health is ${health?.overall ?? 'missing'}`);
assert(core.neural.stats().neurons >= 5, 'baseline neural topology was not created');
assert(core.neural.stats().synapses >= 8, 'baseline neural topology has too few synapses');
assert(core.agentRuntime?.list?.().length === 4, 'agent runtime did not expose all registered agents');

core.agentRuntime.configure('atlas', { capabilities: ['memory.remember'] });
core.agentRuntime.configure('leon', { capabilities: ['memory.remember', 'memory.search'] });
core.agentRuntime.configure('oracle', { capabilities: ['memory.search'] });
core.agentRuntime.configure('pixel', { capabilities: [] });

const dispatched = await core.agentSupervisor.dispatch({
  name: 'agent dispatch assignment',
  tasks: [{ id: 'remember', capabilityId: 'memory.remember', input: { content: 'Supervisor dispatch memory.', type: 'fact', tags: ['smoke-supervisor'] } }],
});
assert(dispatched.agentId === 'leon' || dispatched.agentId === 'atlas', `supervisor chose unexpected agent ${dispatched.agentId}`);
assert(dispatched.run?.status === 'completed', `dispatched assignment ended in ${dispatched.run?.status}`);
assert(dispatched.candidates?.some(candidate => candidate.agentId === 'leon'), 'supervisor did not expose capable candidate');

const agentRun = await core.agentRuntime.assign('leon', {
  name: 'agent smoke assignment',
  tasks: [
    { id: 'remember', capabilityId: 'memory.remember', input: { content: 'Agent runtime memory.', type: 'fact', tags: ['smoke-agent'] } },
    { id: 'search', capabilityId: 'memory.search', dependsOn: ['remember'], input: { query: 'Agent runtime memory.', limit: 3 } },
  ],
});
assert(agentRun.status === 'completed', `agent assignment ended in ${agentRun.status}`);
assert(core.agentRuntime.get('leon')?.status === 'idle', 'agent did not return to idle after completion');
assert(agentRun.result?.results?.search?.result?.lexical?.length > 0, 'agent dependent search returned no memory');

let denied = false;
try { await core.agentRuntime.assign('leon', { name: 'denied assignment', tasks: [{ id: 'status', capabilityId: 'system.status', input: {} }] }); } catch (error) { denied = String(error?.message).includes('AGENT_CAPABILITY_DENIED'); }
assert(denied, 'agent capability boundary did not reject an unauthorized capability');

const remembered = core.remember({ content: 'Nova smoke test memory survives persistence.', type: 'fact', importance: 0.8, tags: ['smoke-test'] });
assert(remembered?.id, 'memory creation failed');
assert(core.searchMemory('smoke test memory').length > 0, 'memory retrieval failed');
assert(persisted?.memories?.some(entry => entry.id === remembered.id), 'memory was not persisted');

const task = await core.cognition.executeTaskGraph({
  name: 'smoke dependency graph',
  tasks: [
    { id: 'remember', capabilityId: 'memory.remember', input: { content: 'Task graph memory.', type: 'fact', tags: ['smoke-task'] } },
    { id: 'search', capabilityId: 'memory.search', dependsOn: ['remember'], input: { query: 'Task graph memory.', limit: 3 } },
  ],
});
assert(task?.status === 'completed', `task orchestration ended in ${task?.status ?? 'missing'}`);
assert(task.tasks?.every(step => step.status === 'success'), 'not every task graph step succeeded');
assert(task.results?.search?.result?.lexical?.length > 0, 'dependent search task returned no memory');
assert(persisted?.tasks?.some(run => run.id === task.id), 'completed task run was not persisted');

core.capabilities.register({ id: 'smoke.approval', name: 'Smoke Approval', risk: 'write', requiresApproval: true, execute: async () => ({ approved: true }) });
const blocked = await core.cognition.executeTaskGraph({ name: 'smoke recovery', tasks: [{ id: 'approval', capabilityId: 'smoke.approval', input: {} }] });
assert(blocked.status === 'partial', `approval gate did not block: ${blocked.status}`);
assert(blocked.tasks[0].status === 'blocked', 'approval-gated task was not blocked');
const resumed = await core.cognition.orchestrator.resume(blocked.id, { approvedCapabilities: ['smoke.approval'] });
assert(resumed.status === 'completed', `task recovery ended in ${resumed.status}`);
assert(resumed.tasks[0].status === 'success', 'blocked task did not resume successfully');

const cognition = await core.cognize('what is the system status?', { execute: false });
assert(cognition?.status === 'planned' || cognition?.status === 'completed', `cognition ended in ${cognition?.status ?? 'missing'}`);
assert(cognition?.plan?.intent === 'system_status', 'deterministic cognition fallback did not identify system status');
assert(core.memory.list({ limit: 100 }).some(entry => entry.type === 'experience'), 'cognition experience was not recorded');

const restored = createWulanCore({ persistence });
assert(restored.searchMemory('smoke test memory').length > 0, 'persisted memory did not restore into a new core');
assert(restored.cognition.orchestrator.get(task.id)?.status === 'completed', 'completed task state did not restore into a new core');
const restoredHealth = restored.health?.check?.(['memory', 'persistence']);
assert(restoredHealth?.overall !== 'failed', 'restored core has a failed memory/persistence health check');

console.log(JSON.stringify({ ok: true, health: health.overall, restoredHealth: restoredHealth.overall, agents: core.agentRuntime.stats(), supervisor: core.agentSupervisor.status(), neurons: core.neural.stats().neurons, synapses: core.neural.stats().synapses, memories: core.memory.list({ limit: 100 }).length, task: task.status, recovery: resumed.status, cognition: cognition.status, dispatchedAgent: dispatched.agentId, experienceRecorded: true }, null, 2));