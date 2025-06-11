import { mat4, quat, vec3 } from 'gl-matrix';
import type { Level } from './Level';

// Import component types and classes
import { RenderComponent } from './components/RenderComponent';
import { PhysicsComponent } from './components/PhysicsComponent';
import { NetworkComponent } from './components/NetworkComponent';
import { HealthComponent } from './components/HealthComponent';
import { WeaponComponent } from './components/WeaponComponent';

// Re-export component types and enums for backward compatibility
export { PhysicsLayer } from './components/PhysicsComponent';
export type { NetworkState, PredictionState } from './components/NetworkComponent';
export type { PhysicsConfig } from './components/PhysicsComponent';
export type { DamageInfo } from './components/HealthComponent';

/**
 * Core Entity class with component-based architecture
 * Uses direct member access for performance while maintaining architectural benefits
 */
export class Entity {
  static all: Entity[] = [];
  static nextId: number = 1;

  id: number;
  parent: Entity | null = null;
  children: Entity[] = [];

  // Transform properties (always present for every entity)
  dirty: boolean = true;
  localPosition: vec3 = vec3.create();
  localRotation: quat = quat.create();
  localScale: vec3 = vec3.fromValues(1, 1, 1);
  localToWorldTransform: mat4 = mat4.create();
  worldPosition: vec3 = vec3.create();
  worldRotation: quat = quat.create();
  worldScale: vec3 = vec3.fromValues(1, 1, 1);
  worldToLocalTransform: mat4 = mat4.create();

  // Direct component references for performance (null if not present)
  render: RenderComponent | null = null;
  physics: PhysicsComponent | null = null;
  network: NetworkComponent | null = null;
  health: HealthComponent | null = null;
  weapon: WeaponComponent | null = null;

  // Legacy properties for backward compatibility during transition
  // These will be removed once all systems are updated
  spawn: boolean = false;

  // Legacy getters/setters for smooth transition
  get modelId(): number { return this.render?.modelId ?? -1; }
  set modelId(value: number) { if (this.render) this.render.modelId = value; }
  
  get frame(): number { return this.render?.frame ?? 0; }
  set frame(value: number) { if (this.render) this.render.frame = value; }
  
  get animationFrame(): number { return this.render?.animationFrame ?? 0; }
  set animationFrame(value: number) { if (this.render) this.render.animationFrame = value; }
  
  get velocity(): vec3 { return this.physics?.velocity ?? vec3.create(); }
  set velocity(value: vec3) { if (this.physics) vec3.copy(this.physics.velocity, value); }
  
  get vel(): vec3 { return this.velocity; } // Alias
  set vel(value: vec3) { this.velocity = value; }
  
  get gravity(): boolean { return this.physics?.hasGravity ?? false; }
  set gravity(value: boolean) { if (this.physics) this.physics.hasGravity = value; }
  
  get collision(): boolean { return this.physics?.hasCollision ?? false; }
  set collision(value: boolean) { if (this.physics) this.physics.hasCollision = value; }
  
  get radius(): number { return this.physics?.radius ?? 0; }
  set radius(value: number) { if (this.physics) this.physics.radius = value; }
  
  get height(): number { return this.physics?.height ?? 0; }
  set height(value: number) { if (this.physics) this.physics.height = value; }
  
  get physicsLayer(): number { return this.physics?.layer ?? 0; }
  set physicsLayer(value: number) { if (this.physics) this.physics.layer = value; }
  
  get collidesWith(): number { return this.physics?.collidesWith ?? 0; }
  set collidesWith(value: number) { if (this.physics) this.physics.collidesWith = value; }
  
  get isNetworkEntity(): boolean { return this.network !== null; }
  set isNetworkEntity(value: boolean) { 
    // Can't easily create/destroy network component here, handled elsewhere
  }
  
  get ownerId(): string { return this.network?.ownerId ?? ''; }
  set ownerId(value: string) { if (this.network) this.network.ownerId = value; }
  
  get _tempGravity(): boolean | undefined { return this.physics?._tempGravity; }
  set _tempGravity(value: boolean | undefined) { if (this.physics) this.physics._tempGravity = value; }
  
