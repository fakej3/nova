import { createDefaultWulanCore } from './manifest.js';
import { MEMORY_TYPES } from './memory.js';
import { LEARNING_OUTCOMES } from './learning.js';

export async function runWulanCoreSmokeTest() {
  const core = createDefaultWulanCore();
  const seen = [];
  core.events.on('*', event => seen.push(event.type));

  core.boot();
  if (core.state.status !== 'ready') throw new Error('Core did not boot');

  core.startAgent('atlas');
  core.finishAgent('atlas');
  if (core.state.agents.get('atlas').status !== 'idle') throw new Error('Agent lifecycle failed');

  core.remember({ type: MEMORY_TYPES.PREFERENCE, content: 'Prefer concise explanations', tags: ['communication'] });
  if (core.searchMemory('concise').length !== 1) throw new Error('Memory search failed');

  core.recordFeedback({
    outcome: LEARNING_OUTCOMES.EXPLICIT_PREFERENCE,
    context: 'Response style',
    candidatePreference: 'concise explanations',
  });

  core.capabilities.register({
    id: 'test.echo',
    name: 'Echo',
    execute: async input => ({ echoed: input }),
  });
  const result = await core.invokeCapability('test.echo', { ok: true });
  if (!result?.echoed?.ok) throw new Error('Capability invocation failed');

  const required = ['system.ready', 'agent.started', 'agent.finished', 'memory.created', 'memory.retrieved', 'learning.feedback', 'tool.called', 'tool.finished'];
  for (const event of required) {
    if (!seen.includes(event)) throw new Error(`Missing event: ${event}`);
  }

  return { ok: true, events: seen };
}
