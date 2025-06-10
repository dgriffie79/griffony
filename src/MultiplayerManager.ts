import { Net } from './Net.js';
import { NetworkMessage, MessageType, FullGameStateMessage } from './types/index.js';
import { Entity } from './Entity.js';
import { PlayerController, LocalPlayerController, RemotePlayerController } from './PlayerController.js';
import { PlayerEntity } from './PlayerEntity.js';
import { Player } from './Player.js';

export class MultiplayerManager {
  public isHost: boolean = false;
  public playerId: string = '';
  public gameId: string = '';  
  // Player management
  private controllers: Map<string, PlayerController> = new Map();
  private localController: LocalPlayerController | null = null;
  
  // Network management
  private net: Net;
  
  // Timing for entity updates
  private lastEntityUpdate: number = 0;
  private entityUpdateInterval: number = 1000 / 20; // 20 FPS for entity updates

  constructor(net: Net) {
    this.net = net;
    this.setupNetworkHandlers();
  }
  private getMessageTypeName(type: number): string {
    const typeNames: { [key: number]: string } = {
      [MessageType.PLAYER_JOIN]: 'PLAYER_JOIN',
      [MessageType.PLAYER_LEAVE]: 'PLAYER_LEAVE',
      [MessageType.ENTITY_UPDATE]: 'ENTITY_UPDATE',
      [MessageType.FULL_GAME_STATE]: 'FULL_GAME_STATE',
      [MessageType.PLAYER_INPUT]: 'PLAYER_INPUT',
      [MessageType.GAME_STATE_REQUEST]: 'GAME_STATE_REQUEST',
      [MessageType.GAME_STATE_RESPONSE]: 'GAME_STATE_RESPONSE'
    };
    return typeNames[type] || 'UNKNOWN';
  }

  private setupNetworkHandlers(): void {    this.net.onMessage((message: NetworkMessage) => {
      console.log(`Received message type: ${message.type} (${this.getMessageTypeName(message.type)})`);
        switch (message.type) {
        case MessageType.PLAYER_LEAVE:
          this.handlePlayerLeave(message);
          break;
        case MessageType.ENTITY_UPDATE:
          this.handleEntityUpdate(message);
          break;        case MessageType.FULL_GAME_STATE:
          console.log(`📨 RECEIVED FULL_GAME_STATE message - calling handleGameState`);
          this.handleGameState(message);
          break;
        case MessageType.PLAYER_INPUT:
          this.handlePlayerInput(message);
          break;
        default:
          console.warn('Unknown message type:', message.type.toString());
      }
    });    this.net.onPlayerJoin((playerId: string) => {
      console.log(`🔗 NET CALLBACK: Player connected: ${playerId}`);
      console.log(`🏠 NET CALLBACK: isHost: ${this.isHost}`);
      
      // Create remote player controller and entity
      this.createRemotePlayer(playerId);
      
      // Note: We will send game state when data channel is ready (onDataChannelReady callback)
      if (this.isHost) {
        console.log(`📤 NET CALLBACK: Host will send full game state when data channel is ready`);
      } else {
        console.log(`📥 NET CALLBACK: Client - not sending game state`);
      }
    });

    // New callback: Send game state when data channel is ready
    this.net.onDataChannelReady((peerId: string) => {
      if (this.isHost) {        console.log(`📤 DATA CHANNEL READY: Sending full game state to ${peerId}`);
        try {
          this.net.sendFullGameStateToPlayer(peerId);
          console.log(`✅ DATA CHANNEL READY: Successfully called sendFullGameStateToPlayer`);
        } catch (error) {
          console.error(`❌ DATA CHANNEL READY: Error calling sendFullGameStateToPlayer:`, error);
        }
      }
    });    this.net.onPlayerLeave((playerId: string) => {
      console.log('Player disconnected:', playerId);
      // Remove the player using unified management
      this.removePlayer(playerId);
    });
  }  async createGame(): Promise<string> {
    console.log(`🏗️ Creating game - setting isHost = true`);
    this.isHost = true;
    this.gameId = this.generateGameId();
    this.playerId = this.generatePlayerId();
    
    console.log(`📋 Game created - ID: ${this.gameId}, playerId: ${this.playerId}, isHost: ${this.isHost}`);
    
    try {
      const offer = await this.net.createOffer();
      console.log(`✅ Net.createOffer() completed`);
      return this.gameId;
    } catch (error: any) {
      console.error('Failed to create game:', error);
      throw error;
    }
  }  async joinGame(gameId: string): Promise<void> {
    this.isHost = false;
    this.gameId = gameId;
    this.playerId = this.generatePlayerId();
    
    console.log('Joining game with ID:', gameId);
    
    // This would be used with the manual signaling UI
    // The actual connection is established through createAnswer/processAnswer
  }
  /**
   * Initialize the local player
   */
  initializeLocalPlayer(): void {
    if (!this.playerId) {
      this.playerId = this.generatePlayerId();
    }
      const { controller, entity } = this.createLocalPlayer(this.playerId);
    
    console.log(`Initialized local player: ${this.playerId}`);
  }

