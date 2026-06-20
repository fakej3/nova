/**
 * NOVA Database Layer
 * The ONLY file that interacts with IndexedDB directly.
 * All other modules use the DB object exported here.
 * Returns Promises throughout — never exposes IDBRequest objects.
 */

const DB_NAME    = 'nova_db';
const DB_VERSION = 2;

let _db = null;

// ── Low-level helpers ─────────────────────────────────────────

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = (e) => resolve(e.target.result ?? null);
    req.onerror   = (e) => reject(e.target.error);
  });
}

// Opens a transaction on one store, calls fn(store), returns promise of fn's result.
function storeReq(storeName, mode, fn) {
  return getDB().then((db) => {
    const store = db.transaction(storeName, mode).objectStore(storeName);
    return fn(store);
  });
}

// Wraps a readwrite transaction where fn may issue multiple requests.
// Resolves when the transaction completes, with the value returned by fn().
function txWrite(storeName, fn) {
  return getDB().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror    = (e) => reject(e.target.error);
    transaction.onabort    = (e) => reject(e.target.error ?? new Error('Transaction aborted'));
    try {
      result = fn(transaction.objectStore(storeName), transaction);
    } catch (err) {
      reject(err);
    }
  }));
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db         = event.target.result;
      const oldVersion = event.oldVersion;

      // Migration ladder — add a new "if (oldVersion < N)" block for each version bump.

      if (oldVersion < 1) {
        // ── notes ───────────────────────────────────────────
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('createdAt', 'createdAt', { unique: false });
        notes.createIndex('updatedAt', 'updatedAt', { unique: false });
        notes.createIndex('pinned',    'pinned',    { unique: false });

        // ── tasks ───────────────────────────────────────────
        const tasks = db.createObjectStore('tasks', { keyPath: 'id' });
        tasks.createIndex('status',      'status',      { unique: false });
        tasks.createIndex('priority',    'priority',    { unique: false });
        tasks.createIndex('createdAt',   'createdAt',   { unique: false });
        tasks.createIndex('completedAt', 'completedAt', { unique: false });
        tasks.createIndex('dueDate',     'dueDate',     { unique: false });

        // ── events ──────────────────────────────────────────
        const events = db.createObjectStore('events', { keyPath: 'id' });
        events.createIndex('timestamp', 'timestamp', { unique: false });
        events.createIndex('type',      'type',      { unique: false });

        // ── settings ────────────────────────────────────────
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      if (oldVersion < 2) {
        // ── memories (Phase 2) ──────────────────────────────
        const memories = db.createObjectStore('memories', { keyPath: 'id' });
        memories.createIndex('type',      'type',      { unique: false });
        memories.createIndex('timestamp', 'timestamp', { unique: false });
        memories.createIndex('source',    'source',    { unique: false });
      }
    };

    req.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror    = (e) => reject(e.target.error);
    req.onblocked  = ()  => console.warn('[DB] upgrade blocked by open tab');
  });
}

function getDB() {
  if (_db) return Promise.resolve(_db);
  return openDB();
}

function newId() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

// ── Notes ─────────────────────────────────────────────────────

const notes = {
  async create(data) {
    const id = newId();
    const ts = now();
    const note = {
      id,
      title:     data.title     ?? '',
      content:   data.content   ?? '',
      tags:      data.tags      ?? [],
      pinned:    data.pinned    ?? false,
      createdAt: ts,
      updatedAt: ts,
    };
    await storeReq('notes', 'readwrite', (store) => reqToPromise(store.add(note)));
    return id;
  },

  async get(id) {
    return storeReq('notes', 'readonly', (store) => reqToPromise(store.get(id)));
  },

  async getAll() {
    return storeReq('notes', 'readonly', (store) => reqToPromise(store.getAll()));
  },

  async update(id, changes) {
    return txWrite('notes', (store) => {
      return reqToPromise(store.get(id)).then((existing) => {
        if (!existing) throw new Error(`Note ${id} not found`);
        return reqToPromise(store.put({ ...existing, ...changes, id, updatedAt: now() }));
      });
    });
  },

  async delete(id) {
    return storeReq('notes', 'readwrite', (store) => reqToPromise(store.delete(id)));
  },

  async count() {
    return storeReq('notes', 'readonly', (store) => reqToPromise(store.count()));
  },

  async search(query, limit = 500) {
    const all = await notes.getAll();
    if (!query || !query.trim()) return all;
    const q = query.trim().toLowerCase();
    const results = [];
    for (const n of all) {
      if (results.length >= limit) break;
      if (
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q))
      ) {
        results.push(n);
      }
    }
    return results;
  },
};

// ── Tasks ─────────────────────────────────────────────────────