  get _tempCollision(): boolean | undefined { return this.physics?._tempCollision; }
  set _tempCollision(value: boolean | undefined) { if (this.physics) this.physics._tempCollision = value; }

  constructor() {
    this.id = Entity.nextId++;
    Entity.all.push(this);
  }

  /**
   * Add a render component to this entity
   */
  addRender(modelId: number): RenderComponent {
    this.render = new RenderComponent(this, modelId);
    return this.render;
  }

  /**
   * Add a physics component to this entity
   */
  addPhysics(config: any = {}): PhysicsComponent {
    this.physics = new PhysicsComponent(this, config);
    return this.physics;
  }

  /**
   * Add a network component to this entity
   */
  addNetwork(ownerId: string): NetworkComponent {
    this.network = new NetworkComponent(this, ownerId);
    return this.network;
  }

  /**
   * Add a health component to this entity
   */
  addHealth(maxHealth: number = 100): HealthComponent {
    this.health = new HealthComponent(this, maxHealth);
    return this.health;
  }

  /**
   * Add a weapon component to this entity
   */
  addWeapon(): WeaponComponent {
    this.weapon = new WeaponComponent(this);
    return this.weapon;
  }

  /**
   * Remove a component from this entity
   */
  removeComponent(componentType: 'render' | 'physics' | 'network' | 'health' | 'weapon'): void {
    const component = this[componentType];
    if (component) {
      component.destroy();
      this[componentType] = null;
    }
  }

  /**
   * Update transform hierarchy and all components
   */
  updateTransforms(parentTransform: mat4 | null = null): void {
    if (this.dirty) {
      mat4.fromRotationTranslationScale(
        this.localToWorldTransform,
        this.localRotation,
        this.localPosition,
        this.localScale
      );

      if (parentTransform) {
        mat4.multiply(this.localToWorldTransform, parentTransform, this.localToWorldTransform);
      }

      mat4.getTranslation(this.worldPosition, this.localToWorldTransform);
      mat4.getRotation(this.worldRotation, this.localToWorldTransform);
      mat4.getScaling(this.worldScale, this.localToWorldTransform);
      mat4.invert(this.worldToLocalTransform, this.localToWorldTransform);
      this.dirty = false;
    }

    // Update children transforms
    for (const child of this.children) {
      child.dirty = true;
      child.updateTransforms(this.localToWorldTransform);
    }
  }

  /**
   * Update all components - called every frame
   */
  update(deltaTime: number): void {
    // Update transform hierarchy first
    this.updateTransforms();
    
    // Update all active components with direct property access (no Map lookups)
    this.render?.update(deltaTime);
    this.physics?.update(deltaTime);
    this.network?.update(deltaTime);
    this.health?.update(deltaTime);
    this.weapon?.update(deltaTime);
  }

  /**
   * Check if entity is on the ground (legacy compatibility)
   */
  onGround(terrain: Level): boolean {
    if (!this.physics) return false;
    
    const r = 0.85 * this.physics.radius;
    const x = this.worldPosition[0];
    const y = this.worldPosition[1];
    const z = this.worldPosition[2] - 0.1;

    return !!(
      terrain.volume.getVoxelFloor(x, y, z) ||
      terrain.volume.getVoxelFloor(x + r, y, z) ||
      terrain.volume.getVoxelFloor(x - r, y, z) ||
      terrain.volume.getVoxelFloor(x, y + r, z) ||
      terrain.volume.getVoxelFloor(x, y - r, z)
    );
  }

  /**
   * Legacy compatibility method - check if entities can collide
   */
  canCollideWith(other: Entity): boolean {
    // Check if either entity is a player in godMode
    if (((globalThis as any).godMode && this.isPlayer()) || 
        ((globalThis as any).godMode && other.isPlayer())) {
      return false;
    }
    
    // Use physics components if available
    if (this.physics && other.physics) {
      return this.physics.canCollideWith(other.physics);
    }
    
    return false;
  }

  /**
   * Check if this entity is a player (has specific components)
   */
  isPlayer(): boolean {
    // Duck typing - if it walks like a player and talks like a player...
    return 'head' in this; // PlayerEntity has a head property
  }

