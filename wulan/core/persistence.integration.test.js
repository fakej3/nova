import { createWulanCore } from './index.js';
import { WulanPersistence } from './persistence.js';

class MemoryStorage {
  constructor(){this.data=new Map();}
  getItem(key){return this.data.has(key)?this.data.get(key):null;}
  setItem(key,value){this.data.set(key,String(value));}
  removeItem(key){this.data.delete(key);}
}

describe('Wulan persistence', () => {
  test('restores memory, learning, neural and semantic state through one adapter', () => {
    const storage=new MemoryStorage();
    const persistence=new WulanPersistence({storage});
    const first=createWulanCore({persistence});
    first.remember({id:'memory:persistence-test',content:'durable persistence test',type:'experience',source:'test',importance:.8,tags:['persistence']});
    first.recordFeedback({id:'learning:persistence-test',outcome:'accepted',context:'durable persistence test',candidatePreference:'atlas',source:'test',confidence:.9});
    first.neural.ensureNeuron({id:'concept:persistence-test',label:'persistence-test',type:'concept',strength:.8,tags:['test']});
    first.semantic.upsert('memory:persistence-test','durable persistence test',[1,0,0],{type:'experience'});
    first.persistence.saveCore(first);

    const second=createWulanCore({persistence:new WulanPersistence({storage})});
    expect(second.memory.get('memory:persistence-test')).toBeTruthy();
    expect(second.learning.recent(10).some(record=>record.id==='learning:persistence-test')).toBe(true);
    expect(second.neural.getNeuron('concept:persistence-test')).toBeTruthy();
    expect(second.semantic.stats().entries).toBeGreaterThanOrEqual(1);
    expect(second.restorePersistentState()).toMatchObject({learning:1,neural:true,semantic:true});
  });
});
