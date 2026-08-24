const normalize=value=>Array.isArray(value)?[...new Set(value.filter(Boolean).map(String))]:[];
const clone=value=>JSON.parse(JSON.stringify(value??null));
const resolvePath=(value,path)=>path.split('.').reduce((current,key)=>current==null?undefined:current[key],value);
const resolveInput=(value,results)=>{
  if(typeof value==='string'&&value.startsWith('$result.')){
    const [,taskId,...path]=value.split('.');
    return clone(resolvePath(results[taskId],path));
  }
  if(Array.isArray(value))return value.map(item=>resolveInput(item,results));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,resolveInput(item,results)]));
  return value;
};

export class WulanAgentSupervisor{
  constructor(core,{maxCandidates=20,maxTeamSteps=12}={}){if(!core)throw new TypeError('Agent supervisor requires Wulan core');this.core=core;this.maxCandidates=maxCandidates;this.maxTeamSteps=maxTeamSteps;}
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
  async coordinate(definition,{approvedCapabilities=[],signal}={}){
    const tasks=Array.isArray(definition?.tasks)?definition.tasks:[];
    if(!tasks.length)throw new TypeError('Coordination requires at least one task');
    if(tasks.length>this.maxTeamSteps)throw new Error(`TEAM_TASK_LIMIT_EXCEEDED: maximum ${this.maxTeamSteps} steps`);
    const ids=new Set();
    for(const task of tasks){
      if(!task?.id||ids.has(task.id))throw new Error(`INVALID_TEAM_TASK_ID: ${task?.id??'missing'}`);
      if(!task.capabilityId)throw new Error(`TEAM_CAPABILITY_REQUIRED: ${task.id}`);
      if(task.agentId&&!this.core.agentRuntime.get(task.agentId))throw new Error(`UNKNOWN_TEAM_AGENT: ${task.agentId}`);
      ids.add(task.id);
      for(const dependency of task.dependsOn??[]){if(dependency===task.id||!tasks.some(candidate=>candidate.id===dependency))throw new Error(`INVALID_TEAM_DEPENDENCY: ${task.id} -> ${dependency}`);}
    }
    this.#assertAcyclic(tasks);
    const state=new Map(tasks.map(task=>[task.id,{id:task.id,status:'pending',agentId:task.agentId??null,capabilityId:task.capabilityId,attempts:0}]));
    const results={};
    let progress=true;
    while(progress){
      progress=false;
      if(signal?.aborted)throw new Error('TEAM_COORDINATION_CANCELLED');
      for(const task of tasks){
        const current=state.get(task.id);
        if(current.status==='success'||current.status==='failed'||current.status==='blocked')continue;
        const dependencies=task.dependsOn??[];
        if(dependencies.some(id=>['failed','blocked'].includes(state.get(id)?.status))){current.status='blocked';current.error='DEPENDENCY_NOT_SUCCESSFUL';progress=true;continue;}
        if(dependencies.some(id=>state.get(id)?.status!=='success'))continue;
        let chosen;
        try{chosen=task.agentId?{agent:this.core.agentRuntime.get(task.agentId),score:null}:this.choose({tasks:[task]});
          const agent=chosen.agent;
          if(!normalize(agent.capabilities).includes(String(task.capabilityId)))throw new Error(`AGENT_CAPABILITY_DENIED: ${task.capabilityId}`);
          const resolvedInput=resolveInput(task.input??{},results);
          const assignment={name:`${definition.name??'Team'} / ${task.id}`,tasks:[{id:task.id,capabilityId:task.capabilityId,input:resolvedInput,expected:task.expected}]};
          current.status='running';current.agentId=agent.id;current.startedAt=new Date().toISOString();current.attempts+=1;
          const run=await this.core.agentRuntime.assign(agent.id,assignment,{approvedCapabilities,signal});
          if(run.status!=='completed')throw new Error(`TEAM_AGENT_TASK_${run.status.toUpperCase()}`);
          results[task.id]=run.result?.results?.[task.id]??run.result??run;
          current.result=results[task.id];current.status='success';current.finishedAt=new Date().toISOString();
        }catch(error){current.status='failed';current.error=String(error?.message??error);current.finishedAt=new Date().toISOString();}
        progress=true;
      }
      if(tasks.every(task=>['success','failed','blocked'].includes(state.get(task.id).status)))break;
    }
    const taskStates=tasks.map(task=>state.get(task.id));
    const status=taskStates.every(task=>task.status==='success')?'completed':taskStates.some(task=>task.status==='failed')?'partial':'blocked';
    const result={id:`team_${Date.now()}_${Math.random().toString(36).slice(2,9)}`,name:String(definition.name??'Wulan agent team'),status,tasks:taskStates,results,createdAt:new Date().toISOString(),finishedAt:new Date().toISOString()};
    this.core.remember({type:'agent-team',content:`Agent team “${result.name}” finished with status ${status}. Steps: ${taskStates.map(task=>`${task.id}:${task.status}:${task.agentId??'none'}`).join(', ')}`,importance:.68,confidence:.9,tags:['agent-team',status],source:'agent-supervisor'});
    return result;
  }
  status(){
    const agents=this.core.agentRuntime.list();
    return{agents:agents.map(agent=>({id:agent.id,name:agent.name,status:agent.status,capabilities:normalize(agent.capabilities)})),available:agents.filter(agent=>agent.status==='idle').length,runs:this.core.agentRuntime.stats()};
  }
  #assertAcyclic(tasks){const map=new Map(tasks.map(task=>[task.id,task]));const visiting=new Set(),visited=new Set();const visit=id=>{if(visiting.has(id))throw new Error(`TEAM_TASK_CYCLE_DETECTED: ${id}`);if(visited.has(id))return;visiting.add(id);for(const dep of map.get(id).dependsOn??[])visit(dep);visiting.delete(id);visited.add(id);};for(const task of tasks)visit(task.id);}
}