  // Legacy network methods for backward compatibility
  applyNetworkUpdate(state: any, isAuthoritative: boolean = false): void {
    if (this.network) {
      this.network.applyNetworkUpdate(state, isAuthoritative);
    }
  }

  updateNetworkInterpolation(deltaTime: number): void {
    if (this.network) {
      this.network.update(deltaTime);
    }
  }

  saveStateForPrediction(inputSequence: number): void {
    if (this.network) {
      this.network.saveStateForPrediction(inputSequence);
    }
  }

  reconcileWithServer(serverState: any, inputSequence: number): void {
    if (this.network) {
      this.network.reconcileWithServer(serverState, inputSequence);
    }
  }

  getNetworkSnapshot(): any {
    if (this.network) {
      return this.network.getNetworkSnapshot();
    }
    return null;
  }

  // ========================================
  // SERIALIZATION AND NETWORK METHODS
  // ========================================

  /**
   * Serialize entity data for network transmission
   */
  serialize(): any {
    return {
      entityId: this.id.toString(),
      entityType: this.constructor.name,
      position: Array.from(this.localPosition) as [number, number, number],
      rotation: Array.from(this.localRotation) as [number, number, number, number],
      scale: Array.from(this.localScale) as [number, number, number],
      // Component data
      render: this.render ? {
        modelId: this.render.modelId,
        frame: this.render.frame,
        animationFrame: this.render.animationFrame,
        visible: this.render.visible
      } : null,
      physics: this.physics ? {
        velocity: Array.from(this.physics.velocity) as [number, number, number],
        hasGravity: this.physics.hasGravity,
        hasCollision: this.physics.hasCollision,
        layer: this.physics.layer,
        radius: this.physics.radius,
        height: this.physics.height
      } : null,
      network: this.network ? {
        ownerId: this.network.ownerId,
        isAuthoritative: this.network.isAuthoritative
      } : null,
      health: this.health ? {
        currentHealth: this.health.currentHealth,
        maxHealth: this.health.maxHealth,
        isDead: this.health.isDead
      } : null,
      // Legacy properties
      spawn: this.spawn
    };
  }

  /**
   * Create entity from serialized data
   */
  static fromSnapshot(snapshot: any): Entity {
    const entity = new Entity();
    
    // Override the auto-assigned ID with the snapshot ID
    entity.id = parseInt(snapshot.entityId);
    
    // Update the nextId to ensure no conflicts
    if (entity.id >= Entity.nextId) {
      Entity.nextId = entity.id + 1;
    }
    
    // Apply transform data
    vec3.copy(entity.localPosition, snapshot.position);
    quat.copy(entity.localRotation, snapshot.rotation);
    if (snapshot.scale) {
      vec3.copy(entity.localScale, snapshot.scale);
    }
    
    // Recreate components from snapshot data
    if (snapshot.render) {
      const renderComp = entity.addRender(snapshot.render.modelId);
      renderComp.frame = snapshot.render.frame || 0;
      renderComp.animationFrame = snapshot.render.animationFrame || 0;
      renderComp.visible = snapshot.render.visible ?? true;
    }
    
    if (snapshot.physics) {
      const physicsComp = entity.addPhysics({
        hasGravity: snapshot.physics.hasGravity,
        hasCollision: snapshot.physics.hasCollision,
        layer: snapshot.physics.layer,
        radius: snapshot.physics.radius,
        height: snapshot.physics.height
      });
      if (snapshot.physics.velocity) {
        vec3.copy(physicsComp.velocity, snapshot.physics.velocity);
      }
    }
    
    if (snapshot.network) {
      const networkComp = entity.addNetwork(snapshot.network.ownerId);
      networkComp.isAuthoritative = snapshot.network.isAuthoritative || false;
    }
    
    if (snapshot.health) {
      const healthComp = entity.addHealth(snapshot.health.maxHealth);
      healthComp.currentHealth = snapshot.health.currentHealth;
      healthComp.isDead = snapshot.health.isDead || false;
    }
    
    // Legacy properties
    entity.spawn = snapshot.spawn || false;
    
    entity.dirty = true;
    return entity;
  }

