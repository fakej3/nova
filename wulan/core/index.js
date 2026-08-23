import { WulanEventBus, WULAN_EVENTS } from './event-bus.js';
import { CapabilityRegistry } from './capabilities.js';
import { WulanMemoryStore } from './memory.js';
import { WulanLearningStore } from './learning.js';
import { WulanNeuralSubstrate } from './neural.js';
import { WulanSemanticMemory } from './semantic-memory.js';
import { WulanAIGateway } from './ai-gateway.js';
import { WulanCognitionLoop } from './cognition.js';
import { WulanWorldModel, seedWulanWorld } from './world.js';
import { createObservationIngestor } from './observation.js';
import { connectWorldReconciliation } from './reconciliation-events.js';
import { assessWorldChange, connectChangeSignificance } from './change-significance.js';
import { createChangeTrail } from './change-trail.js';
import { createSentinelInspector } from '../integrations/sentinel.js';
import { registerStrategyLab } from './strategy-lab.js';

export function createWulanCore(){
  const events=new WulanEventBus();
  const world=seedWulanWorld(new WulanWorldModel());
  const observationIngestor=createObservationIngestor({world,events});
  const capabilities=new CapabilityRegistry({observationIngestor});
  const reconciliation=connectWorldReconciliation({world,events});
  const significance=connectChangeSignificance({events});
  const memory=new WulanMemoryStore(); const learning=new WulanLearningStore(); const neural=new WulanNeuralSubstrate(); const semantic=new WulanSemanticMemory(); const ai=new WulanAIGateway();
  const state={status:'booting',agents:new Map(),integrations:new Map()};
  const core={events,world,observationIngestor,reconciliation,significance,capabilities,memory,learning,neural,semantic,ai,state,
    registerAgent(agent){if(!agent?.id||!agent?.name)throw new TypeError('Agent requires id and name');if(state.agents.has(agent.id))throw new Error(`Agent already registered: ${agent.id}`);const registered=state.agents.set(agent.id,{status:'idle',...agent}).get(agent.id);neural.ensureNeuron({id:`agent:${agent.id}`,label:agent.name,type:'agent',strength:.5,tags:['agent',agent.role??'general']});return registered;},
    registerIntegration(integration){if(!integration?.id||!integration?.name)throw new TypeError('Integration requires id and name');if(state.integrations.has(integration.id))throw new Error(`Integration already registered: ${integration.id}`);const registered=state.integrations.set(integration.id,{status:'disconnected',...integration}).get(integration.id);if(integration.id==='sentinel')world.upsertProject({id:'sentinel',name:'Sentinel',repository:integration.repository??'fakej3/Sentinel',branch:integration.branch??'main',capabilities:['github.inspect','sentinel.inspect']});return registered;},
    startAgent(agentId,meta={}){const agent=state.agents.get(agentId);if(!agent)throw new Error(`Unknown agent: ${agentId}`);if(agent.status==='active')return agent;agent.status='active';events.emit(WULAN_EVENTS.AGENT_STARTED,{agentId,...meta});return agent;},
    finishAgent(agentId,meta={}){const agent=state.agents.get(agentId);if(!agent)throw new Error(`Unknown agent: ${agentId}`);agent.status='idle';events.emit(WULAN_EVENTS.AGENT_FINISHED,{agentId,...meta});return agent;},
    failAgent(agentId,error,meta={}){const agent=state.agents.get(agentId);if(!agent)throw new Error(`Unknown agent: ${agentId}`);agent.status='error';events.emit(WULAN_EVENTS.AGENT_FAILED,{agentId,error:error instanceof Error?error.message:String(error),...meta});return agent;},
    async invokeCapability(capabilityId,input,context={}){const correlationId=context.correlationId??`cap_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;events.emit(WULAN_EVENTS.TOOL_CALLED,{capabilityId,input},{correlationId});try{const result=await capabilities.invoke(capabilityId,input,{...context,core,correlationId});events.emit(WULAN_EVENTS.TOOL_FINISHED,{capabilityId,result},{correlationId});return result;}catch(error){events.emit(WULAN_EVENTS.TOOL_FAILED,{capabilityId,error:error instanceof Error?error.message:String(error)},{correlationId});throw error;}},
    recordFeedback(input){const safeInput={...input};if(safeInput.source==='conversation'&&safeInput.outcome==='accepted'&&ai.status().lastError)safeInput.outcome='none';const record=learning.record(safeInput);if(safeInput.outcome!=='none'){neural.ingestFeedback(record);if(neural.stats().updates%25===0)neural.consolidate();}events.emit(WULAN_EVENTS.LEARNING_FEEDBACK,{record});events.emit(WULAN_EVENTS.NEURAL_UPDATED,{reason:'feedback',recordId:record.id,stats:neural.stats()});return record;},
    remember(input){const memoryEntry=memory.add(input);neural.ingestMemory(memoryEntry);const activationInput=String(input?.content??memoryEntry.content??'').trim();if(activationInput)neural.activate(activationInput,{limit:24,hops:3,reinforce:true});events.emit(WULAN_EVENTS.MEMORY_CREATED,{memory:memoryEntry});events.emit(WULAN_EVENTS.NEURAL_ACTIVATED,{query:activationInput,trace:neural.snapshot({limit:24}).trace});events.emit(WULAN_EVENTS.NEURAL_UPDATED,{reason:'memory',memoryId:memoryEntry.id,stats:neural.stats()});return memoryEntry;},
    async rememberSemantic(input,{providerId}={}){const entry=this.remember(input);const vector=await ai.embed(entry.content,{providerId});semantic.upsert(entry.id,entry.content,vector,{type:entry.type,tags:entry.tags,importance:entry.importance,confidence:entry.confidence});return entry;},
    searchMemory(query,options={}){const results=memory.search(query,options);neural.activate(query,{limit:24,hops:3,reinforce:true});events.emit(WULAN_EVENTS.MEMORY_RETRIEVED,{query,count:results.length});events.emit(WULAN_EVENTS.NEURAL_ACTIVATED,{query,trace:neural.snapshot({limit:24}).trace});return results;},
    async searchSemanticMemory(query,{limit=10,minScore=.35,providerId}={}){const vector=await ai.embed(query,{providerId});const hits=semantic.search(vector,{limit,minScore});neural.activate(query,{limit:24,hops:3,reinforce:true});events.emit(WULAN_EVENTS.MEMORY_RETRIEVED,{query,count:hits.length,mode:'semantic'});events.emit(WULAN_EVENTS.NEURAL_ACTIVATED,{query,trace:neural.snapshot({limit:24}).trace,mode:'semantic'});return hits.map(hit=>({memory:memory.get(hit.id),score:hit.score,mode:'semantic'})).filter(result=>result.memory);},
    consolidateNeural(options={}){const result=neural.consolidate(options);events.emit(WULAN_EVENTS.NEURAL_UPDATED,{reason:'consolidation',...result});return result;},
    boot(){if(state.status==='ready')return state;neural.consolidate();state.status='ready';events.emit(WULAN_EVENTS.SYSTEM_READY,{agents:[...state.agents.keys()],integrations:[...state.integrations.keys()],neural:neural.stats(),semantic:semantic.stats(),world:{projects:world.listProjects().length,systems:world.listSystems().length}});return state;}
  };
  core.capabilities.register({id:'memory.search',name:'Memory Search',description:'Search Wulan memory using lexical retrieval and semantic retrieval when embeddings are available.',risk:'read',permissions:['memory:read'],inputSchema:{query:'string',limit:'number?'},execute:async({query,limit=8}={})=>{const text=String(query??'').trim();if(!text)return{lexical:[],semantic:[]};const lexical=core.searchMemory(text,{limit});let semanticHits=[];try{if(core.ai.status().available&&core.semantic.stats().entries>0)semanticHits=await core.searchSemanticMemory(text,{limit});}catch{}return{lexical,semantic:semanticHits};}});
  core.capabilities.register({id:'memory.remember',name:'Remember',description:'Store an explicit durable memory for Wulan.',risk:'write',permissions:['memory:write'],inputSchema:{content:'string',type:'string?',importance:'number?',tags:'string[]?'},execute:async({content,type='fact',importance=.7,tags=[]}={})=>{if(!String(content??'').trim())throw new Error('Memory content is required');return core.remember({content,type,importance,tags,source:'capability'});}});
  core.capabilities.register({id:'system.status',name:'System Status',description:'Inspect Wulan runtime and subsystem status.',risk:'read',permissions:['system:read'],execute:async()=>({status:state.status,agents:[...state.agents.values()],integrations:[...state.integrations.values()],capabilities:capabilities.list(),neural:neural.stats(),semantic:semantic.stats(),world:world.snapshot()})});
  const sentinelInspector=createSentinelInspector();
  core.capabilities.register({id:'sentinel.inspect',name:'Inspect Sentinel',description:'Read-only inspection of the Sentinel GitHub repository and its Vercel project.',risk:'read',permissions:['github:read','vercel:read'],inputSchema:{repo:'string?',branch:'string?',paths:'string[]?'},execute:async(input={})=>sentinelInspector(input)});
  core.capabilities.register({id:'world.change_assess',name:'Assess World Change',description:'Assess whether a detected world change is insignificant, relevant, or critical.',risk:'read',permissions:['world:read'],inputSchema:{event:'object'},execute:async({event}={})=>assessWorldChange(event)});
  registerStrategyLab(core);
  core.cognition=new WulanCognitionLoop(core);
  core.cognize=(input,options={})=>core.cognition.run(input,options);
  core.changeTrail=createChangeTrail({memory,events});
  events.on('world.change_assessed',event=>{if(!event.payload?.shouldReason)return;const {level,source,subject,totalChanges,fields}=event.payload;void core.cognize(`World change detected (${level}) for ${subject ?? source ?? 'unknown'}: ${totalChanges} changed field(s). Fields: ${fields.join(', ')}`,{execute:false,context:{trigger:'world-change',severity:level,source,subject}});});
  return core;
}