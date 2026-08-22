const normalize = value => String(value ?? '').trim().toLowerCase();

export class WulanWorldModel {
  constructor({ now = () => new Date().toISOString() } = {}) {
    this.now = now;
    this.projects = new Map();
    this.systems = new Map();
    this.observations = [];
  }

  upsertProject(project) {
    if (!project?.id) throw new TypeError('Project requires an id');
    const id = normalize(project.id);
    const previous = this.projects.get(id);
    const value = {
      ...previous,
      ...project,
      id,
      updatedAt: this.now()
    };
    this.projects.set(id, value);
    return value;
  }

  upsertSystem(system) {
    if (!system?.id) throw new TypeError('System requires an id');
    const id = normalize(system.id);
    const previous = this.systems.get(id);
    const value = {
      ...previous,
      ...system,
      id,
      updatedAt: this.now()
    };
    this.systems.set(id, value);
    return value;
  }

  observe(observation) {
    const value = { ...observation, observedAt: observation?.observedAt ?? this.now() };
    this.observations.push(value);
    if (this.observations.length > 200) this.observations.shift();
    return value;
  }

  getProject(id) { return this.projects.get(normalize(id)) ?? null; }
  getSystem(id) { return this.systems.get(normalize(id)) ?? null; }

  listProjects() { return [...this.projects.values()]; }
  listSystems() { return [...this.systems.values()]; }

  search(query) {
    const needle = normalize(query);
    if (!needle) return [];
    return [...this.projects.values(), ...this.systems.values()].filter(item =>
      JSON.stringify(item).toLowerCase().includes(needle)
    );
  }

  snapshot() {
    return {
      projects: this.listProjects(),
      systems: this.listSystems(),
      observations: [...this.observations]
    };
  }
}

export function seedWulanWorld(world) {
  world.upsertProject({
    id: 'sentinel',
    name: 'Sentinel',
    type: 'project',
    repository: 'fakej3/Sentinel',
    branch: 'main',
    capabilities: ['github.inspect', 'sentinel.inspect']
  });

  world.upsertProject({
    id: 'edgelab',
    name: 'EdgeLab',
    type: 'project',
    capabilities: []
  });

  return world;
}
