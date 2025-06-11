import { PlayerController, LocalPlayerController, RemotePlayerController } from './PlayerController';
import { Entity } from './Entity';
import { Camera } from './Camera';
import { createPlayer } from './EntityFactory';

/**
 * Manages all player controllers and their associated entities
 */
export class PlayerManager {
  private static instance: PlayerManager;
  private controllers: Map<string, PlayerController> = new Map();
  private localController: LocalPlayerController | null = null;
  
  private constructor() {}
  
  static getInstance(): PlayerManager {
    if (!PlayerManager.instance) {
      PlayerManager.instance = new PlayerManager();
    }
    return PlayerManager.instance;
  }
  
  /**
   * Create the local player controller and entity
   */  createLocalPlayer(playerId: string): { controller: LocalPlayerController, entity: Entity } {
    if (this.localController) {
      console.warn('Local player already exists');
      return {
        controller: this.localController,
        entity: this.localController.getPlayerEntity()!
      };
    }
    
    // Create local controller
    this.localController = new LocalPlayerController(playerId);
    this.controllers.set(playerId, this.localController);    // Create local player entity using factory
    const entity = createPlayer(true, playerId);
      // Connect controller to entity
    this.localController.setPlayerEntity(entity);
    
    console.log(`Created local player: ${playerId}`);
    
    return { controller: this.localController, entity };
  }
  
  /**
   * Create a remote player controller and entity
   */  createRemotePlayer(playerId: string): { controller: RemotePlayerController, entity: Entity } {
    if (this.controllers.has(playerId)) {
      console.warn(`Remote player ${playerId} already exists`);
      const existing = this.controllers.get(playerId)!;
      return {
        controller: existing as RemotePlayerController,
        entity: existing.getPlayerEntity()!
      };
    }
    
    // Create remote controller
    const controller = new RemotePlayerController(playerId);
    this.controllers.set(playerId, controller);      // Create remote player entity using factory
      const entity = createPlayer(false, playerId);
      // Connect controller to entity
    controller.setPlayerEntity(entity);
    
    console.log(`Created remote player: ${playerId}`);
    
    return { controller, entity };
  }
  
  /**
   * Remove a player (usually when they disconnect)
   */
  removePlayer(playerId: string): void {
    const controller = this.controllers.get(playerId);
    if (!controller) return;
    
    const entity = controller.getPlayerEntity();
    if (entity) {
      // Remove entity from world
      const index = Entity.all.indexOf(entity);
      if (index !== -1) {
        Entity.all.splice(index, 1);
      }
    }
    
    // Remove controller
    this.controllers.delete(playerId);
      // Clear local controller reference if this was the local player
    if (controller === this.localController) {
      this.localController = null;
    }
    
    console.log(`Removed player: ${playerId}`);
  }
  
  /**
   * Update all player controllers
   */
  update(deltaTime: number): void {
    for (const controller of this.controllers.values()) {
      controller.update(deltaTime);
    }
  }
  
  /**
   * Get the local player controller
   */
  getLocalController(): LocalPlayerController | null {
    return this.localController;
  }
  
  /**
   * Get the local player entity
   */
  getLocalPlayerEntity(): Entity | null {
    return this.localController?.getPlayerEntity() || null;
  }
  
  /**
   * Get a player controller by ID
   */
  getController(playerId: string): PlayerController | undefined {
    return this.controllers.get(playerId);
  }
  
  /**
   * Get all remote controllers
   */
  getRemoteControllers(): RemotePlayerController[] {
    return Array.from(this.controllers.values())
      .filter(c => c !== this.localController) as RemotePlayerController[];
  }
  
  /**
   * Apply network update to a remote player
   */
  applyNetworkUpdateToPlayer(playerId: string, updateData: any): void {
    const controller = this.controllers.get(playerId);    if (controller && controller instanceof RemotePlayerController) {
      controller.applyNetworkUpdate(updateData);
    } else {
      console.warn(`Cannot apply network update to player ${playerId} - not found or not remote`);
    }
  }
  
  /**
   * Get the camera from the local player
   */
  getLocalCamera(): Camera | null {
    return this.localController?.getCamera() || null;
  }
  
  /**
   * Get all player entities (for serialization)
   */
  getAllPlayerEntities(): Entity[] {
    return Array.from(this.controllers.values())
      .map(c => c.getPlayerEntity())
      .filter(e => e !== null) as Entity[];
  }
  
  /**
   * Debug: get current state
   */
  getDebugState(): any {
    return {
      totalControllers: this.controllers.size,
      localController: this.localController ? this.localController.getPlayerId() : null,
      remoteControllers: this.getRemoteControllers().map(c => c.getPlayerId()),
      playerEntities: this.getAllPlayerEntities().map(e => ({
        id: e.id,
        networkId: e.player?.networkPlayerId,
        name: e.player?.playerName,
        isNetwork: e.network !== null      }))
    };
  }

  /**
   * Update a remote player entity from network data
   */  updateRemotePlayerEntity(entityData: any): void {
    const playerId = entityData.networkPlayerId;
    if (!playerId) {
      console.warn('Received entity update without networkPlayerId');
      return;
    }

    // Find existing player entity
    const entity = Entity.findPlayerByNetworkId(playerId);
    if (!entity) {
      console.warn(`Cannot update unknown remote player entity: ${playerId}`);
      return;
    }

    // Only update if this is a remote entity (not local)
    if (!entity.network) {
      console.log(`Ignoring update for local player entity: ${playerId}`);
      return;
    }

    // Update entity properties
    if (entityData.position) {
      entity.localPosition[0] = entityData.position[0];
      entity.localPosition[1] = entityData.position[1];
      entity.localPosition[2] = entityData.position[2];
    }

    if (entityData.rotation) {
      entity.localRotation[0] = entityData.rotation[0];
      entity.localRotation[1] = entityData.rotation[1];
      entity.localRotation[2] = entityData.rotation[2];
      entity.localRotation[3] = entityData.rotation[3];
    }    if (entityData.velocity) {
      entity.velocity = entityData.velocity;
    }

    console.log(`Updated remote player entity: ${playerId}`);
  }
}
