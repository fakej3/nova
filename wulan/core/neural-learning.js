// Small, inspectable online neural layer for Wulan.
// It does not replace Gemini/Claude/etc. It learns local routing preferences
// from outcomes and remains useful when every remote model is unavailable.

const FEATURES = ['research','engineering','analysis','creative','github','sentinel','project','memory','question','build','debug','explain','personal'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const hash=(text)=>{let h=2166136261;for(const c of String(text).toLowerCase()){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;};
const tokens=(text)=>new Set(String(text||'').toLowerCase().replace(/[^a-z0-9_\s-]/g,' ').split(/\s+/).filter(Boolean));

export class WulanNeuralLayer {
  constructor({agents=[],learningRate=.05,storageKey='wulan-neural-layer-v1'}={}){
    this.agents=[...agents];this.learningRate=learningRate;this.storageKey=storageKey;this.neurons=new Map();this.synapses=new Map();this.episodes=[];this.updates=0;
    for(const feature of FEATURES)this.neurons.set(`input:${feature}`,{id:`input:${feature}`,kind:'input',activation:0});
    for(const agent of this.agents)this.neurons.set(`output:${agent}`,{id:`output:${agent}`,kind:'output',agentId:agent,activation:0});
    for(const feature of FEATURES)for(const agent of this.agents){const seed=hash(`${feature}:${agent}`);this.synapses.set(`${feature}->${agent}`,{from:feature,to:agent,weight:((seed%2001)/1000-1)*.12,updates:0});}
    this.load();
  }

  encode(text){
    const t=tokens(text),groups={
      research:['research','search','find','learn','compare'],engineering:['code','build','fix','bug','debug','github','vercel','deploy'],analysis:['analyze','analysis','check','why','investigate','trade','sentinel'],creative:['design','image','music','write','creative','video'],memory:['remember','memory','recall','learned'],question:['what','why','how','can','should'],personal:['i','me','my','we','bro'],project:['project','app','system','world']};
    const x=Object.fromEntries(FEATURES.map(f=>[f,0]));for(const [feature,words] of Object.entries(groups))x[feature]=words.some(w=>t.has(w))?1:0;if(t.has('github'))x.github=1;if(t.has('sentinel'))x.sentinel=1;if(x.debug)x.engineering=1;return x;
  }

  forward(text){
    const x=this.encode(text),scores={};for(const f of FEATURES)this.neurons.get(`input:${f}`).activation=x[f];
    for(const agent of this.agents){let sum=0;for(const f of FEATURES)sum+=x[f]*(this.synapses.get(`${f}->${agent}`)?.weight||0);scores[agent]=sum;}
    const max=Math.max(...Object.values(scores),0),exps=Object.fromEntries(this.agents.map(a=>[a,Math.exp(clamp(scores[a]-max,-10,10))])),total=Object.values(exps).reduce((a,b)=>a+b,0)||1;
    const probabilities=Object.fromEntries(this.agents.map(a=>[a,exps[a]/total]));for(const a of this.agents)this.neurons.get(`output:${a}`).activation=probabilities[a];
    const ranked=this.agents.map(agent=>({agent,probability:probabilities[agent],score:scores[agent]})).sort((a,b)=>b.probability-a.probability);return {features:x,ranked};
  }

  predict(text){const r=this.forward(text);return {agent:r.ranked[0]?.agent||null,confidence:r.ranked[0]?.probability||0,alternatives:r.ranked.slice(1,3),features:r.features};}

  learn({text,agent,outcome='accepted',reward}={}){
    if(!text||!agent||!this.agents.includes(agent))return null;const r=reward==null?(outcome==='accepted'||outcome==='corrected'?1:outcome==='rejected'||outcome==='failed'?-1:0):clamp(Number(reward),-1,1);const x=this.encode(text);
    for(const f of FEATURES){if(!x[f])continue;const s=this.synapses.get(`${f}->${agent}`);if(!s)continue;s.weight=clamp(s.weight+this.learningRate*r*x[f],-2,2);s.updates++;}
    const episode={id:`n-${Date.now()}-${this.updates}`,createdAt:new Date().toISOString(),text:String(text).slice(0,1000),agent,outcome,reward:r};this.episodes.push(episode);if(this.episodes.length>500)this.episodes.shift();this.updates++;this.save();return episode;
  }

  snapshot(){return {version:1,features:FEATURES,agents:this.agents,neurons:[...this.neurons.values()],synapses:[...this.synapses.values()],episodes:this.episodes,updates:this.updates,learningRate:this.learningRate};}
  stats(){const weights=[...this.synapses.values()].map(s=>s.weight);return {neurons:this.neurons.size,synapses:this.synapses.size,episodes:this.episodes.length,updates:this.updates,learningRate:this.learningRate,meanWeight:weights.reduce((a,b)=>a+b,0)/(weights.length||1)};}
  save(){try{localStorage.setItem(this.storageKey,JSON.stringify(this.snapshot()));}catch{}}
  load(){try{const raw=localStorage.getItem(this.storageKey);if(!raw)return;const d=JSON.parse(raw);for(const saved of d.synapses||[]){const s=this.synapses.get(`${saved.from}->${saved.to}`);if(s){s.weight=Number(saved.weight)||0;s.updates=Number(saved.updates)||0;}}this.episodes=Array.isArray(d.episodes)?d.episodes.slice(-500):[];this.updates=Number(d.updates)||0;}catch{}}
}

export const WULAN_NEURAL_FEATURES=Object.freeze([...FEATURES]);
