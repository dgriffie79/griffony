import { mat4, quat, vec3 } from 'gl-matrix';
import type { Level } from './Level';
import type { EntitySnapshot } from './types/index';
import type { NetworkState } from './components/NetworkComponent';

// Import component types and classes
import { RenderComponent } from './components/RenderComponent';
import { PhysicsComponent } from './components/PhysicsComponent';
import { NetworkComponent } from './components/NetworkComponent';
import { HealthComponent } from './components/HealthComponent';
import { WeaponComponent } from './components/WeaponComponent';
import { PlayerComponent } from './components/PlayerComponent';

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
  networkId: string = '';
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
  player: PlayerComponent | null = null;
  // Legacy spawn property - used by deserialize method for spawn points
  spawn: boolean = false;

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
  addPhysics(config: Partial<import('./components/PhysicsComponent').PhysicsConfig> = {}): PhysicsComponent {
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
   * Add a player component to this entity
   */
  addPlayer(networkId: string = '', peerId?: string): PlayerComponent {
    this.player = new PlayerComponent(this, peerId);
    if (networkId) {
      this.networkId = networkId;
    }
    return this.player;
  }

  /**
   * Remove a component from this entity
   */
  removeComponent(componentType: 'render' | 'physics' | 'network' | 'health' | 'weapon' | 'player'): void {
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
    this.player?.update(deltaTime);
  }
  /**
   * Check if entity is on the ground (legacy compatibility)
   */
  onGround(terrain: Level): boolean {
    if (!this.physics) return false;
    
    // Always return false for god mode players so they can fly
    if (this.isPlayer() && this.player?.isInGodMode()) {
      return false;
    }
    
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
   */  canCollideWith(other: Entity): boolean {
    // Check if either entity is a player in godMode
    if ((this.isPlayer() && this.player?.isInGodMode()) || 
        (other.isPlayer() && other.player?.isInGodMode())) {
      return false;
    }
    
    // Use physics components if available
    if (this.physics && other.physics) {
      return this.physics.canCollideWith(other.physics);
    }
    
    return false;
  }
  /**
   * Check if this entity is a player (has PlayerComponent)
   */
  isPlayer(): boolean {
    return this.player !== null;
  }

  // ========================================
  // SERIALIZATION AND NETWORK METHODS
  // ========================================

  /**
   * Serialize entity data for network transmission
   */
  serialize(): EntitySnapshot {
    return {
      entityId: this.id.toString(),
      networkId: this.networkId,
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
      } : undefined,
      physics: this.physics ? {
        velocity: Array.from(this.physics.velocity) as [number, number, number],
        hasGravity: this.physics.hasGravity,
        hasCollision: this.physics.hasCollision,
        layer: this.physics.layer,
        radius: this.physics.radius,
        height: this.physics.height
      } : undefined,
      network: this.network ? {
        ownerId: this.network.ownerId,
        isAuthoritative: this.network.isAuthoritative
      } : undefined,      maxHealth: this.health?.maxHealth,
      currentHealth: this.health?.currentHealth,
      isDead: this.health?.isDead,      player: this.player ? {
        playerName: this.player.playerName,
        peerId: this.player.getPeerId()
      } : undefined,
      // Legacy spawn property (for Tiled map compatibility)
      spawn: this.spawn
    };
  }

  /**
   * Create entity from serialized data
   */
  static fromSnapshot(snapshot: EntitySnapshot): Entity {
    const entity = new Entity();
    
    // Override the auto-assigned ID with the snapshot ID
    entity.id = parseInt(snapshot.entityId);
    entity.networkId = snapshot.networkId || '';
    
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
      const renderComp = entity.addRender(snapshot.render.modelId ?? 0);
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
      const networkComp = entity.addNetwork(snapshot.network.ownerId ?? '');
      networkComp.isAuthoritative = snapshot.network.isAuthoritative || false;
    }
    
    if (snapshot.maxHealth !== undefined) {
      const healthComp = entity.addHealth(snapshot.maxHealth);
      healthComp.currentHealth = snapshot.currentHealth ?? snapshot.maxHealth;
      healthComp.isDead = snapshot.isDead ?? false;
    }      if (snapshot.player) {
      // Create player component with peerId from snapshot
      // During network deserialization, all players start as remote
      // The GameManager will later identify the local player and update accordingly
      const peerId = snapshot.player.peerId || undefined;
      const playerComp = entity.addPlayer('', peerId);
      playerComp.playerName = snapshot.player.playerName ?? '';
      console.log(`🎮 ENTITY DESERIALIZE: Created player component - Name: ${snapshot.player.playerName}, PeerID: ${peerId}, NetworkId: ${entity.networkId}`);
    }    
    // Legacy spawn property (for Tiled map compatibility)
    entity.spawn = snapshot.spawn || false;
    
    entity.dirty = true;
    return entity;
  }

  /**
   * Legacy deserialization from Tiled map data
   */
  static deserialize(data: Record<string, unknown>): Entity | null {
    let entity: Entity;

    switch (String(data.type).toUpperCase()) {
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

    entity.localPosition = vec3.fromValues(Number(data.x) / 32, Number(data.y) / 32, 1);

    // Process Tiled properties
    const properties = Array.isArray(data.properties) ? data.properties : [];
    for (const property of properties) {
      switch (property.name) {
        case 'rotation':
          quat.fromEuler(entity.localRotation, 0, 0, Number(property.value));
          break;
        case 'scale':
          const scaleValue = Number(property.value);
          entity.localScale = vec3.fromValues(scaleValue, scaleValue, scaleValue);
          if (entity.physics) {
            entity.physics.radius = scaleValue;
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
      
      try {
        entity.player?.destroy();
      } catch (error) {
        console.warn('Error destroying player component:', error);
      }
      
      // Clear component references
      entity.render = null;
      entity.physics = null;
      entity.network = null;
      entity.health = null;
      entity.weapon = null;
      entity.player = null;
    }
    
    Entity.all.length = 0;
    Entity.nextId = 1;
  }

  /**
   * Load entities from an array of snapshots
   */
  static loadEntitiesFromSnapshots(snapshots: EntitySnapshot[]): Entity[] {
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
  static getAllEntitiesAsSnapshots(): EntitySnapshot[] {
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
  static findWithComponent(componentType: 'render' | 'physics' | 'network' | 'health' | 'weapon' | 'player'): Entity[] {
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

  /**
   * Find all player entities
   */
  static findAllPlayerEntities(): Entity[] {
    return Entity.all.filter(entity => entity.player !== null);
  }

  /**
   * Find the local player entity
   */
  static findLocalPlayerEntity(): Entity | undefined {
    return Entity.all.find(entity => 
      entity.player !== null && entity.player.isLocal()
    );
  }

  /**
   * Find a player entity by network ID
   */
  static findPlayerByNetworkId(networkId: string): Entity | undefined {
    // For now, return undefined since we're removing the networkPlayerId field
    // The MultiplayerManager should handle entity lookup using its controller mapping
    return undefined;
  }

  /**
   * Find all remote player entities
   */
  static findRemotePlayerEntities(): Entity[] {
    return Entity.all.filter(entity => 
      entity.player !== null && entity.player.isRemote()
    );
  }
}