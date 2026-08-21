const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,v));
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9\s_-]/g,' ').replace(/\s+/g,' ').trim();
const keywords=text=>[...new Set(normalize(text).split(' ').filter(w=>w.length>2))].slice(0,24);

export class WulanConsolidationEngine {
  constructor({memory,learning,neural,maxPatterns=1000,storageKey='wulan-consolidation-v1'}={}){
    this.memory=memory;this.learning=learning;this.neural=neural;this.maxPatterns=maxPatterns;this.storageKey=storageKey;
    this.patterns=[];this.runs=0;this.load();
  }

  outcomeScore(outcome){
    return outcome==='accepted'?1:outcome==='corrected'?.65:outcome==='rejected'?-1:outcome==='failed'?-1:.15;
  }

  consolidate({text,agent,outcome='accepted',correction=null,toolResult=null,confidence=.5,source='experience'}={}){
    if(!text)return null;
    const words=keywords(text), score=this.outcomeScore(outcome);
    const matching=this.patterns.filter(p=>p.agent===agent&&words.some(w=>p.keywords.includes(w)));
    const pattern=matching[0]||{id:`pattern-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,agent:agent||null,keywords:[],evidence:0,successes:0,failures:0,score:0,confidence:.2,examples:[],createdAt:new Date().toISOString(),updatedAt:null};
    if(!matching.length)this.patterns.push(pattern);
    pattern.keywords=[...new Set([...pattern.keywords,...words])].slice(0,32);
    pattern.evidence+=1;pattern.successes+=score>0?1:0;pattern.failures+=score<0?1:0;pattern.score=clamp((pattern.score*(pattern.evidence-1)+score)/pattern.evidence,-1,1);pattern.confidence=clamp(.2+Math.min(.7,pattern.evidence*.07)+Math.max(0,pattern.score)*.15);pattern.updatedAt=new Date().toISOString();
    const example={text:String(text).slice(0,500),outcome,correction:correction?String(correction).slice(0,500):null,agent:agent||null,score,confidence,at:new Date().toISOString()};pattern.examples=[...pattern.examples,example].slice(-5);
    if(this.memory){try{this.memory.add({content:`Learned pattern: ${pattern.keywords.slice(0,12).join(', ')} → ${agent||'unknown'} (${pattern.score.toFixed(2)}, ${pattern.evidence} observations)`,type:'knowledge',source:'consolidation',importance:clamp(.35+pattern.confidence*.45),tags:['learned-pattern',...(agent?[agent]:[]),...pattern.keywords.slice(0,8)]});}catch{}}
    this.runs+=1;if(this.patterns.length>this.maxPatterns)this.patterns.sort((a,b)=>b.updatedAt?.localeCompare(a.updatedAt||'')||0),this.patterns=this.patterns.slice(0,this.maxPatterns);this.save();return pattern;
  }

  learnFromFeedback({context,outcome,agent,correction,candidatePreference,confidence}={}){
    const pattern=this.consolidate({text:context,agent:agent||candidatePreference,outcome,correction,confidence,source:'feedback'});
    if(this.neural&&agent){try{this.neural.learn({text:context,agent,outcome,reward:this.outcomeScore(outcome)});}catch{}}
    return pattern;
  }

  retrieve(text,{agent,limit=6}={}){
    const words=new Set(keywords(text));
    return this.patterns.map(p=>{const overlap=p.keywords.reduce((n,w)=>n+(words.has(w)?1:0),0);const relevance=overlap/(Math.max(1,Math.min(words.size,p.keywords.length)));const agentBoost=agent&&p.agent===agent?.25:0;return{...p,relevance:clamp(relevance+agentBoost)}}).filter(p=>p.relevance>0).sort((a,b)=>(b.relevance+b.score*.15)-(a.relevance+a.score*.15)).slice(0,limit);
  }

  snapshot(){return{version:1,patterns:this.patterns,runs:this.runs,updatedAt:new Date().toISOString()};}
  stats(){const successful=this.patterns.filter(p=>p.score>0).length;return{patterns:this.patterns.length,runs:this.runs,positivePatterns:successful,negativePatterns:this.patterns.filter(p=>p.score<0).length};}
  save(){try{localStorage.setItem(this.storageKey,JSON.stringify(this.snapshot()));}catch{}}
  load(){try{const raw=localStorage.getItem(this.storageKey);if(!raw)return;const d=JSON.parse(raw);this.patterns=Array.isArray(d.patterns)?d.patterns.slice(-this.maxPatterns):[];this.runs=Number(d.runs)||0;}catch{}}
}
