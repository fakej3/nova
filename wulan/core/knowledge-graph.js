const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,v));
const words=text=>[...new Set(String(text||'').toLowerCase().replace(/[^a-z0-9\s_-]/g,' ').split(/\s+/).filter(w=>w.length>2))].slice(0,32);
const key=(a,r,b)=>`${a}::${r}::${b}`;

export class WulanKnowledgeGraph {
  constructor({world=null,persistence=null,maxFacts=2000,storageKey='knowledge-graph'}={}){
    this.world=world;this.persistence=persistence;this.maxFacts=maxFacts;this.storageKey=storageKey;this.facts=new Map();this.episodes=[];this.load();
  }
  observeFact({subject,relation,object,confidence=.35,evidence=null,source='experience'}={}){
    if(!subject||!relation||!object)return null;
    const k=key(subject,relation,object), existing=this.facts.get(k);
    const fact=existing||{id:`fact-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,subject,relation,object,evidenceCount:0,positive:0,negative:0,confidence:.2,createdAt:new Date().toISOString()};
    fact.evidenceCount+=1;fact.positive+=confidence>=.5?1:0;fact.negative+=confidence<.2?1:0;
    const evidenceSignal=clamp(Number(confidence));
    fact.confidence=clamp((fact.confidence*(fact.evidenceCount-1)+evidenceSignal)/fact.evidenceCount);
    fact.updatedAt=new Date().toISOString();fact.lastEvidence=evidence?String(evidence).slice(0,600):null;fact.source=source;
    this.facts.set(k,fact);
    if(this.world&&this.world.entities.has(subject)&&this.world.entities.has(object)&&fact.confidence>=.65){const exists=[...this.world.relations.values()].some(r=>r.from===subject&&r.to===object&&r.type===relation);if(!exists)this.world.relate(subject,object,relation,{source:'knowledge-graph',confidence:fact.confidence,evidenceCount:fact.evidenceCount});}
    this.trim();this.save();return fact;
  }
  learnFromPattern(pattern){if(!pattern)return null;const subject=pattern.agent||'wulan';const object=pattern.keywords?.slice(0,6).join(' ')||'unknown-pattern';const relation=pattern.score>=.55?'effective_for':pattern.score<=-.45?'struggles_with':'associated_with';return this.observeFact({subject,relation,object,confidence:Math.max(.2,pattern.confidence||.2),evidence:`${pattern.evidence||0} observations`,source:'consolidation'});}
  learnFromExperience({text,agent,outcome,correction=null}={}){const ws=words(text),positive=outcome==='accepted'||outcome==='corrected';if(!ws.length)return[];const facts=[];for(const term of ws.slice(0,8))facts.push(this.observeFact({subject:agent||'wulan',relation:positive?'effective_for':'struggles_with',object:term,confidence:positive?.62:.12,evidence:correction||text,source:'experience'}));this.episodes.push({at:new Date().toISOString(),text:String(text).slice(0,600),agent:agent||null,outcome,correction:correction?String(correction).slice(0,400):null});this.episodes=this.episodes.slice(-500);this.save();return facts.filter(Boolean);}
  query(query,{limit=10,minConfidence=.25}={}){const q=new Set(words(query));return[...this.facts.values()].map(f=>{const overlap=[...q].filter(w=>f.subject.toLowerCase().includes(w)||f.object.toLowerCase().includes(w)||f.relation.toLowerCase().includes(w)).length;return{...f,relevance:clamp(overlap/Math.max(1,q.size))};}).filter(f=>f.confidence>=minConfidence&&f.relevance>0).sort((a,b)=>(b.relevance+b.confidence*.25)-(a.relevance+a.confidence*.25)).slice(0,limit);}
  snapshot(){return{version:1,facts:[...this.facts.values()],episodes:this.episodes.slice(-100),stats:this.stats()};}
  stats(){return{facts:this.facts.size,episodes:this.episodes.length,validated:[...this.facts.values()].filter(f=>f.confidence>=.65).length,highConfidence:[...this.facts.values()].filter(f=>f.confidence>=.8).length};}
  trim(){if(this.facts.size<=this.maxFacts)return;const items=[...this.facts.entries()].sort((a,b)=>(b[1].confidence+b[1].evidenceCount*.01)-(a[1].confidence+a[1].evidenceCount*.01));this.facts=new Map(items.slice(0,this.maxFacts));}
  save(){try{this.persistence?.saveSync(this.storageKey,this.snapshot());}catch{}}
  load(){try{const d=this.persistence?.loadSync(this.storageKey,null);if(!d)return;for(const f of d.facts||[])this.facts.set(key(f.subject,f.relation,f.object),f);this.episodes=Array.isArray(d.episodes)?d.episodes.slice(-500):[];}catch{}}
}