import { vec3, quat } from 'gl-matrix';
import { Entity } from './Entity';
import { Logger } from './Logger.js';

const logger = Logger.getInstance();

export class PlayerEntity extends Entity {
  gravity: boolean = true;
  collision: boolean = true;
  height: number = 0.5;
  radius: number = 0.25;
  head: Entity = new Entity();
  
  // Network properties
  playerName: string = '';
  networkPlayerId: string = '';
  private controller: any = null; // Reference to controlling PlayerController
  
  constructor(id: number = Entity.nextId++, networkId: string = '') {
    super();
    this.id = id;
    this.networkPlayerId = networkId;
    this.model = globalThis.models?.['player'] || null;
      // Set up head entity
    this.head.id = Entity.nextId++;
    this.head.parent = this;
    this.head.localPosition = vec3.fromValues(0, 0, 0.8 * this.height);
    this.children.push(this.head);
    
    // Default properties
    this.playerName = networkId ? `Player_${networkId}` : 'Player';
    
    logger.info('PLAYER_ENTITY', `Created player entity: ${this.playerName} (ID: ${this.id})`);
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
    
    const entity = new PlayerEntity(entityId, networkId);
    entity.isNetworkEntity = !isLocal;
    entity.ownerId = networkId;
    entity.playerName = isLocal ? `Local_${networkId}` : `Remote_${networkId}`;
    
    // Position at spawn point
    entity.respawn();
    
    // Add to entity list
    Entity.all.push(entity);
    
    logger.info('PLAYER_ENTITY', `Created ${isLocal ? 'local' : 'remote'} player entity: ${entity.playerName} (ID: ${entityId})`);
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
}
