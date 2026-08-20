import { createWulanCore } from './index.js';

export function createDefaultWulanCore() {
  const core = createWulanCore();

  core.registerAgent({ id: 'atlas', name: 'ATLAS', role: 'research' });
  core.registerAgent({ id: 'leon', name: 'LEON', role: 'engineering' });
  core.registerAgent({ id: 'oracle', name: 'ORACLE', role: 'analysis' });
  core.registerAgent({ id: 'pixel', name: 'PIXEL', role: 'creative' });

  core.registerIntegration({ id: 'sentinel', name: 'Sentinel', kind: 'trading' });
  core.registerIntegration({ id: 'edgelab', name: 'EdgeLab', kind: 'research' });
  core.registerIntegration({ id: 'github', name: 'GitHub', kind: 'development' });

  return core;
}
