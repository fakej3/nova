import { WulanWorld, seedWulanWorld } from '../wulan/core/world.js';
import { WulanOrchestrator } from '../wulan/core/orchestrator.js';
import { getRepoSnapshot } from '../wulan/tools/github.js';
import { getSentinelHealth } from '../wulan/tools/sentinel.js';

function createRuntime() {
  const world = seedWulanWorld(new WulanWorld());
  world.registerCapability({ id:'github.repo.snapshot', name:'Inspect GitHub repository', description:'Read repository metadata and tree.', risk:'read', permissions:['github.read'], target:'github', execute:async(input={})=>getRepoSnapshot(input.repository||'fakej3/nova') });
  world.registerCapability({ id:'sentinel.health', name:'Inspect Sentinel health', description:'Read Sentinel deployment health.', risk:'read', permissions:['network.read'], target:'sentinel', execute:async()=>getSentinelHealth() });
  const core={state:{agents:new Map()},startAgent:(id,meta)=>{const a=world.entities.get(id);if(a){a.status='working';world.upsertEntity(a);}},finishAgent:(id,meta)=>{const a=world.entities.get(id);if(a){a.status='idle';world.upsertEntity(a);}}};
  return { world, orchestrator:new WulanOrchestrator({core,world}) };
}

function jsonError(res,status,error,details){return res.status(status).json({ok:false,error,details});}

export default async function handler(req,res){
  if(req.method!=='POST') { res.setHeader('Allow','POST'); return jsonError(res,405,'METHOD_NOT_ALLOWED'); }
  const body=req.body||{};
  const text=typeof body.text==='string'?body.text.trim():'';
  if(!text)return jsonError(res,400,'TEXT_REQUIRED');
  const {orchestrator,world}=createRuntime();
  try{
    const result=await orchestrator.inspect(text,{input:body.input||{}});
    return res.status(200).json({ok:true,text,route:result.route,result,activities:world.activities.slice(-8),observations:world.observations.slice(-8)});
  }catch(error){
    return jsonError(res,502,'ROUTE_EXECUTION_FAILED',error instanceof Error?error.message:String(error));
  }
}
