import { createWulanCore } from './index.js';
import { WulanWorld, seedWulanWorld } from './world.js';
import { WulanOrchestrator } from './orchestrator.js';
import { registerGithubCapabilities } from '../tools/github.js';
import { registerSentinelCapabilities } from '../tools/sentinel.js';
import { createRemoteProvider } from '../../services/ai-gateway-client.js';

export function createDefaultWulanCore(){
  const core = createWulanCore();

  // Specialist agents are roles. Models are providers underneath them.
  // This keeps the world stable when we swap models later.
  core.registerAgent({ id:'atlas', name:'ATLAS', role:'research', providerId:'gemini' });
  core.registerAgent({ id:'leon', name:'LEON', role:'engineering', providerId:'anthropic' });
  core.registerAgent({ id:'oracle', name:'ORACLE', role:'analysis', providerId:'openai' });
  core.registerAgent({ id:'pixel', name:'PIXEL', role:'creative', providerId:'gemini' });

  core.registerIntegration({ id:'sentinel', name:'Sentinel', kind:'trading' });
  core.registerIntegration({ id:'edgelab', name:'EdgeLab', kind:'research' });
  core.registerIntegration({ id:'github', name:'GitHub', kind:'development' });
  core.registerIntegration({ id:'vercel', name:'Vercel', kind:'deployment' });

  core.ai.registerProvider({
    ...createRemoteProvider({
      id:'gemini',
      name:'Google Gemini',
      capabilities:['chat','vision','reasoning','tools'],
      priority:10,
    }),
  });
  core.ai.registerProvider({
    ...createRemoteProvider({
      id:'openai',
      name:'OpenAI / ChatGPT',
      capabilities:['chat','reasoning','tools'],
      priority:20,
    }),
  });
  core.ai.registerProvider({
    ...createRemoteProvider({
      id:'anthropic',
      name:'Anthropic / Claude',
      capabilities:['chat','reasoning','coding','tools'],
      priority:30,
    }),
  });

  const world = seedWulanWorld(WulanWorld.load());
  for (const provider of core.ai.listProviders()) {
    world.upsertEntity({
      id: `provider:${provider.id}`,
      name: provider.name,
      kind: 'ai-provider',
      status: 'available-via-gateway',
      metadata: { providerId: provider.id, capabilities: provider.capabilities },
    });
    world.relate('wulan', `provider:${provider.id}`, 'can_route_to');
  }

  registerGithubCapabilities(world);
  registerSentinelCapabilities(world);
  const orchestrator = new WulanOrchestrator({ core, world });

  core.world = world;
  core.orchestrator = orchestrator;
  core.boot();
  return core;
}
