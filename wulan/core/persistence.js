const STORAGE_KEY='nova.wulan.memory.v1';

export class WulanPersistence {
  constructor({storage, key=STORAGE_KEY}={}){
    this.storage=storage??(typeof globalThis!=='undefined'?globalThis.localStorage:null);
    this.key=key;
  }
  available(){return Boolean(this.storage&&typeof this.storage.getItem==='function'&&typeof this.storage.setItem==='function');}
  load(){
    if(!this.available())return null;
    try{
      const raw=this.storage.getItem(this.key);
      if(!raw)return null;
      const parsed=JSON.parse(raw);
      if(!parsed||parsed.version!==1||!Array.isArray(parsed.memories))return null;
      return parsed;
    }catch{return null;}
  }
  save({memories=[]}={}){
    if(!this.available())return false;
    try{
      this.storage.setItem(this.key,JSON.stringify({version:1,savedAt:new Date().toISOString(),memories}));
      return true;
    }catch{return false;}
  }
  clear(){if(!this.available())return false;try{this.storage.removeItem(this.key);return true;}catch{return false;}}
}

export function hydrateMemoryStore(memory,persistence){
  const snapshot=persistence?.load?.();
  if(!snapshot?.memories?.length)return 0;
  let restored=0;
  for(const entry of snapshot.memories){
    try{memory.add(entry);restored++;}catch{}
  }
  return restored;
}

export function persistMemoryStore(memory,persistence){
  if(!persistence?.save)return false;
  return persistence.save({memories:memory.list({limit:memory.maxEntries??5000})});
}
