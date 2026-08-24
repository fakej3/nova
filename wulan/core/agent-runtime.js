const runId=()=>`agent_run_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;

const normalizeCapabilities=value=>Array.isArray(value)?[...new Set(value.filter(Boolean).map(String))]:[];

export class WulanAgentRuntime{
  constructor(core,{maxRuns=100}={}){
    if(!core)throw new TypeError('Agent runtime requires Wulan core');
    this.core=core;this.maxRuns=maxRuns;this.runs=[];
  }
  list(){return [...this.core.state.agents.values()].map(agent=>({...agent,capabilities:normalizeCapabilities(agent.capabilities)}));}
  get(agentId){return this.core.state.agents.get(agentId)??null;}
  configure(agentId,{capabilities,role,metadata}={}){
    const agent=this.get(agentId);if(!agent)throw new Error(`Unknown agent: ${agentId}`);
    if(capabilities!==undefined)agent.capabilities=normalizeCapabilities(capabilities);
    if(role!==undefined)agent.role=String(role);
    if(metadata!==undefined)agent.metadata=metadata&&typeof metadata==='object'?{...metadata}:{};
    agent.updatedAt=new Date().toISOString();this.#persist();return agent;
  }
  async assign(agentId,definition,{approvedCapabilities=[],signal}={}){
    const agent=this.get(agentId);if(!agent)throw new Error(`Unknown agent: ${agentId}`);
    const tasks=Array.isArray(definition?.tasks)?definition.tasks:[];if(!tasks.length)throw new TypeError('Agent assignment requires at least one task');
    const allowed=normalizeCapabilities(agent.capabilities);
    const unauthorized=tasks.map(task=>task?.capabilityId).filter(id=>!allowed.includes(id));
    if(unauthorized.length)throw new Error(`AGENT_CAPABILITY_DENIED: ${[...new Set(unauthorized)].join(', ')}`);
    const run={id:runId(),agentId,name:String(definition.name??`Agent task: ${agent.name}`),status:'assigned',createdAt:new Date().toISOString(),definition};
    this.runs.push(run);if(this.runs.length>this.maxRuns)this.runs.shift();
    agent.lastRunId=run.id;agent.status='assigned';this.#persist();
    return this.#execute(run,{approvedCapabilities,signal});
  }
  async #execute(run,options){
    const agent=this.get(run.agentId);this.core.startAgent(run.agentId,{runId:run.id});
    run.status='running';run.startedAt=new Date().toISOString();this.#persist();
    try{
      const orchestrator=this.core.cognition?.orchestrator;
      if(!orchestrator)throw new Error('AGENT_ORCHESTRATOR_UNAVAILABLE');
      const result=await orchestrator.run(run.definition,options);
      run.taskRunId=result.id;run.status=result.status==='completed'?'completed':result.status;run.result=result;run.finishedAt=new Date().toISOString();
      if(run.status==='completed')this.core.finishAgent(run.agentId,{runId:run.id});else this.core.failAgent(run.agentId,run.status,{runId:run.id});
      this.#persist();
      this.core.remember({type:'agent-experience',content:`Agent ${agent.name} completed assignment “${run.name}” with status ${run.status}.`,importance:.62,confidence:.9,tags:['agent-experience',agent.id,run.status],source:'agent-runtime'});
      return run;
    }catch(error){
      run.status='failed';run.error=String(error?.message??error);run.finishedAt=new Date().toISOString();this.core.failAgent(run.agentId,error,{runId:run.id});this.#persist();throw error;
    }
  }
  recent(limit=20){return this.runs.slice(-limit).reverse();}
  getRun(runId){return this.runs.find(run=>run.id===runId)??null;}
  stats(){return{runs:this.runs.length,running:this.runs.filter(run=>run.status==='running').length,completed:this.runs.filter(run=>run.status==='completed').length,failed:this.runs.filter(run=>['failed','partial'].includes(run.status)).length};}
  #persist(){try{this.core.persistence?.saveCore?.(this.core);}catch{}}
}
