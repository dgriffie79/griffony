import { vec3, quat } from 'gl-matrix';
import { Entity } from './Entity';
import { PhysicsLayer } from './components/PhysicsComponent';
import type { Weapon } from './Weapon';

/**
 * PlayerEntity extends Entity with player-specific functionality
 * Uses the new component system while maintaining backward compatibility
 */
export class PlayerEntity extends Entity {
  // Player-specific properties
  head: Entity = new Entity();
  
  // Network properties
  playerName: string = '';
  networkPlayerId: string = '';
  isLocalPlayer: boolean = false;
  private controller: any = null; // Reference to controlling PlayerController
  
  constructor(id: number, networkId: string = '', isLocal: boolean = false) {
    super();
    
    // Override the auto-assigned ID
    const currentIndex = Entity.all.indexOf(this);
    Entity.all.splice(currentIndex, 1);
    this.id = id;
    Entity.all.push(this);
    
    this.networkPlayerId = networkId;
    this.isLocalPlayer = isLocal;
    
    // Set up core player components
    this.setupComponents(isLocal, networkId);
    
    // Set up head entity (child of this entity)
    this.setupHead();
    
    // Set up weapon component for local players
    this.setupWeapon(isLocal);
    
    console.log(`Created ${isLocal ? 'local' : 'remote'} player entity: ${this.playerName} (ID: ${this.id})`);
  }
  
  private setupComponents(isLocal: boolean, networkId: string): void {
    // Render component
    this.addRender(globalThis.modelNames?.indexOf('player') ?? -1);
    
    // Physics component with standard player settings
    this.addPhysics({
      hasGravity: true,
      hasCollision: true,
      layer: PhysicsLayer.Player,
      radius: 0.25,
      height: 0.5,
      mass: 1.0
    });
    
    // Health component
    this.addHealth(100);
    
    // Network component for remote players only
    if (!isLocal && networkId) {
      const networkComp = this.addNetwork(networkId);
      networkComp.smoothingEnabled = true;
      networkComp.maxInterpolationDistance = 5.0;
      this.playerName = `Player_${networkId}`;
    } else {
      this.playerName = networkId ? `Local_${networkId}` : 'Player_Local';
    }
  }
  
  private setupHead(): void {
    this.head.id = Entity.nextId++;
    this.head.parent = this;
    this.head.localPosition = vec3.fromValues(0, 0, 0.8 * (this.physics?.height || 0.5));
    this.children.push(this.head);
  }
  
  private setupWeapon(isLocal: boolean): void {
    // Add weapon component for weapon management
    this.addWeapon();
    
    if (!isLocal) {
      // Remote players don't need first-person weapon view
      if (this.weapon) {
        this.weapon.setVisible(false);
      }
    }
  }
  
  setController(controller: any): void {
    this.controller = controller;
  }
  
  getController(): any {
    return this.controller;
  }
  
  getHead(): Entity {
    return this.head;
  }
  
  processInput(input: any): void {
    // Input processing logic - this would contain movement, rotation, etc.
    // For now, this is a placeholder
    if (!this.physics) return;
    
    // Example: Basic movement processing
    // This would be expanded with actual input handling
  }

  /**
   * Equip a weapon
   */
  equipWeapon(weapon: Weapon | null): void {
    if (this.weapon) {
      this.weapon.equipWeapon(weapon);
    }
  }

  /**
   * Get the currently equipped weapon
   */
  getEquippedWeapon(): Weapon | null {
    return this.weapon?.getEquippedWeapon() ?? null;
  }

  /**
   * Start an attack with the equipped weapon
   */
  startAttack(): void {
    if (this.weapon) {
      this.weapon.startAttack();
    }
  }

  /**
   * Check if currently attacking
   */
  isAttacking(): boolean {
    return this.weapon?.isCurrentlyAttacking() ?? false;
  }

  /**
   * Show/hide the first-person weapon
   */
  setWeaponVisible(visible: boolean): void {
    if (this.weapon) {
      this.weapon.setVisible(visible);
    }
  }

  // Legacy compatibility property for fpWeapon
  get fpWeapon(): any {
    return this.weapon?.fpWeaponEntity || null;
  }
  