  private generateGameId(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  private generatePlayerId(): string {
    return Math.random().toString(36).substring(2, 15);  }  private handlePlayerLeave(message: NetworkMessage): void {
    const { playerId } = message.data;
    console.log('Player left:', playerId);    
    // Remove player using our integrated player management
    this.removePlayer(playerId);
  }
  private handleEntityUpdate(message: NetworkMessage): void {
    const { entities } = message.data;
    
    console.log('Received entity update:', { entities });
    
    if (!entities || !Array.isArray(entities)) {
      console.warn('Received entity update without entities array');
      return;
    }
    
    for (const entityData of entities) {
      console.log(`Processing entity update: ${entityData.entityType} - ${entityData.networkPlayerId || entityData.id}`);
      
      if (entityData.entityType === 'player') {
        // Handle player entity updates
        this.updateRemotePlayerEntity(entityData);
      } else {
        // Handle non-player entity updates
        this.updateOrCreateNonPlayerEntity(entityData);
      }
    }
  }  private handleGameState(message: NetworkMessage): void {
    if (this.isHost) {
      // Hosts shouldn't receive full game state
      console.warn('Host received full game state message - ignoring');
      return;
    }
    
    try {
      // Cast to FullGameStateMessage to get proper typing
      const fullStateMessage = message as FullGameStateMessage;
      const { entities, playerPosition, playerRotation, hostId } = fullStateMessage.data;
      
      console.log(`🔄 HANDLING FULL GAME STATE with ${entities.length} entities from host ${hostId}`);
      
      // Clear all current entities
      console.log(`🗑️ Clearing all client entities (currently have ${Entity.all.length})`);
      this.clearClientEntities();
      console.log(`✅ After clearing, have ${Entity.all.length} entities`);
      
      // Load entities from server snapshots
      const loadedEntities = Entity.loadEntitiesFromSnapshots(entities);
      console.log(`📦 Loaded ${loadedEntities.length} entities from snapshots`);
      
      // Mark all loaded entities as network entities
      for (const entity of loadedEntities) {
        entity.isNetworkEntity = true;
        entity.ownerId = hostId;
      }
      
      console.log(`✅ Final entity count: ${Entity.all.length}`);
      
      // Update player position if provided
      if (playerPosition && (globalThis as any).gameState) {
        const gameState = (globalThis as any).gameState;
        gameState.playerPos = playerPosition;
        if (playerRotation) {
          gameState.playerOrientation = playerRotation;
        }
        console.log('📍 Updated player position from server');
      }
      
    } catch (error) {
      console.error(`Failed to process full game state: ${error}`);
    }
  }
  private handlePlayerInput(message: NetworkMessage): void {
    const { playerId, input, timestamp } = message.data;
    
    // Apply input to remote player controller
    const controller = this.controllers.get(playerId);
    if (controller && controller instanceof RemotePlayerController) {
      // Remote controllers can apply network input updates
      controller.applyNetworkUpdate({ input, timestamp });
    }
  }
  /**
   * Create the local player controller and entity
   */  createLocalPlayer(playerId: string): { controller: LocalPlayerController, entity: PlayerEntity } {
    if (this.localController) {
      console.warn(`Local player already exists`);
      return {
        controller: this.localController,
        entity: this.localController.getPlayerEntity()!
      };
    }
    
    // Create local controller
    this.localController = new LocalPlayerController(playerId);    this.controllers.set(playerId, this.localController);    // Create local player entity
    const entity = PlayerEntity.createPlayerEntity(playerId, true);
    
    // Entity is automatically added to Entity.all by createPlayerEntity
    
    // Connect controller to entity
    this.localController.setPlayerEntity(entity);
    
    console.log(`Created local player: ${playerId} (Entity ID: ${entity.id})`);
    
    return { controller: this.localController, entity };
  }
    /**
   * Create a remote player controller and entity
   */  createRemotePlayer(playerId: string, playerData?: any): { controller: RemotePlayerController, entity: PlayerEntity } {
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
    this.controllers.set(playerId, controller);
      // Create remote player entity
    const entity = PlayerEntity.createPlayerEntity(playerId, false);
    
    // Entity is automatically added to Entity.all by createPlayerEntity
    
    // Connect controller to entity
    controller.setPlayerEntity(entity);
    
    console.log(`Created remote player: ${playerId} (Entity ID: ${entity.id})`);
    
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
      // Entity is automatically removed from Entity.all when removed from the world above
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
   * Get the local player controller
   */
  getLocalPlayer(): LocalPlayerController | null {
    return this.localController;
  }
  
  /**
   * Get the local player entity
   */
  getLocalPlayerEntity(): PlayerEntity | null {
    return this.localController?.getPlayerEntity() || null;
  }
  
  /**
   * Clear all entities - used for full game state sync where server sends everything
   */  private clearClientEntities(): void {
    console.log(`🗑️ CLEARING ALL ENTITIES - had ${Entity.all.length} entities`);
    Entity.clearAllEntities();
    
    // Also clear all controller references since entities will be recreated
    this.controllers.clear();
    this.localController = null;
    
    console.log(`✅ CLEARED - now have ${Entity.all.length} entities`);
  }

  /**
   * Clear all non-local entities from Entity.all
   * This is used when receiving a full game state to avoid duplicates
   */
  private clearNonLocalEntities(): void {
    const localEntity = this.getLocalPlayerEntity();
    const localEntityId = localEntity?.id;
    
    // Find entities to remove (all except local player and its children)
    const entitiesToRemove: Entity[] = [];
    
    for (const entity of Entity.all) {
      // Keep the local player entity and its children (like head)
      if (entity === localEntity || entity.parent === localEntity) {
        continue;
      }
      
      // Remove all other entities (remote players, NPCs, etc.)
      entitiesToRemove.push(entity);
    }
      // Remove the entities
    for (const entity of entitiesToRemove) {
      const index = Entity.all.indexOf(entity);
      if (index !== -1) {
        Entity.all.splice(index, 1);
        console.log(`Removed entity ${entity.id} (${entity.constructor.name})`);
      }
    }
    
    // Also clear remote player controllers (they will be recreated)
    const controllersToRemove: string[] = [];
    for (const [playerId, controller] of this.controllers) {
      if (controller !== this.localController) {
        controllersToRemove.push(playerId);
      }
    }
    
    for (const playerId of controllersToRemove) {
      this.controllers.delete(playerId);
      console.log(`Removed remote controller for player ${playerId}`);
    }
    
    console.log(`Cleared ${entitiesToRemove.length} non-local entities and ${controllersToRemove.length} remote controllers`);
  }
  
  /**
   * Get all player controllers
   */
  getAllPlayers(): PlayerController[] {
    return Array.from(this.controllers.values());
  }
  
  /**
   * Update all player controllers
   */
  updatePlayers(deltaTime: number): void {
    for (const controller of this.controllers.values()) {
      controller.update(deltaTime);
    }
  }  private sendGameStateToPlayer(playerId: string): void {
    const gameState = this.getGameState();
    
    console.log(`Sending full game state to player ${playerId}`, {
      entityCount: gameState.entities?.length || 0,
      playerCount: gameState.players?.length || 0
    });
    
    this.net.sendMessageToPlayer(playerId, {
      type: MessageType.FULL_GAME_STATE,
      priority: 0, // HIGH priority
      timestamp: Date.now(),
      sequenceNumber: 0,
      data: gameState
    });
  }private getGameState(): any {
    // Get all entities
    const entities = Entity.all.map(entity => ({
      id: entity.id.toString(),
      position: [entity.localPosition[0], entity.localPosition[1], entity.localPosition[2]],
      rotation: [entity.localRotation[0], entity.localRotation[1], entity.localRotation[2], entity.localRotation[3]],
      velocity: entity.velocity,
      entityType: entity instanceof PlayerEntity ? 'player' : 'entity',
      networkPlayerId: entity instanceof PlayerEntity ? entity.networkPlayerId : undefined
    }));

    // Get all player controllers (for additional player data if needed)
    const players = Array.from(this.controllers.values()).map(controller => {
      const entity = controller.getPlayerEntity();
      return {
        id: controller.getPlayerId(),
        position: entity ? [entity.localPosition[0], entity.localPosition[1], entity.localPosition[2]] : [0, 0, 0],
        rotation: entity ? [entity.localRotation[0], entity.localRotation[1], entity.localRotation[2], entity.localRotation[3]] : [0, 0, 0, 1]
      };    });

    console.log(`Game state contains ${entities.length} entities and ${players.length} players`);
    
    return { entities, players };
  }update(deltaTime: number): void {
    // Update all player controllers (includes local and remote)
    this.updatePlayers(deltaTime);

    // Send local player updates to other clients
    this.sendLocalPlayerUpdate();

    // Send all entity updates if we're the host (for game state sync)
    if (this.isHost) {
      this.sendEntityUpdates();
    }
  }private sendEntityUpdates(): void {
    // Send updates for all player entities (including local player so others can see us)
    const updates = Entity.all
      .filter(entity => entity instanceof PlayerEntity) // Only send player entities
      .map(entity => {
        const playerEntity = entity as PlayerEntity;
        return {
          id: entity.id.toString(),
          position: [entity.localPosition[0], entity.localPosition[1], entity.localPosition[2]],
          rotation: [entity.localRotation[0], entity.localRotation[1], entity.localRotation[2], entity.localRotation[3]],
          velocity: entity.velocity,
          entityType: 'player',
          networkPlayerId: playerEntity.networkPlayerId,
          playerName: playerEntity.playerName
        };
      });

    if (updates.length > 0) {
      this.net.sendMessage({
        type: MessageType.ENTITY_UPDATE,
        priority: 2, // MEDIUM priority
        timestamp: Date.now(),
        sequenceNumber: 0,
        data: { entities: updates }
      });
        console.log(`Sent updates for ${updates.length} player entities`);
    }
  }

  getEntities(): Entity[] {
    return Entity.all;
  }

  isConnected(): boolean {
    return this.net.isConnectionActive();
  }

  getConnectionInfo(): any {
    return {
      isHost: this.isHost,
      gameId: this.gameId,
      playerId: this.playerId,
      isConnected: this.net.isConnectionActive(),
      totalControllers: this.controllers.size,
      localController: this.localController ? this.localController.getPlayerId() : null
    };
  }

  disconnect(): void {
    this.net.disconnect();
  }

  /**   * Update or create a non-player entity from network data
   */
  private updateOrCreateNonPlayerEntity(entityData: any): void {
    // Find entity in Entity.all by ID
    const entity = Entity.all.find(e => e.id.toString() === entityData.id);
    if (entity) {
      // Update existing entity
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
      }    } else {
      // Create new entity (implementation depends on entity system)
      console.warn(`Cannot create non-player entity: ${entityData.id} - not implemented`);
    }
  }
  /**
   * Update a remote player entity from network data
   */  private updateRemotePlayerEntity(entityData: any): void {
    const playerId = entityData.networkPlayerId;
    if (!playerId) {
      console.warn('Received entity update without networkPlayerId');
      return;
    }

    // Don't update our local player from network
    if (playerId === this.playerId) {
      console.log('Ignoring network update for local player');
      return;
    }

    // Find the controller for this player
    let controller = this.controllers.get(playerId);
    if (!controller) {
      console.warn(`Cannot update unknown remote player: ${playerId} - creating new remote player`);
      // Create a new remote player if we don't have one
      const result = this.createRemotePlayer(playerId);
      controller = result.controller;
    }    const entity = controller.getPlayerEntity();
    if (!entity) {
      console.warn(`No entity for remote player: ${playerId}`);
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

    console.log(`Updated remote player entity: ${playerId} to position [${entityData.position?.join(', ')}]`);
  }
  /**
   * Send the local player's position/state to other clients
   */
  private sendLocalPlayerUpdate(): void {
    const now = Date.now();
    if (now - this.lastEntityUpdate < this.entityUpdateInterval) {
      return; // Throttle updates
    }
    
    const localEntity = this.getLocalPlayerEntity();
    if (!localEntity || !this.net.isConnectionActive()) {
      return;
    }

    const update = {
      id: localEntity.id.toString(),
      position: [localEntity.localPosition[0], localEntity.localPosition[1], localEntity.localPosition[2]],
      rotation: [localEntity.localRotation[0], localEntity.localRotation[1], localEntity.localRotation[2], localEntity.localRotation[3]],
      velocity: localEntity.velocity,
      entityType: 'player',
      networkPlayerId: localEntity.networkPlayerId,
      playerName: localEntity.playerName
    };

    this.net.sendMessage({
      type: MessageType.ENTITY_UPDATE,
      priority: 1, // HIGH priority for local player updates
      timestamp: Date.now(),
      sequenceNumber: 0,
      data: { entities: [update] }    });

    this.lastEntityUpdate = now;
    console.log(`Sent local player update: ${this.playerId} at position [${update.position.join(', ')}]`);
  }
  /**
   * Debug method to check entity synchronization status
   */
  debugEntitySync(): any {
    const localEntity = this.getLocalPlayerEntity();
    const allEntities = Entity.all.filter(e => e instanceof PlayerEntity);
    
    return {
      isHost: this.isHost,
      isConnected: this.net.isConnectionActive(),
      localPlayer: localEntity ? {
        id: localEntity.id,
        networkId: localEntity.networkPlayerId,
        position: [...localEntity.localPosition],
        rotation: [...localEntity.localRotation]
      } : null,
      allPlayerEntities: allEntities.map(e => {
        const pe = e as PlayerEntity;
        return {
          id: pe.id,
          networkId: pe.networkPlayerId,
          name: pe.playerName,
          position: [...pe.localPosition],
          rotation: [...pe.localRotation],
          isNetwork: pe.isNetworkEntity
        };
      }),
      controllers: Array.from(this.controllers.entries()).map(([id, controller]) => ({
        playerId: id,
        type: controller instanceof LocalPlayerController ? 'local' : 'remote',
        hasEntity: !!controller.getPlayerEntity()
      })),      entitiesArray: {
        size: Entity.all.length,
        entities: Entity.all.map((entity, index) => ({
          id: entity.id.toString(),
          index,
          type: entity.constructor.name,
          networkId: entity instanceof PlayerEntity ? entity.networkPlayerId : 'n/a',
          position: [entity.localPosition[0], entity.localPosition[1], entity.localPosition[2]]
        }))
      }
    };
  }

  /**
   * Force an entity sync for testing purposes
   */
  forceEntitySync(): void {
    // Reset throttling to allow immediate update
    this.lastEntityUpdate = 0;
      // Trigger an update manually
    this.sendLocalPlayerUpdate();
    
    if (this.isHost) {
      this.sendEntityUpdates();
    }
    
    console.log('Forced entity sync triggered');
  }
}