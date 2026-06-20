/**
 * NOVA Database Layer
 * The ONLY file that interacts with IndexedDB directly.
 * All other modules use the DB object exported here.
 * Returns Promises throughout — never exposes IDBRequest objects.
 */

const DB_NAME    = 'nova_db';
const DB_VERSION = 1;

let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      // ── notes ──────────────────────────────────────────────
      if (!db.objectStoreNames.contains('notes')) {
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('createdAt',  'createdAt',  { unique: false });
        notes.createIndex('updatedAt',  'updatedAt',  { unique: false });
        notes.createIndex('pinned',     'pinned',     { unique: false });
      }

      // ── tasks ──────────────────────────────────────────────
      if (!db.objectStoreNames.contains('tasks')) {
        const tasks = db.createObjectStore('tasks', { keyPath: 'id' });
        tasks.createIndex('status',      'status',      { unique: false });
        tasks.createIndex('priority',    'priority',    { unique: false });
        tasks.createIndex('createdAt',   'createdAt',   { unique: false });
        tasks.createIndex('completedAt', 'completedAt', { unique: false });
        tasks.createIndex('dueDate',     'dueDate',     { unique: false });
      }

      // ── events ─────────────────────────────────────────────
      if (!db.objectStoreNames.contains('events')) {
        const events = db.createObjectStore('events', { keyPath: 'id' });
        events.createIndex('timestamp', 'timestamp', { unique: false });
        events.createIndex('type',      'type',      { unique: false });
      }

      // ── settings ───────────────────────────────────────────
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
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

function tx(storeName, mode, fn) {
  return getDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store       = transaction.objectStore(storeName);
      let result;
      try {
        result = fn(store, transaction);
      } catch (err) {
        reject(err);
        return;
      }
      transaction.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
      transaction.onerror    = (e) => reject(e.target.error);
      transaction.onabort    = (e) => reject(e.target.error);
    });
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
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
    await tx('notes', 'readwrite', (store) => store.add(note));
    return id;
  },

  async get(id) {
    return tx('notes', 'readonly', (store) => {
      const req = store.get(id);
      return new Promise((res, rej) => {
        req.onsuccess = (e) => res(e.target.result ?? null);
        req.onerror   = (e) => rej(e.target.error);
      });
    });
  },

  async getAll() {
    return getDB().then((db) => {
      return new Promise((resolve, reject) => {
        const tx   = db.transaction('notes', 'readonly');
        const req  = tx.objectStore('notes').getAll();
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
      });
    });
  },

  async update(id, changes) {
    return getDB().then((db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('notes', 'readwrite');
        const store       = transaction.objectStore('notes');
        const getReq      = store.get(id);
        getReq.onsuccess  = (e) => {
          const existing = e.target.result;
          if (!existing) { reject(new Error(`Note ${id} not found`)); return; }
          const updated = { ...existing, ...changes, id, updatedAt: now() };
          const putReq  = store.put(updated);
          putReq.onsuccess  = () => resolve();
          putReq.onerror    = (e2) => reject(e2.target.error);
        };
        getReq.onerror = (e) => reject(e.target.error);
      });
    });
  },

  async delete(id) {
    return getDB().then((db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('notes', 'readwrite');
        const req         = transaction.objectStore('notes').delete(id);
        req.onsuccess  = () => resolve();
        req.onerror    = (e) => reject(e.target.error);
      });
    });
  },

  async search(query) {
    const all = await notes.getAll();
    if (!query || !query.trim()) return all;
    const q = query.trim().toLowerCase();
    return all.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q))
    );
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
    await tx('tasks', 'readwrite', (store) => store.add(task));
    return id;
  },

  async get(id) {
    return getDB().then((db) => {
      return new Promise((resolve, reject) => {
        const req = db.transaction('tasks', 'readonly').objectStore('tasks').get(id);
        req.onsuccess = (e) => resolve(e.target.result ?? null);
        req.onerror   = (e) => reject(e.target.error);
      });
    });
  },

  async getAll() {
    return getDB().then((db) => {
      return new Promise((resolve, reject) => {
        const req = db.transaction('tasks', 'readonly').objectStore('tasks').getAll();
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
      });
    });
  },

  async getByStatus(status) {
    const all = await tasks.getAll();
    if (status === 'all') return all;
    return all.filter((t) => t.status === status);
  },

  async update(id, changes) {
    return getDB().then((db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('tasks', 'readwrite');
        const store       = transaction.objectStore('tasks');
        const getReq      = store.get(id);
        getReq.onsuccess  = (e) => {
          const existing = e.target.result;
          if (!existing) { reject(new Error(`Task ${id} not found`)); return; }
          const updated = { ...existing, ...changes, id, updatedAt: now() };
          const putReq  = store.put(updated);
          putReq.onsuccess = () => resolve();
          putReq.onerror   = (e2) => reject(e2.target.error);
        };
        getReq.onerror = (e) => reject(e.target.error);
      });
    });
  },

  async delete(id) {
    return getDB().then((db) => {
      return new Promise((resolve, reject) => {
        const req = db.transaction('tasks', 'readwrite').objectStore('tasks').delete(id);
        req.onsuccess = () => resolve();
        req.onerror   = (e) => reject(e.target.error);
      });
    });
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
    await tx('events', 'readwrite', (store) => store.add(event));
    return id;
  },

  async getAll() {
    return getDB().then((db) => {
      return new Promise((resolve, reject) => {
        const req = db.transaction('events', 'readonly').objectStore('events').getAll();
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
      });
    });
  },

  async getRecent(limit = 50) {
    const all = await events.getAll();
    return all
      .sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1))
      .slice(0, limit);
  },
};

// ── Settings ──────────────────────────────────────────────────

const settings = {
  async get(key) {
    return getDB().then((db) => {
      return new Promise((resolve, reject) => {
        const req = db.transaction('settings', 'readonly').objectStore('settings').get(key);
        req.onsuccess = (e) => resolve(e.target.result?.value ?? null);
        req.onerror   = (e) => reject(e.target.error);
      });
    });
  },

  async set(key, value) {
    return getDB().then((db) => {
      return new Promise((resolve, reject) => {
        const req = db.transaction('settings', 'readwrite').objectStore('settings').put({ key, value });
        req.onsuccess = () => resolve();
        req.onerror   = (e) => reject(e.target.error);
      });
    });
  },

  async getAll() {
    return getDB().then((db) => {
      return new Promise((resolve, reject) => {
        const req = db.transaction('settings', 'readonly').objectStore('settings').getAll();
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
      });
    });
  },
};

// ── Public API ────────────────────────────────────────────────

export const DB = {
  init: openDB,
  notes,
  tasks,
  events,
  settings,
};
