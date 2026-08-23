import { createWulanCore } from './index.js';

function createMemoryStorage(){
  const values=new Map();
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}

describe('Wulan runtime health',()=>{
  test('reports a healthy booted core with baseline subsystems',()=>{
    const core=createWulanCore({persistence:{available:()=>true,load:()=>null,saveCore:()=>true}});
    core.registerAgent({id:'atlas',name:'ATLAS',role:'research'});
    core.registerIntegration({id:'sentinel',name:'Sentinel',kind:'trading'});
    core.boot();
    const report=core.health.check();
    expect(report.overall).toBe('healthy');
    expect(report.checks.find(check=>check.id==='neural')?.status).toBe('healthy');
    expect(report.checks.find(check=>check.id==='agents')?.count).toBe(1);
  });

  test('repairs an empty neural substrate without replacing memory',()=>{
    const storage=createMemoryStorage();
    const core=createWulanCore({persistence:new (class{available(){return true}load(){return null}saveCore(){return true}})()});
    core.registerAgent({id:'atlas',name:'ATLAS',role:'research'});
    const memory=core.remember({content:'repair must preserve this memory',type:'fact'});
    core.neural.clear?.();
    const result=core.health.repair();
    expect(result.repaired).toBe(true);
    expect(core.memory.get(memory.id)?.content).toContain('repair must preserve this memory');
    expect(core.neural.stats().neurons).toBeGreaterThanOrEqual(2);
    expect(core.neural.stats().synapses).toBeGreaterThanOrEqual(2);
    void storage;
  });

  test('system health capability is read-only and returns the same runtime report',async()=>{
    const core=createWulanCore();
    core.boot();
    const direct=core.health.check(['core','neural']);
    const viaCapability=await core.invokeCapability('system.health',{checks:['core','neural']});
    expect(viaCapability.overall).toBe(direct.overall);
    expect(viaCapability.checks.map(check=>check.id)).toEqual(['core','neural']);
  });
});
