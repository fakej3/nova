import { createWulanCore } from './index.js';
import { WulanWorld, seedWulanWorld } from './world.js';
import { WulanOrchestrator } from './orchestrator.js';
import { registerGithubCapabilities } from '../tools/github.js';
import { registerSentinelCapabilities } from '../tools/sentinel.js';

async function serverGenerate(request) {
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ messages: request.messages ?? [], system: request.system ?? '' }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `AI_${response.status}`);
  return data.text;
}

export function createDefaultWulanCore(){
  const core = createWulanCore();

  core.registerAgent({ id:'atlas', name:'ATLAS', role:'research' });
  core.registerAgent({ id:'leon', name:'LEON', role:'engineering' });
  core.registerAgent({ id:'oracle', name:'ORACLE', role:'analysis' });
  core.registerAgent({ id:'pixel', name:'PIXEL', role:'creative' });

  core.registerIntegration({ id:'sentinel', name:'Sentinel', kind:'trading' });
  core.registerIntegration({ id:'edgelab', name:'EdgeLab', kind:'research' });
  core.registerIntegration({ id:'github', name:'GitHub', kind:'development' });
  core.registerIntegration({ id:'vercel', name:'Vercel', kind:'deployment' });

  core.ai.registerProvider({ id:'wulan-server', name:'Wulan Server AI', generate:serverGenerate, capabilities:['chat'] });

  const world = seedWulanWorld(WulanWorld.load());
  registerGithubCapabilities(world);
  registerSentinelCapabilities(world);
  const orchestrator = new WulanOrchestrator({ core, world });

  core.world = world;
  core.orchestrator = orchestrator;
  core.boot();
  return core;
}
