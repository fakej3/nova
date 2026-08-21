// Wulan AI Gateway — provider-neutral model boundary.
// Providers are adapters. Wulan Core never depends directly on one vendor/model.
export class WulanAIGateway {
  constructor() { this.providers = new Map(); this.defaultProvider = null; }
  registerProvider({ id, name, generate, capabilities = [], priority = 100 }) {
    if (!id || !name || typeof generate !== 'function') throw new TypeError('AI provider requires id, name and generate()');
    if (this.providers.has(id)) throw new Error(`AI provider already registered: ${id}`);
    const provider={id,name,generate,capabilities:[...capabilities],priority};this.providers.set(id,provider);if(!this.defaultProvider)this.defaultProvider=id;return provider;
  }
  setDefaultProvider(id){if(!this.providers.has(id))throw new Error(`Unknown AI provider: ${id}`);this.defaultProvider=id;}
  listProviders(){return [...this.providers.values()].sort((a,b)=>a.priority-b.priority).map(({generate,...metadata})=>metadata);}
  selectProvider({providerId=null,capability=null}={}){
    const all=[...this.providers.values()].sort((a,b)=>a.priority-b.priority);if(!all.length)throw new Error('No AI provider is configured');
    if(providerId){const p=this.providers.get(providerId);if(!p)throw new Error(`Unknown AI provider: ${providerId}`);return p;}
    if(capability){const capable=all.filter(p=>p.capabilities.includes(capability));if(capable.length)return capable[0];}
    return this.providers.get(this.defaultProvider)??all[0];
  }
  async generate(request,{providerId=null,capability=null}={}){
    const all=[...this.providers.values()].sort((a,b)=>a.priority-b.priority);if(!all.length)throw new Error('No AI provider is configured');
    const selected=this.selectProvider({providerId,capability});const candidates=providerId?[selected]:[selected,...all.filter(p=>p.id!==selected.id)];let lastError=null;
    for(const provider of candidates){try{return await provider.generate(request);}catch(error){lastError=error;if(error?.status!==503)throw error;}}
    throw lastError??new Error('No AI provider is configured');
  }
}