  respawn(): void {
    vec3.zero(this.localPosition);
    if (this.physics) {
      vec3.zero(this.physics.velocity);
    }
    quat.identity(this.localRotation);
    quat.identity(this.head.localRotation);
    this.dirty = true;

    // Find spawn point and move there
    for (const e of Entity.all) {
      if (e.spawn) {
        vec3.copy(this.localPosition, e.worldPosition);
        quat.copy(this.localRotation, e.worldRotation);
        break;
      }
    }
    
    // Reset health if available
    if (this.health && this.health.isDead) {
      this.health.revive();
    }
  }
  
  // Override serialize to include player-specific data
  serialize(): any {
    const baseData = super.serialize();
    return {
      ...baseData,
      type: 'PlayerEntity',
      networkPlayerId: this.networkPlayerId,
      playerName: this.playerName,
      isLocalPlayer: this.isLocalPlayer
    };
  }
  
  // ========================================
  // STATIC FACTORY METHODS
  // ========================================
  
  /**
   * Create from snapshot data
   */
  static fromSnapshot(snapshot: any): PlayerEntity {
    const entity = new PlayerEntity(
      parseInt(snapshot.entityId), 
      snapshot.networkPlayerId,
      snapshot.isLocalPlayer || false
    );
    
    // Apply snapshot data
    vec3.copy(entity.localPosition, snapshot.position);
    quat.copy(entity.localRotation, snapshot.rotation);
    
    if (snapshot.physics?.velocity && entity.physics) {
      vec3.copy(entity.physics.velocity, snapshot.physics.velocity);
    }
    
    if (snapshot.health && entity.health) {
      entity.health.currentHealth = snapshot.health.currentHealth;
      entity.health.isDead = snapshot.health.isDead || false;
    }
    
    entity.playerName = snapshot.playerName || `Player_${snapshot.networkPlayerId}`;
    
    return entity;
  }
  
  /**
   * Create a new player entity
   */
  static createPlayerEntity(networkId: string, isLocal: boolean = false): PlayerEntity {
    let entityId: number;
    
    if (isLocal) {
      entityId = 1; // Local player always gets ID 1
    } else {
      // Remote players get IDs starting from 10000
      const existingRemotePlayers = Entity.all.filter(e => 
        e instanceof PlayerEntity && !e.isLocalPlayer
      ).length;
      entityId = 10000 + existingRemotePlayers;
    }
    
    const entity = new PlayerEntity(entityId, networkId, isLocal);
    entity.respawn(); // Position at spawn point
    
    console.log(`Created ${isLocal ? 'local' : 'remote'} player entity: ${entity.playerName} (ID: ${entityId})`);
    return entity;
  }
  
  /**
   * Find player by network ID
   */
  static findByNetworkId(networkId: string): PlayerEntity | undefined {
    return Entity.all.find(e => 
      e instanceof PlayerEntity && 
      e.networkPlayerId === networkId
    ) as PlayerEntity | undefined;
  }
  
  /**
   * Get all player entities
   */
  static getAllPlayerEntities(): PlayerEntity[] {
    return Entity.all.filter(e => e instanceof PlayerEntity) as PlayerEntity[];
  }
  
  /**
   * Get the local player entity
   */
  static getLocalPlayerEntity(): PlayerEntity | undefined {
    return Entity.all.find(e => 
      e instanceof PlayerEntity && 
      e.isLocalPlayer
    ) as PlayerEntity | undefined;
  }
  
  /**
   * Get all remote player entities
   */
  static getRemotePlayerEntities(): PlayerEntity[] {
    return Entity.all.filter(e => 
      e instanceof PlayerEntity && 
      !e.isLocalPlayer
    ) as PlayerEntity[];
  }
  
  // Legacy compatibility methods
  static getLocalPlayer(): PlayerEntity | undefined {
    return PlayerEntity.getLocalPlayerEntity();
  }
  
  static findRemotePlayer(networkPlayerId: string): PlayerEntity | undefined {
    return Entity.all.find(e => 
      e instanceof PlayerEntity && 
      !e.isLocalPlayer && 
      e.networkPlayerId === networkPlayerId
    ) as PlayerEntity | undefined;
  }
  
  static createRemotePlayer(networkPlayerId: string): PlayerEntity {
    return PlayerEntity.createPlayerEntity(networkPlayerId, false);
  }
}