import { vec3, quat } from 'gl-matrix';
import { Entity } from './Entity';
import { FirstPersonWeapon } from './FirstPersonWeapon';

export class PlayerEntity extends Entity {
  gravity: boolean = true;
  collision: boolean = true;
  height: number = 0.5;
  radius: number = 0.25;
  head: Entity = new Entity();
  fpWeapon: FirstPersonWeapon;
  
  // Network properties
  playerName: string = '';
  networkPlayerId: string = '';
  isLocalPlayer: boolean = false; // Add this for compatibility
  private controller: any = null; // Reference to controlling PlayerController
  
  constructor(id: number = Entity.nextId++, networkId: string = '', isLocal: boolean = false) {
    super();
    this.id = id;
    this.networkPlayerId = networkId;
    this.isLocalPlayer = isLocal;
    this.modelId = globalThis.modelNames?.indexOf('player') ?? -1;
    
    // Set up head entity
    this.head.id = Entity.nextId++;
    this.head.parent = this;
    this.head.localPosition = vec3.fromValues(0, 0, 0.8 * this.height);
    this.children.push(this.head);
    
    // Set up network properties for remote players
    if (!isLocal) {
      this.isNetworkEntity = true;
      this.ownerId = networkId;
      this.playerName = `Player_${networkId}`;
      
      // Remote players don't need first-person weapon view
      this.fpWeapon = new FirstPersonWeapon(this);
      // For remote players, disable the weapon rendering by removing the modelId
      this.fpWeapon.modelId = -1;
      
      console.log(`Created remote player entity: ${this.playerName} (ID: ${this.id}, Network ID: ${networkId})`);
    } else {
      // Local player setup - NEVER make local player a network entity
      this.isNetworkEntity = false;
      this.playerName = networkId ? `Local_${networkId}` : 'Player_Local';
      this.fpWeapon = new FirstPersonWeapon(this);
      
      console.log(`Created local player entity: ${this.playerName} (ID: ${this.id})`);
    }
    
    console.log(`Created player entity: ${this.playerName} (ID: ${this.id})`);
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
    // This would contain the logic for applying input to the entity
    // Moving this from the Player class
    // For now, this is a placeholder - the actual input processing
    // would need to be moved from the existing Player class
  }
  
  respawn(): void {
    vec3.zero(this.localPosition);
    vec3.zero(this.vel);
    quat.identity(this.localRotation);
    quat.identity(this.head.localRotation);
    this.dirty = true;

    for (const e of Entity.all) {
      if (e.spawn) {
        vec3.copy(this.localPosition, e.worldPosition);
        quat.copy(this.localRotation, e.worldRotation);
        break;
      }
    }
  }
  
  // Override serialize to include player-specific data
  serialize(): any {
    const baseData = super.serialize();
    return {
      ...baseData,
      type: 'PlayerEntity',
      networkPlayerId: this.networkPlayerId,
      playerName: this.playerName
    };
  }
  
  // Static method to create from snapshot
  static fromSnapshot(snapshot: any): PlayerEntity {
    const entity = new PlayerEntity(parseInt(snapshot.entityId), snapshot.networkPlayerId);
    
    // Apply snapshot data
    vec3.copy(entity.localPosition, snapshot.position);
    quat.copy(entity.localRotation, snapshot.rotation);
    if (snapshot.velocity) {
      vec3.copy(entity.vel, snapshot.velocity);
    }
    
    // Set player-specific properties
    entity.playerName = snapshot.playerName || `Player_${snapshot.networkPlayerId}`;
    entity.isNetworkEntity = !snapshot.isLocal; // Network entity unless explicitly local
    entity.ownerId = snapshot.networkPlayerId;
    
    return entity;
  }  
  // Static method for creating player entities
  static createPlayerEntity(networkId: string, isLocal: boolean = false): PlayerEntity {
    let entityId: number;
    
    if (isLocal) {
      entityId = 1; // Local player always gets ID 1
    } else {
      // Generate unique ID for remote players
      const existingRemotePlayers = Entity.all.filter(e => 
        e instanceof PlayerEntity && e.isNetworkEntity
      ).length;
      entityId = 10000 + existingRemotePlayers;
    }
    
    const entity = new PlayerEntity(entityId, networkId, isLocal);
    entity.isNetworkEntity = !isLocal;
    entity.ownerId = networkId;
    entity.playerName = isLocal ? `Local_${networkId}` : `Remote_${networkId}`;
    
    // Position at spawn point
    entity.respawn();
    
    // Add to entity list
    Entity.all.push(entity);
    
    console.log(`Created ${isLocal ? 'local' : 'remote'} player entity: ${entity.playerName} (ID: ${entityId})`);
    return entity;
  }
  
  static findByNetworkId(networkId: string): PlayerEntity | undefined {
    return Entity.all.find(e => 
      e instanceof PlayerEntity && 
      e.networkPlayerId === networkId
    ) as PlayerEntity | undefined;
  }
  
  static getAllPlayerEntities(): PlayerEntity[] {
    return Entity.all.filter(e => e instanceof PlayerEntity) as PlayerEntity[];
  }
  
  static getLocalPlayerEntity(): PlayerEntity | undefined {
    return Entity.all.find(e => 
      e instanceof PlayerEntity && 
      !e.isNetworkEntity
    ) as PlayerEntity | undefined;
  }
  
  // Legacy compatibility methods
  static getLocalPlayer(): PlayerEntity | undefined {
    return PlayerEntity.getLocalPlayerEntity();
  }
  
  static findRemotePlayer(networkPlayerId: string): PlayerEntity | undefined {
    return Entity.all.find(e => 
      e instanceof PlayerEntity && 
      e.isNetworkEntity && 
      e.networkPlayerId === networkPlayerId
    ) as PlayerEntity | undefined;
  }
  
  static createRemotePlayer(networkPlayerId: string): PlayerEntity {
    // Use a special ID range for remote players (starting from 10000)
    const existingRemotePlayers = Entity.all.filter(e => e instanceof PlayerEntity && e.isNetworkEntity).length;
    const remoteId = 10000 + existingRemotePlayers;
    const remotePlayer = new PlayerEntity(remoteId, networkPlayerId, false);
    
    // Position remote players at spawn points or default location
    remotePlayer.respawn();
    
    // Add to entity list
    Entity.all.push(remotePlayer);
    
    console.log(`Created remote player with ID ${remoteId} for network ID ${networkPlayerId}`);
    return remotePlayer;
  }
}
