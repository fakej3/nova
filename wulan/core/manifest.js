import { createWulanCore } from './index.js';
import { WulanWorld, seedWulanWorld } from './world.js';
import { WulanOrchestrator } from './orchestrator.js';
import { WulanNeuralLayer } from './neural-learning.js';
import { WulanConsolidationEngine } from './consolidation.js';
import { WulanKnowledgeGraph } from './knowledge-graph.js';
import { registerGithubCapabilities } from '../tools/github.js';
import { registerSentinelCapabilities } from '../tools/sentinel.js';
import { createRemoteProvider } from '../../services/ai-gateway-client.js';

export function createDefaultWulanCore(){
  const core = createWulanCore();
  core.registerAgent({ id:'atlas', name:'ATLAS', role:'research', providerId:'gemini' });
  core.registerAgent({ id:'leon', name:'LEON', role:'engineering', providerId:'anthropic' });
  core.registerAgent({ id:'oracle', name:'ORACLE', role:'analysis', providerId:'openai' });
  core.registerAgent({ id:'pixel', name:'PIXEL', role:'creative', providerId:'gemini' });
  core.registerIntegration({ id:'sentinel', name:'Sentinel', kind:'trading' });
  core.registerIntegration({ id:'edgelab', name:'EdgeLab', kind:'research' });
  core.registerIntegration({ id:'github', name:'GitHub', kind:'development' });
  core.registerIntegration({ id:'vercel', name:'Vercel', kind:'deployment' });
  core.ai.registerProvider({ ...createRemoteProvider({ id:'gemini', name:'Google Gemini', capabilities:['chat','vision','reasoning','tools'], priority:10 }) });
  core.ai.registerProvider({ ...createRemoteProvider({ id:'openai', name:'OpenAI / ChatGPT', capabilities:['chat','reasoning','tools'], priority:20 }) });
  core.ai.registerProvider({ ...createRemoteProvider({ id:'anthropic', name:'Anthropic / Claude', capabilities:['chat','reasoning','coding','tools'], priority:30 }) });
  const world=seedWulanWorld(WulanWorld.load());
  for(const provider of core.ai.listProviders()){world.upsertEntity({id:`provider:${provider.id}`,name:provider.name,kind:'ai-provider',status:'available-via-gateway',metadata:{providerId:provider.id,capabilities:provider.capabilities}});if(![...world.relations.values()].some(r=>r.from==='wulan'&&r.to===`provider:${provider.id}`&&r.type==='can_route_to'))world.relate('wulan',`provider:${provider.id}`,'can_route_to');}
  registerGithubCapabilities(world);registerSentinelCapabilities(world);
  const neural=new WulanNeuralLayer({agents:[...core.state.agents.keys()]});
  const consolidation=new WulanConsolidationEngine({memory:core.memory,learning:core.learning,neural});
  const knowledge=new WulanKnowledgeGraph({world});
  core.neural=neural;core.consolidation=consolidation;core.knowledge=knowledge;
  const originalRecordFeedback=core.recordFeedback.bind(core);
  core.recordFeedback=(input)=>{const record=originalRecordFeedback(input);try{const pattern=consolidation.learnFromFeedback({context:input.context,outcome:input.outcome,agent:input.candidatePreference,correction:input.correction,candidatePreference:input.candidatePreference,confidence:input.confidence});if(pattern)knowledge.learnFromPattern(pattern);knowledge.learnFromExperience({text:input.context,agent:input.candidatePreference,outcome:input.outcome,correction:input.correction});}catch{/* learning must never break primary task */}return record;};
  const orchestrator=new WulanOrchestrator({core,world});core.world=world;core.orchestrator=orchestrator;core.boot();return core;
}