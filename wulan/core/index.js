import { WulanEventBus, WULAN_EVENTS } from './event-bus.js';
import { CapabilityRegistry } from './capabilities.js';
import { WulanMemoryStore } from './memory.js';
import { WulanLearningStore } from './learning.js';
import { WulanNeuralSubstrate } from './neural.js';
import { WulanAIGateway } from './ai-gateway.js';

export function createWulanCore(){
  const events=new WulanEventBus();
  const capabilities=new CapabilityRegistry();
  const memory=new WulanMemoryStore();
  const learning=new WulanLearningStore();
  const neural=new WulanNeuralSubstrate();
  const ai=new WulanAIGateway();
  const state={status:'booting',agents:new Map(),integrations:new Map()};
  const core={
    events,capabilities,memory,learning,neural,ai,state,
    registerAgent(agent){
      if(!agent?.id||!agent?.name)throw new TypeError('Agent requires id and name');
      if(state.agents.has(agent.id))throw new Error(`Agent already registered: ${agent.id}`);
      const registered=state.agents.set(agent.id,{status:'idle',...agent}).get(agent.id);
      neural.ensureNeuron({id:`agent:${agent.id}`,label:agent.name,type:'agent',strength:.5,tags:['agent',agent.role??'general']});
      return registered;
    },
    registerIntegration(integration){
      if(!integration?.id||!integration?.name)throw new TypeError('Integration requires id and name');
      if(state.integrations.has(integration.id))throw new Error(`Integration already registered: ${integration.id}`);
      return state.integrations.set(integration.id,{status:'disconnected',...integration}).get(integration.id);
    },
    startAgent(agentId,meta={}){const agent=state.agents.get(agentId);if(!agent)throw new Error(`Unknown agent: ${agentId}`);if(agent.status==='active')return agent;agent.status='active';events.emit(WULAN_EVENTS.AGENT_STARTED,{agentId,...meta});return agent;},
    finishAgent(agentId,meta={}){const agent=state.agents.get(agentId);if(!agent)throw new Error(`Unknown agent: ${agentId}`);agent.status='idle';events.emit(WULAN_EVENTS.AGENT_FINISHED,{agentId,...meta});return agent;},
    failAgent(agentId,error,meta={}){const agent=state.agents.get(agentId);if(!agent)throw new Error(`Unknown agent: ${agentId}`);agent.status='error';events.emit(WULAN_EVENTS.AGENT_FAILED,{agentId,error:error instanceof Error?error.message:String(error),...meta});return agent;},
    async invokeCapability(capabilityId,input,context={}){const correlationId=context.correlationId??`cap_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;events.emit(WULAN_EVENTS.TOOL_CALLED,{capabilityId,input},{correlationId});try{const result=await capabilities.invoke(capabilityId,input,{...context,core,correlationId});events.emit(WULAN_EVENTS.TOOL_FINISHED,{capabilityId,result},{correlationId});return result;}catch(error){events.emit(WULAN_EVENTS.TOOL_FAILED,{capabilityId,error:error instanceof Error?error.message:String(error)},{correlationId});throw error;}},
    recordFeedback(input){const record=learning.record(input);neural.ingestFeedback(record);events.emit(WULAN_EVENTS.LEARNING_FEEDBACK,{record});events.emit(WULAN_EVENTS.NEURAL_UPDATED,{reason:'feedback',recordId:record.id,stats:neural.stats()});return record;},
    remember(input){const memoryEntry=memory.add(input);neural.ingestMemory(memoryEntry);events.emit(WULAN_EVENTS.MEMORY_CREATED,{memory:memoryEntry});events.emit(WULAN_EVENTS.NEURAL_UPDATED,{reason:'memory',memoryId:memoryEntry.id,stats:neural.stats()});return memoryEntry;},
    searchMemory(query,options={}){const results=memory.search(query,options);neural.activate(query);events.emit(WULAN_EVENTS.MEMORY_RETRIEVED,{query,count:results.length});events.emit(WULAN_EVENTS.NEURAL_ACTIVATED,{query,trace:neural.snapshot({limit:24}).trace});return results;},
    boot(){if(state.status==='ready')return state;state.status='ready';events.emit(WULAN_EVENTS.SYSTEM_READY,{agents:[...state.agents.keys()],integrations:[...state.integrations.keys()],neural:neural.stats()});return state;}
  };
  return core;
}
