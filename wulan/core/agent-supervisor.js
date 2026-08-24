const normalize=value=>Array.isArray(value)?[...new Set(value.filter(Boolean).map(String))]:[];

export class WulanAgentSupervisor{
  constructor(core,{maxCandidates=20}={}){if(!core)throw new TypeError('Agent supervisor requires Wulan core');this.core=core;this.maxCandidates=maxCandidates;}
  candidates(definition){
    const tasks=Array.isArray(definition?.tasks)?definition.tasks:[];
    if(!tasks.length)throw new TypeError('Dispatch requires at least one task');
    const required=normalize(tasks.map(task=>task?.capabilityId));
    return this.core.agentRuntime.list().map(agent=>{
      const capabilities=normalize(agent.capabilities);
      const missing=required.filter(id=>!capabilities.includes(id));
      const recent=this.core.agentRuntime.recent(50).filter(run=>run.agentId===agent.id);
      const failed=recent.filter(run=>['failed','partial'].includes(run.status)).length;
      const running=recent.filter(run=>run.status==='running').length;
      const statusPenalty=agent.status==='error'?5:agent.status==='active'||agent.status==='assigned'?2:0;
      const capabilityScore=required.length?((required.length-missing.length)/required.length)*10:0;
      const reliability=Math.max(0,5-failed);
      const score=missing.length?Number.NEGATIVE_INFINITY:capabilityScore+reliability-statusPenalty-running;
      return{agent,score,missing,required,running,failed};
    }).filter(candidate=>candidate.missing.length===0).sort((a,b)=>b.score-a.score).slice(0,this.maxCandidates);
  }
  choose(definition){
    const candidates=this.candidates(definition);
    if(!candidates.length)throw new Error('NO_AGENT_CAN_EXECUTE_TASK');
    return candidates[0];
  }
  async dispatch(definition,options={}){
    const chosen=this.choose(definition);
    const result=await this.core.agentRuntime.assign(chosen.agent.id,definition,options);
    return{agentId:chosen.agent.id,score:chosen.score,candidates:this.candidates(definition).map(({agent,score,missing,running,failed})=>({agentId:agent.id,score,missing,running,failed})),run:result};
  }
  status(){
    const agents=this.core.agentRuntime.list();
    return{agents:agents.map(agent=>({id:agent.id,name:agent.name,status:agent.status,capabilities:normalize(agent.capabilities)})),available:agents.filter(agent=>agent.status==='idle').length,runs:this.core.agentRuntime.stats()};
  }
}
