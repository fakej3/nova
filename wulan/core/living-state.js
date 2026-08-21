export const LIVING_STATES=Object.freeze({IDLE:'idle',LISTENING:'listening',THINKING:'thinking',REMEMBERING:'remembering',ACTING:'acting',LEARNING:'learning',ERROR:'error'});
const clamp=(value,min=0,max=1)=>Math.min(max,Math.max(min,value));
export class WulanLivingState{
 constructor(initial={}){this.state=initial.state??LIVING_STATES.IDLE;this.attention=clamp(initial.attention??.18);this.energy=clamp(initial.energy??.22);this.focus=initial.focus??null;this.activity=initial.activity??'Ready.';this.listeners=new Set();this.idleTimer=null;}
 snapshot(){return Object.freeze({state:this.state,attention:this.attention,energy:this.energy,focus:this.focus,activity:this.activity});}
 subscribe(listener){if(typeof listener!=='function')return()=>{};this.listeners.add(listener);listener(this.snapshot());return()=>this.listeners.delete(listener);}
 transition(state,patch={}){if(!Object.values(LIVING_STATES).includes(state))throw new TypeError(`Unknown living state: ${state}`);this.state=state;this.attention=clamp(patch.attention??this.attention);this.energy=clamp(patch.energy??this.energy);this.focus=patch.focus??this.focus;this.activity=patch.activity??patch.reason??this.activity;this.#notify();return this.snapshot();}
 pulse(patch={}){this.attention=clamp(patch.attention??this.attention+.03);this.energy=clamp(patch.energy??this.energy+.02);if(patch.focus!==undefined)this.focus=patch.focus;if(patch.activity)this.activity=patch.activity;this.#notify();return this.snapshot();}
 decayToIdle(delay=1200){clearTimeout(this.idleTimer);this.idleTimer=setTimeout(()=>this.transition(LIVING_STATES.IDLE,{attention:Math.max(.12,this.attention*.45),energy:Math.max(.16,this.energy*.55),activity:'Ready.'}),delay);}
 #notify(){const snapshot=this.snapshot();for(const listener of this.listeners){try{listener(snapshot);}catch{}}}
}
export class WulanLocalPersistence{
 constructor(key='wulan-local-v2'){this.key=key;}
 save(core){try{const payload={version:3,memories:core.memory?.list?.({limit:5000})??[],learning:core.learning?.recent?.(5000)??[],neural:core.neural?.exportState?.()??null,semantic:core.semantic?.exportState?.()??null};localStorage.setItem(this.key,JSON.stringify(payload));return true;}catch{return false;}}
 load(core){try{const raw=localStorage.getItem(this.key)||localStorage.getItem('wulan-local-v1');if(!raw)return{memories:0,learning:0,neural:false,semantic:false};const payload=JSON.parse(raw);let memories=0,learning=0;for(const memory of Array.isArray(payload.memories)?payload.memories:[]){try{core.remember(memory);memories+=1;}catch{}}for(const record of Array.isArray(payload.learning)?payload.learning:[]){try{if(typeof core.recordFeedback==='function')core.recordFeedback(record);else core.learning?.record(record);learning+=1;}catch{}}let neural=false,semantic=false;if(payload.neural&&typeof core.neural?.importState==='function'){try{core.neural.importState(payload.neural);neural=true;}catch{}}if(payload.semantic&&typeof core.semantic?.importState==='function'){try{core.semantic.importState(payload.semantic);semantic=true;}catch{}}return{memories,learning,neural,semantic};}catch{return{memories:0,learning:0,neural:false,semantic:false};}}
}
