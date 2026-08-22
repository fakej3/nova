import { createStrategyLabInspector } from '../integrations/strategy-lab.js';

export function registerStrategyLab(core, { inspector = createStrategyLabInspector() } = {}) {
  if (!core?.capabilities || !core?.world) throw new TypeError('Wulan core with capabilities and world is required');

  core.world.upsertProject({
    id: 'strategy-lab',
    name: 'Strategy Lab',
    type: 'strategy-research',
    repository: 'fakej3/strategy-lab',
    branch: 'claude/trading-lab-architecture-e4212v',
    facade: 'lab/',
    capabilities: ['strategy-lab.inspect']
  });

  return core.capabilities.register({
    id: 'strategy-lab.inspect',
    name: 'Inspect Strategy Lab',
    description: 'Read-only inspection of the Strategy Lab research system and repository state.',
    risk: 'read',
    permissions: ['github:read'],
    inputSchema: { repo: 'string?', branch: 'string?', paths: 'string[]?' },
    execute: async (input = {}) => inspector(input)
  });
}
