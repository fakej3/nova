import { createWulanCore } from './index.js';
import { callGemini } from '../../services/gemini.js';

export function createDefaultWulanCore() {
  const core = createWulanCore();

  core.ai.registerProvider({
    id: 'gemini-free',
    name: 'Gemini 2.5 Flash',
    capabilities: ['text', 'chat', 'multimodal-ready'],
    generate: (request = {}) => callGemini(request.messages || [], request.system || '', request.source || 'wulan'),
  });

  core.ai.setDefaultProvider('gemini-free');

  core.registerAgent({ id: 'atlas', name: 'ATLAS', role: 'research' });
  core.registerAgent({ id: 'leon', name: 'LEON', role: 'engineering' });
  core.registerAgent({ id: 'oracle', name: 'ORACLE', role: 'analysis' });
  core.registerAgent({ id: 'pixel', name: 'PIXEL', role: 'creative' });

  core.registerIntegration({ id: 'sentinel', name: 'Sentinel', kind: 'trading' });
  core.registerIntegration({ id: 'edgelab', name: 'EdgeLab', kind: 'research' });
  core.registerIntegration({ id: 'github', name: 'GitHub', kind: 'development' });

  return core;
}
