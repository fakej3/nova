function issue(code,message,details={}){return {code,message,...details};}

function checkFinite(value){return typeof value==='number'&&Number.isFinite(value);}

export function createRuntimeHealth(core){
  const checks=new Map();

  const define=(id,label,run)=>checks.set(id,{id,label,run});

  define('core','Core lifecycle',()=>{
    const status=core?.state?.status;
    return status==='ready'
      ? {status:'healthy',message:'Wulan core is ready.'}
      : {status:'degraded',message:`Wulan core status is ${status??'unknown'}.`,issues:[issue('CORE_NOT_READY','Core has not reached ready state.',{actual:status??null})]};
  });

  define('neural','Neural substrate',()=>{
    const stats=core?.neural?.stats?.();
    if(!stats)return {status:'failed',message:'Neural substrate is unavailable.',issues:[issue('NEURAL_MISSING','Core has no usable neural substrate.')]};
    const issues=[];
    if(!Number.isInteger(stats.neurons)||stats.neurons<1)issues.push(issue('NEURAL_EMPTY','Neural substrate contains no neurons.'));
    if(!Number.isInteger(stats.synapses)||stats.synapses<0)issues.push(issue('NEURAL_STATS_INVALID','Neural substrate returned invalid synapse statistics.'));
    if(!Number.isInteger(stats.updates)||stats.updates<0)issues.push(issue('NEURAL_UPDATES_INVALID','Neural substrate returned invalid update statistics.'));
    return {status:issues.length?'degraded':'healthy',message:issues.length?'Neural substrate needs attention.':'Neural substrate is populated and readable.',stats,issues};
  });

  define('memory','Memory store',()=>{
    const count=core?.memory?.stats?.()?.entries??core?.memory?.list?.({limit:1})?.length;
    const available=Boolean(core?.memory&&typeof core.memory.add==='function'&&typeof core.memory.search==='function');
    return available
      ? {status:'healthy',message:`Memory store is available${Number.isFinite(count)?` with ${count} entries`:''}.`,entries:Number.isFinite(count)?count:null}
      : {status:'failed',message:'Memory store is unavailable.',issues:[issue('MEMORY_MISSING','Core memory store is not usable.')]};
  });

  define('persistence','Persistence',()=>{
    const persistence=core?.persistence;
    const available=Boolean(persistence?.available?.());
    const loadable=typeof persistence?.load==='function';
    if(!persistence||!loadable)return {status:'failed',message:'Persistence adapter is unavailable.',issues:[issue('PERSISTENCE_MISSING','No compatible persistence adapter is attached.')]};
    return {status:available?'healthy':'degraded',message:available?'Persistence adapter is available.':'Persistence adapter is present but storage is unavailable.',available};
  });

  define('agents','Agents',()=>{
    const agents=[...(core?.state?.agents?.values?.()??[])];
    const issues=agents.filter(agent=>!agent?.id||!agent?.name).map(agent=>issue('AGENT_INVALID','An invalid agent registration was found.'));
    return {status:issues.length?'degraded':agents.length?'healthy':'degraded',message:agents.length?`${agents.length} agent(s) registered.`:'No agents are registered.',count:agents.length,agents:agents.map(agent=>({id:agent.id,name:agent.name,status:agent.status,role:agent.role})),issues:agents.length?issues:[issue('AGENTS_EMPTY','No agents are registered in the current core.')]};
  });

  define('integrations','Integrations',()=>{
    const integrations=[...(core?.state?.integrations?.values?.()??[])];
    return {status:integrations.length?'healthy':'degraded',message:integrations.length?`${integrations.length} integration(s) registered.`:'No integrations are registered.',count:integrations.length,integrations:integrations.map(item=>({id:item.id,name:item.name,status:item.status,kind:item.kind}))};
  });

  define('capabilities','Capabilities',()=>{
    const list=core?.capabilities?.list?.()??[];
    return {status:list.length?'healthy':'degraded',message:list.length?`${list.length} capability(ies) registered.`:'No capabilities are registered.',count:list.length};
  });

  define('semantic','Semantic memory',()=>{
    const stats=core?.semantic?.stats?.();
    const available=Boolean(core?.semantic&&typeof core.semantic.search==='function');
    return available?{status:'healthy',message:`Semantic memory is available${stats?.entries!=null?` with ${stats.entries} entries`:''}.`,stats}: {status:'degraded',message:'Semantic memory is unavailable.',issues:[issue('SEMANTIC_MISSING','Semantic memory subsystem is not usable.')]};
  });

  function run(ids){
    const selected=ids?.length?ids.map(id=>checks.get(id)).filter(Boolean):[...checks.values()];
    const results=selected.map(check=>{try{return {id:check.id,label:check.label,...check.run()};}catch(error){return {id:check.id,label:check.label,status:'failed',message:error?.message??String(error),issues:[issue('CHECK_THROWN','Health check threw an exception.',{error:error?.stack??String(error)})]};}});
    const failed=results.filter(result=>result.status==='failed').length;
    const degraded=results.filter(result=>result.status==='degraded').length;
    const overall=failed?'failed':degraded?'degraded':'healthy';
    return {overall,checkedAt:new Date().toISOString(),summary:{healthy:results.length-failed-degraded,degraded,failed,total:results.length},checks:results};
  }

  function repair({seedNeural=true,boot=true}={}){
    const repairs=[];
    if(seedNeural&&core?.neural){
      const before=core.neural.stats();
      core.neural.ensureNeuron({id:'system:wulan-core',label:'WULAN CORE',type:'system',strength:.7,tags:['system','routing','core']});
      for(const agent of core.state?.agents?.values?.()??[]){
        const id=`agent:${agent.id}`;
        core.neural.ensureNeuron({id,label:agent.name,type:'agent',strength:.5,tags:['agent',agent.role??'general']});
        if(!core.neural.synapses?.has(`system:wulan-core>${id}`))core.neural.connect('system:wulan-core',id,.28,1);
        if(!core.neural.synapses?.has(`${id}>system:wulan-core`))core.neural.connect(id,'system:wulan-core',.2,1);
      }
      const after=core.neural.stats();
      if(after.neurons!==before.neurons||after.synapses!==before.synapses)repairs.push({subsystem:'neural',before,after});
    }
    if(boot&&core?.state?.status==='booting'&&typeof core.boot==='function'){
      core.boot();
      repairs.push({subsystem:'core',action:'boot'});
    }
    core?.persistence?.saveCore?.(core);
    return {repaired:repairs.length>0,repairs,health:run()};
  }

  function assertHealthy(){
    const report=run();
    if(report.overall==='failed')throw new Error(`Wulan runtime failed health checks: ${report.checks.filter(check=>check.status==='failed').map(check=>check.id).join(', ')}`);
    return report;
  }

  return {check:run,repair,assertHealthy,checks:()=>[...checks.values()].map(({id,label})=>({id,label}))};
}
