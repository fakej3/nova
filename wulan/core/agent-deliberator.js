const clone=value=>JSON.parse(JSON.stringify(value??null));
const text=value=>String(value??'').trim();

export class WulanAgentDeliberator{
  constructor(core,{maxSteps=12}={}){
    if(!core)throw new TypeError('Agent deliberator requires Wulan core');
    this.core=core;this.maxSteps=maxSteps;
  }

  #agents(){return this.core.agentRuntime?.list?.()??[];}

  #choose(capabilityId,used=[]){
    const candidates=this.#agents().filter(agent=>Array.isArray(agent.capabilities)&&agent.capabilities.includes(capabilityId)&&agent.status!=='error');
    if(!candidates.length)return null;
    const recent=this.core.agentRuntime.recent(50);
    return candidates.map(agent=>{
      const runs=recent.filter(run=>run.agentId===agent.id);
      const failures=runs.filter(run=>['failed','partial'].includes(run.status)).length;
      const active=runs.filter(run=>run.status==='running').length;
      const reuse=used.includes(agent.id)?-1:1;
      return {agent,score:10-(failures*2)-active+reuse};
    }).sort((a,b)=>b.score-a.score)[0].agent;
  }

  #normalizeSteps(definition){
    const supplied=Array.isArray(definition?.steps)?definition.steps:[];
    if(!supplied.length)throw new TypeError('Deliberation requires at least one step');
    if(supplied.length>this.maxSteps)throw new Error(`DELIBERATION_STEP_LIMIT_EXCEEDED: maximum ${this.maxSteps} steps`);
    const ids=new Set();
    return supplied.map((step,index)=>{
      const id=text(step?.id)||`step_${index+1}`;
      if(ids.has(id))throw new Error(`DUPLICATE_DELIBERATION_STEP: ${id}`);
      ids.add(id);
      const capabilityId=text(step?.capabilityId);
      if(!capabilityId)throw new Error(`DELIBERATION_CAPABILITY_REQUIRED: ${id}`);
      const dependsOn=Array.isArray(step?.dependsOn)?[...new Set(step.dependsOn.map(String))]:[];
      return {id,capabilityId,purpose:text(step?.purpose)||capabilityId,input:clone(step?.input??{}),expected:clone(step?.expected),dependsOn,agentId:step?.agentId?String(step.agentId):null,publish:Array.isArray(step?.publish)?[...new Set(step.publish.map(String))]:[]};
    });
  }

  #assertAcyclic(steps){
    const map=new Map(steps.map(step=>[step.id,step]));
    const visiting=new Set(),visited=new Set();
    const visit=id=>{if(visiting.has(id))throw new Error(`DELIBERATION_CYCLE_DETECTED: ${id}`);if(visited.has(id))return;const step=map.get(id);if(!step)throw new Error(`UNKNOWN_DELIBERATION_DEPENDENCY: ${id}`);visiting.add(id);for(const dep of step.dependsOn)visit(dep);visiting.delete(id);visited.add(id);};
    for(const step of steps)visit(step.id);
  }

  deliberate(definition={}){
    const objective=text(definition.objective);
    if(!objective)throw new TypeError('Deliberation objective is required');
    const steps=this.#normalizeSteps(definition);
    this.#assertAcyclic(steps);
    const used=[];
    const tasks=steps.map(step=>{
      const agent=step.agentId?this.core.agentRuntime.get(step.agentId):this.#choose(step.capabilityId,used);
      if(!agent)throw new Error(`NO_AGENT_FOR_DELIBERATION_CAPABILITY: ${step.capabilityId}`);
      if(!Array.isArray(agent.capabilities)||!agent.capabilities.includes(step.capabilityId))throw new Error(`AGENT_CAPABILITY_DENIED: ${agent.id} -> ${step.capabilityId}`);
      used.push(agent.id);
      return {...step,agentId:agent.id};
    });
    const plan={id:`plan_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,objective,name:text(definition.name)||'Wulan deliberated team',reasoning:{strategy:'capability_match_dependency_graph',orderedSteps:tasks.map(step=>({id:step.id,purpose:step.purpose,agentId:step.agentId,dependsOn:step.dependsOn}))},tasks};
    return clone(plan);
  }

  async execute(definition={},options={}){
    const plan=this.deliberate(definition);
    const run=await this.core.agentSupervisor.coordinate({name:plan.name,tasks:plan.tasks},{approvedCapabilities:options.approvedCapabilities??[],signal:options.signal});
    return {plan,run};
  }

  status(){return{maxSteps:this.maxSteps,agents:this.#agents().map(agent=>({id:agent.id,status:agent.status,capabilities:[...(agent.capabilities??[])]}))};}
}
