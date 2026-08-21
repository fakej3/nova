// Persistence boundary for Wulan. The core talks to this contract instead of
// assuming localStorage, a database, or a particular hosting provider.
export class WulanPersistence {
  constructor({adapter=null, namespace='wulan'}={}) {
    this.adapter = adapter;
    this.namespace = namespace;
  }

  async load(key, fallback=null) {
    if (!this.adapter?.load) return fallback;
    const value = await this.adapter.load(`${this.namespace}:${key}`);
    return value == null ? fallback : value;
  }

  async save(key, value) {
    if (!this.adapter?.save) return false;
    await this.adapter.save(`${this.namespace}:${key}`, value);
    return true;
  }

  async remove(key) {
    if (!this.adapter?.remove) return false;
    await this.adapter.remove(`${this.namespace}:${key}`);
    return true;
  }
}

export class WulanMemoryPersistenceAdapter {
  constructor({storage=null}={}) {
    this.storage = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  }
  async load(key) {
    if (!this.storage) return null;
    try { const raw=this.storage.getItem(key); return raw==null ? null : JSON.parse(raw); } catch { return null; }
  }
  async save(key,value) {
    if (!this.storage) return;
    try { this.storage.setItem(key, JSON.stringify(value)); } catch {}
  }
  async remove(key) { try { this.storage?.removeItem(key); } catch {} }
}

export class WulanServerPersistenceAdapter {
  constructor({baseUrl='/api/persistence',fetchImpl=globalThis.fetch}={}) {
    this.baseUrl=baseUrl; this.fetch=fetchImpl;
  }
  async load(key) {
    if (!this.fetch) return null;
    const res=await this.fetch(`${this.baseUrl}?key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`Persistence load failed: ${res.status}`);
    const body=await res.json(); return body.value ?? null;
  }
  async save(key,value) {
    if (!this.fetch) throw new Error('Fetch unavailable');
    const res=await this.fetch(this.baseUrl,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({key,value})});
    if (!res.ok) throw new Error(`Persistence save failed: ${res.status}`);
  }
  async remove(key) {
    if (!this.fetch) return;
    const res=await this.fetch(`${this.baseUrl}?key=${encodeURIComponent(key)}`,{method:'DELETE'});
    if (!res.ok) throw new Error(`Persistence remove failed: ${res.status}`);
  }
}
