// Inspectable local neural network for Wulan.
// It complements remote LLMs: it learns routing patterns locally and does not
// pretend to replace a foundation model.
const FEATURES=['research','engineering','analysis','creative','github','sentinel','project','memory','question','build','debug','explain','personal'];
const HIDDEN=['intent','technical','external','creative','personal','diagnostic','planning','memory'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const hash=text=>{let h=2166136261;for(const c of String(text).toLowerCase()){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;};
const tokens=text=>new Set(String(text||'').toLowerCase().replace(/[^a-z0-9_\s-]/g,' ').split(/\s+/).filter(Boolean));
const seeded=(key,scale=.12)=>((hash(key)%2001)/1000-1)*scale;
const softmax=scores=>{const max=Math.max(...Object.values(scores),0);const exps=Object.fromEntries(Object.entries(scores).map(([k,v])=>[k,Math.exp(clamp(v-max,-12,12))]));const total=Object.values(exps).reduce((a,b)=>a+b,0)||1;return Object.fromEntries(Object.entries(exps).map(([k,v])=>[k,v/total]));};

export class WulanNeuralLayer{
 constructor({agents=[],learningRate=.025,persistence=null,storageKey='neural'}={}){
  this.agents=[...agents];this.learningRate=learningRate;this.persistence=persistence;this.storageKey=storageKey;this.neurons=new Map();this.synapses=new Map();this.biases=new Map();this.episodes=[];this.updates=0;
  FEATURES.forEach(f=>this.neurons.set(`input:${f}`,{id:`input:${f}`,kind:'input',activation:0}));
  HIDDEN.forEach(h=>this.neurons.set(`hidden:${h}`,{id:`hidden:${h}`,kind:'hidden',activation:0}));
  this.agents.forEach(a=>this.neurons.set(`output:${a}`,{id:`output:${a}`,kind:'output',agentId:a,activation:0}));
  FEATURES.forEach(f=>HIDDEN.forEach(h=>this.synapses.set(`input:${f}->hidden:${h}`,{from:f,to:h,weight:seeded(`${f}:${h}`,.16),updates:0})));
  HIDDEN.forEach(h=>this.agents.forEach(a=>this.synapses.set(`hidden:${h}->output:${a}`,{from:h,to:a,weight:seeded(`${h}:${a}`,.16),updates:0})));
  [...HIDDEN,...this.agents].forEach(n=>this.biases.set(n,seeded(`bias:${n}`,.03)));this.load();
 }
 encode(text){const t=tokens(text),groups={research:['research','search','find','learn','compare'],engineering:['code','build','fix','bug','debug','github','vercel','deploy'],analysis:['analyze','analysis','check','why','investigate','trade','sentinel'],creative:['design','image','music','write','creative','video'],memory:['remember','memory','recall','learned'],question:['what','why','how','can','should'],personal:['i','me','my','we','bro'],project:['project','app','system','world']};const x=Object.fromEntries(FEATURES.map(f=>[f,0]));for(const [f,words] of Object.entries(groups))x[f]=words.some(w=>t.has(w))?1:0;if(t.has('github'))x.github=1;if(t.has('sentinel'))x.sentinel=1;if(x.debug)x.engineering=1;return x;}
 forward(text){const x=this.encode(text),hidden={};for(const f of FEATURES)this.neurons.get(`input:${f}`).activation=x[f];for(const h of HIDDEN){let z=this.biases.get(h)||0;for(const f of FEATURES)z+=x[f]*(this.synapses.get(`input:${f}->hidden:${h}`)?.weight||0);hidden[h]=Math.tanh(z);this.neurons.get(`hidden:${h}`).activation=hidden[h];}const scores={};for(const a of this.agents){let z=this.biases.get(a)||0;for(const h of HIDDEN)z+=hidden[h]*(this.synapses.get(`hidden:${h}->output:${a}`)?.weight||0);scores[a]=z;}const probabilities=softmax(scores);for(const a of this.agents)this.neurons.get(`output:${a}`).activation=probabilities[a];const ranked=this.agents.map(agent=>({agent,probability:probabilities[agent],score:scores[agent]})).sort((a,b)=>b.probability-a.probability);return{features:x,hidden,ranked};}
 predict(text){const r=this.forward(text);return{agent:r.ranked[0]?.agent||null,confidence:r.ranked[0]?.probability||0,alternatives:r.ranked.slice(1,3),features:r.features,hidden:r.hidden};}
 learn({text,agent,outcome='accepted',reward}={}){if(!text||!agent||!this.agents.includes(agent))return null;const target=reward==null?(outcome==='accepted'||outcome==='corrected'?1:outcome==='rejected'||outcome==='failed'?-1:0):clamp(Number(reward),-1,1);const x=this.encode(text);const pass=this.forward(text),hidden=pass.hidden;const targetIndex=this.agents.indexOf(agent);const targetVector=Object.fromEntries(this.agents.map((a,i)=>[a,i===targetIndex?1:0]));
  const outDelta=Object.fromEntries(this.agents.map(a=>[a,(targetVector[a]-pass.ranked.find(r=>r.agent===a)?.probability||0)*target]));
  const hiddenDelta={};for(const h of HIDDEN){let back=0;for(const a of this.agents)back+=outDelta[a]*(this.synapses.get(`hidden:${h}->output:${a}`)?.weight||0);hiddenDelta[h]=back*(1-hidden[h]*hidden[h]);}
  for(const a of this.agents){const delta=outDelta[a];this.biases.set(a,clamp((this.biases.get(a)||0)+this.learningRate*delta,-1,1));for(const h of HIDDEN){const s=this.synapses.get(`hidden:${h}->output:${a}`);if(s){s.weight=clamp(s.weight+this.learningRate*delta*hidden[h],-2,2);s.updates++;}}}
  for(const h of HIDDEN){const delta=hiddenDelta[h];this.biases.set(h,clamp((this.biases.get(h)||0)+this.learningRate*delta,-1,1));for(const f of FEATURES){if(!x[f])continue;const s=this.synapses.get(`input:${f}->hidden:${h}`);if(s){s.weight=clamp(s.weight+this.learningRate*delta*x[f],-2,2);s.updates++;}}}
  const episode={id:`n-${Date.now()}-${this.updates}`,createdAt:new Date().toISOString(),text:String(text).slice(0,1000),agent,outcome,reward:target,prediction:pass.agent,confidence:pass.confidence};this.episodes.push(episode);if(this.episodes.length>1000)this.episodes.shift();this.updates++;this.save();return episode;
 }
 snapshot(){return{version:2,features:FEATURES,hidden:HIDDEN,agents:this.agents,neurons:[...this.neurons.values()],synapses:[...this.synapses.values()],biases:Object.fromEntries(this.biases),episodes:this.episodes,updates:this.updates,learningRate:this.learningRate};}
 stats(){const syn=[...this.synapses.values()];return{neurons:this.neurons.size,synapses:syn.length,hiddenLayers:1,episodes:this.episodes.length,updates:this.updates,learningRate:this.learningRate,meanWeight:syn.reduce((a,s)=>a+s.weight,0)/(syn.length||1),lastEpisode:this.episodes.at(-1)||null};}
 save(){try{this.persistence?.saveSync(this.storageKey,this.snapshot());}catch{}}
 load(){try{const d=this.persistence?.loadSync(this.storageKey,null);if(!d)return;for(const saved of d.synapses||[]){const s=this.synapses.get(`input:${saved.from}->hidden:${saved.to}`)||this.synapses.get(`hidden:${saved.from}->output:${saved.to}`);if(s){s.weight=Number(saved.weight)||0;s.updates=Number(saved.updates)||0;}}for(const [k,v] of Object.entries(d.biases||{}))if(this.biases.has(k))this.biases.set(k,clamp(Number(v)||0,-1,1));this.episodes=Array.isArray(d.episodes)?d.episodes.slice(-1000):[];this.updates=Number(d.updates)||0;}catch{}}
}
export const WULAN_NEURAL_FEATURES=Object.freeze([...FEATURES]);
export const WULAN_NEURAL_HIDDEN=Object.freeze([...HIDDEN]);