  /**
   * Legacy deserialization from Tiled map data
   */
  static deserialize(data: any): Entity | null {
    let entity: Entity;

    switch (data.type.toUpperCase()) {
      case 'PLAYER':
        return null; // Players are handled separately
      case 'SPAWN':
        entity = new Entity();
        entity.spawn = true;
        // Use 'portal' model for spawn points
        entity.addRender(globalThis.modelNames?.indexOf('portal') ?? -1);
        break;
      default:
        entity = new Entity();
        break;
    }

    entity.localPosition = vec3.fromValues(data.x / 32, data.y / 32, 1);

    // Process Tiled properties
    for (const property of data.properties ?? []) {
      switch (property.name) {
        case 'rotation':
          quat.fromEuler(entity.localRotation, 0, 0, property.value);
          break;
        case 'scale':
          entity.localScale = vec3.fromValues(property.value, property.value, property.value);
          if (entity.physics) {
            entity.physics.radius = property.value;
          }
          break;
        case 'model_id':
          // Ensure entity has a render component before setting model
          if (!entity.render) {
            entity.addRender(-1); // Add render component with placeholder model
          }
          
          if (entity.render) {
            if (typeof property.value === 'string') {
              entity.render.setModelByName(property.value);
            } else if (typeof property.value === 'number') {
              entity.render.setModel(property.value);
            }
          }
          break;
      }
    }

    return entity;
  }

  // ========================================
  // STATIC UTILITY METHODS
  // ========================================

  /**
   * Clear all entities from the global list
   */
  static clearAllEntities(): void {
    // Destroy all components before clearing, with error handling
    for (const entity of Entity.all) {
      try {
        entity.render?.destroy();
      } catch (error) {
        console.warn('Error destroying render component:', error);
      }
      
      try {
        entity.physics?.destroy();
      } catch (error) {
        console.warn('Error destroying physics component:', error);
      }
      
      try {
        entity.network?.destroy();
      } catch (error) {
        console.warn('Error destroying network component:', error);
      }
      
      try {
        entity.health?.destroy();
      } catch (error) {
        console.warn('Error destroying health component:', error);
      }
      
      try {
        entity.weapon?.destroy();
      } catch (error) {
        console.warn('Error destroying weapon component:', error);
      }
      
      // Clear component references
      entity.render = null;
      entity.physics = null;
      entity.network = null;
      entity.health = null;
      entity.weapon = null;
    }
    
    Entity.all.length = 0;
    Entity.nextId = 1;
  }

  /**
   * Load entities from an array of snapshots
   */
  static loadEntitiesFromSnapshots(snapshots: any[]): Entity[] {
    const loadedEntities: Entity[] = [];
    
    for (const snapshot of snapshots) {
      try {
        const entity = Entity.fromSnapshot(snapshot);
        loadedEntities.push(entity);
      } catch (error) {
        console.error('Failed to load entity from snapshot:', error, snapshot);
      }
    }
    
    return loadedEntities;
  }

  /**
   * Get all entities as serialized snapshots
   */
  static getAllEntitiesAsSnapshots(): any[] {
    return Entity.all.map(entity => entity.serialize());
  }

  /**
   * Find entity by ID
   */
  static findById(id: number): Entity | undefined {
    return Entity.all.find(entity => entity.id === id);
  }

  /**
   * Find all entities with a specific component
   */
  static findWithComponent(componentType: 'render' | 'physics' | 'network' | 'health' | 'weapon'): Entity[] {
    return Entity.all.filter(entity => entity[componentType] !== null);
  }

  /**
   * Find all entities with render components (for rendering system)
   */
  static findRenderableEntities(): Entity[] {
    return Entity.all.filter(entity => entity.render !== null);
  }

  /**
   * Find all entities with physics components (for physics system)
   */
  static findPhysicsEntities(): Entity[] {
    return Entity.all.filter(entity => entity.physics !== null);
  }

  /**
   * Find all network entities (for network system)
   */
  static findNetworkEntities(): Entity[] {
    return Entity.all.filter(entity => entity.network !== null);
  }
}