import { vec3, quat } from 'gl-matrix';
import { Entity } from './Entity';
import { FirstPersonWeapon } from './FirstPersonWeapon';
import { Logger } from './Logger.js';

const logger = Logger.getInstance();

export class Player extends Entity {
  gravity: boolean = true;
  collision: boolean = true;
  height: number = 0.5;
  radius: number = 0.25;
  head: Entity = new Entity();
  fpWeapon: FirstPersonWeapon;
  
  // Network properties for multiplayer
  playerName: string = '';
  isLocalPlayer: boolean = true;
  networkPlayerId: string = ''; // Separate network ID for remote players
  constructor(id: number = Entity.nextId++, isLocal: boolean = true, networkId: string = '') {
    super();
    this.id = id;
    this.isLocalPlayer = isLocal;
    this.networkPlayerId = networkId;
    this.model = globalThis.models?.['player'] || null;
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
      // For remote players, disable the weapon rendering by removing the model
      this.fpWeapon.model = null;
      
      logger.info('PLAYER', `Created remote player: ${this.playerName} (ID: ${this.id}, Network ID: ${networkId})`);
    } else {
      // Local player setup - NEVER make local player a network entity
      this.isNetworkEntity = false;
      this.playerName = networkId ? `Local_${networkId}` : 'Player_Local';
      this.fpWeapon = new FirstPersonWeapon(this);
        logger.info('PLAYER', `Created local player: ${this.playerName} (ID: ${this.id})`);
    }
  }
  // Override serialize to include player-specific data
  serialize(): any {
    const baseData = super.serialize();
    return {
      ...baseData,
      type: 'Player', // Explicitly set type for proper deserialization
      networkPlayerId: this.networkPlayerId,
      playerName: this.playerName,
      isLocalPlayer: this.isLocalPlayer
    };
  }

  // Static method to create a Player from snapshot data
  static fromSnapshot(snapshot: any): Player {
    // Create player with appropriate type based on snapshot data
    const isLocal = snapshot.isLocalPlayer || false;
    const networkId = snapshot.networkPlayerId || '';
    
    // For remote players, use the createRemotePlayer method
    if (!isLocal) {
      const player = new Player(parseInt(snapshot.entityId), false, networkId);
      
      // Apply snapshot data
      vec3.copy(player.localPosition, snapshot.position);
      quat.copy(player.localRotation, snapshot.rotation);
      if (snapshot.velocity) {
        vec3.copy(player.vel, snapshot.velocity);
      }
      
      // Set player-specific properties
      player.playerName = snapshot.playerName || `Player_${networkId}`;
      player.isNetworkEntity = true;
      player.ownerId = networkId;
      
      return player;
    } else {
      // This shouldn't happen in normal multiplayer flow, but handle it gracefully
      throw new Error('Cannot create local player from snapshot - local player should already exist');
    }
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
  // Static method to create a remote player
  static createRemotePlayer(networkPlayerId: string): Player {
    // Use a special ID range for remote players (starting from 10000)
    const existingRemotePlayers = Entity.all.filter(e => e instanceof Player && !e.isLocalPlayer).length;
    const remoteId = 10000 + existingRemotePlayers;
    const remotePlayer = new Player(remoteId, false, networkPlayerId);
    
    // Position remote players at spawn points or default location
    remotePlayer.respawn();
    
    // Add to entity list
    Entity.all.push(remotePlayer);
    
    logger.info('PLAYER', `Created remote player with ID ${remoteId} for network ID ${networkPlayerId}`);
    return remotePlayer;
  }

  // Static method to find a remote player by network ID
  static findRemotePlayer(networkPlayerId: string): Player | undefined {
    return Entity.all.find(e => 
      e instanceof Player && 
      !e.isLocalPlayer && 
      e.networkPlayerId === networkPlayerId
    ) as Player | undefined;
  }

  // Static method to get the local player
  static getLocalPlayer(): Player | undefined {
    return Entity.all.find(e => 
      e instanceof Player && 
      e.isLocalPlayer
    ) as Player | undefined;
  }
}