const tasks = {
  async create(data) {
    const id = newId();
    const ts = now();
    const task = {
      id,
      title:       data.title       ?? '',
      description: data.description ?? '',
      status:      data.status      ?? 'pending',
      priority:    data.priority    ?? 2,
      dueDate:     data.dueDate     ?? null,
      createdAt:   ts,
      updatedAt:   ts,
      completedAt: null,
    };
    await storeReq('tasks', 'readwrite', (store) => reqToPromise(store.add(task)));
    return id;
  },

  async get(id) {
    return storeReq('tasks', 'readonly', (store) => reqToPromise(store.get(id)));
  },

  async getAll() {
    return storeReq('tasks', 'readonly', (store) => reqToPromise(store.getAll()));
  },

  // Uses the status index instead of full-table filter.
  async getByStatus(status) {
    if (status === 'all') return tasks.getAll();
    return storeReq('tasks', 'readonly', (store) => {
      const index = store.index('status');
      return reqToPromise(index.getAll(IDBKeyRange.only(status)));
    });
  },

  async count() {
    return storeReq('tasks', 'readonly', (store) => reqToPromise(store.count()));
  },

  async update(id, changes) {
    return txWrite('tasks', (store) => {
      return reqToPromise(store.get(id)).then((existing) => {
        if (!existing) throw new Error(`Task ${id} not found`);
        return reqToPromise(store.put({ ...existing, ...changes, id, updatedAt: now() }));
      });
    });
  },

  async delete(id) {
    return storeReq('tasks', 'readwrite', (store) => reqToPromise(store.delete(id)));
  },
};

// ── Events ────────────────────────────────────────────────────

const events = {
  async create(data) {
    const id = newId();
    const event = {
      id,
      type:         data.type         ?? 'unknown',
      description:  data.description  ?? '',
      relatedId:    data.relatedId    ?? null,
      relatedTable: data.relatedTable ?? null,
      timestamp:    now(),
    };
    await storeReq('events', 'readwrite', (store) => reqToPromise(store.add(event)));
    return id;
  },

  async getAll() {
    return storeReq('events', 'readonly', (store) => reqToPromise(store.getAll()));
  },

  // O(limit) via reverse cursor on timestamp index.
  async getRecent(limit = 50) {
    return getDB().then((db) => new Promise((resolve, reject) => {
      const store   = db.transaction('events', 'readonly').objectStore('events');
      const index   = store.index('timestamp');
      const results = [];
      const req     = index.openCursor(null, 'prev');
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor || results.length >= limit) { resolve(results); return; }
        results.push(cursor.value);
        cursor.continue();
      };
      req.onerror = (e) => reject(e.target.error);
    }));
  },

  // Query events within an ISO timestamp range (inclusive).
  async getByDateRange(startIso, endIso) {
    return getDB().then((db) => new Promise((resolve, reject) => {
      const store   = db.transaction('events', 'readonly').objectStore('events');
      const index   = store.index('timestamp');
      const range   = IDBKeyRange.bound(startIso, endIso);
      const results = [];
      const req     = index.openCursor(range, 'prev');
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) { resolve(results); return; }
        results.push(cursor.value);
        cursor.continue();
      };
      req.onerror = (e) => reject(e.target.error);
    }));
  },

  // Query events by type using the type index.
  async getByType(type) {
    return storeReq('events', 'readonly', (store) => {
      const index = store.index('type');
      return reqToPromise(index.getAll(IDBKeyRange.only(type)));
    });
  },

  async count() {
    return storeReq('events', 'readonly', (store) => reqToPromise(store.count()));
  },
};

// ── Memories ──────────────────────────────────────────────────

const memories = {
  async create(data) {
    const id = newId();
    const memory = {
      id,
      type:      data.type      ?? 'memory',  // note | task | event | memory
      content:   data.content   ?? '',
      timestamp: now(),
      tags:      data.tags      ?? [],
      source:    data.source    ?? 'user',
    };
    await storeReq('memories', 'readwrite', (store) => reqToPromise(store.add(memory)));
    return id;
  },

  async get(id) {
    return storeReq('memories', 'readonly', (store) => reqToPromise(store.get(id)));
  },

  async getAll() {
    return storeReq('memories', 'readonly', (store) => reqToPromise(store.getAll()));
  },

  async getByType(type) {
    return storeReq('memories', 'readonly', (store) => {
      const index = store.index('type');
      return reqToPromise(index.getAll(IDBKeyRange.only(type)));
    });
  },

  async getRecent(limit = 20) {
    return getDB().then((db) => new Promise((resolve, reject) => {
      const store   = db.transaction('memories', 'readonly').objectStore('memories');
      const index   = store.index('timestamp');
      const results = [];
      const req     = index.openCursor(null, 'prev');
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor || results.length >= limit) { resolve(results); return; }
        results.push(cursor.value);
        cursor.continue();
      };
      req.onerror = (e) => reject(e.target.error);
    }));
  },

  async delete(id) {
    return storeReq('memories', 'readwrite', (store) => reqToPromise(store.delete(id)));
  },

  async count() {
    return storeReq('memories', 'readonly', (store) => reqToPromise(store.count()));
  },

  async search(query, limit = 200) {
    const all = await memories.getAll();
    if (!query || !query.trim()) return all;
    const q = query.trim().toLowerCase();
    const results = [];
    for (const m of all) {
      if (results.length >= limit) break;
      if (
        m.content.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q)) ||
        m.type.toLowerCase().includes(q)
      ) {
        results.push(m);
      }
    }
    return results;
  },
};

// ── Settings ──────────────────────────────────────────────────

const settings = {
  async get(key) {
    return storeReq('settings', 'readonly', (store) =>
      reqToPromise(store.get(key)).then((row) => row?.value ?? null)
    );
  },

  async set(key, value) {
    return storeReq('settings', 'readwrite', (store) =>
      reqToPromise(store.put({ key, value }))
    );
  },

  async getAll() {
    return storeReq('settings', 'readonly', (store) => reqToPromise(store.getAll()));
  },
};

// ── Public API ────────────────────────────────────────────────

export const DB = {
  init: openDB,
  notes,
  tasks,
  events,
  memories,
  settings,
};
