import { Net } from './Net.js';
import { NetworkMessage, MessageType, FullGameStateMessage, PeerId, NetworkId, createPeerId, createNetworkId } from './types/index.js';
import { Entity } from './Entity.js';
import { PlayerController, LocalPlayerController, RemotePlayerController } from './PlayerController.js';
import { createPlayer } from './EntityFactory.js';

/**
 * Unified game manager that handles both single-player and multiplayer scenarios
 * Replaces both MultiplayerManager and PlayerManager with a cleaner architecture
 */
export class GameManager {
  // Game state
  private gameMode: 'single-player' | 'multiplayer' = 'single-player';
  private isHost: boolean = false;
  private playerId: string = '';
  private gameId: string = '';
  
  // Player management
  private controllers: Map<string, PlayerController> = new Map();
  private localController: LocalPlayerController | null = null;
  
  // Multiplayer-specific state
  private peerToNetworkIdMap: Map<PeerId, NetworkId> = new Map();
  private nextNetworkId: number = 1;
  private net: Net;
  
  // Timing for entity updates
  private lastEntityUpdate: number = 0;
  private entityUpdateInterval: number = 1000 / 20; // 20 FPS

  constructor(net: Net) {
    this.net = net;
    this.setupNetworkHandlers();
    
    // Start with single-player game on initialization
    this.createSinglePlayerGame();
  }

  // ========================================
  // GAME LIFECYCLE METHODS
  // ========================================

  /**
   * Create initial single-player game when app launches
   */
  private createSinglePlayerGame(): void {
    console.log('🎮 GAME MANAGER: Creating single-player game');
    
    this.gameMode = 'single-player';
    this.isHost = false;
    this.playerId = this.generatePlayerId();
    this.gameId = '';
    
    // Create local player for single-player
    const { controller, entity } = this.createLocalPlayer(this.playerId);
    
    console.log(`✅ Single-player game created with player: ${this.playerId}`);
  }

  /**
   * Create a new multiplayer game as host
   * This deletes the existing single-player game and creates a fresh multiplayer game
   */
  async createMultiplayerGame(): Promise<string> {
    console.log('🏗️ GAME MANAGER: Creating multiplayer game as host');
    
    // Clean up single-player game
    this.cleanupCurrentGame();
    
    // Set up multiplayer state
    this.gameMode = 'multiplayer';
    this.isHost = true;
    this.gameId = this.generateGameId();
    this.playerId = this.generatePlayerId();
    this.nextNetworkId = 1;
    
    // Host gets the first network ID
    const hostNetworkId = this.nextNetworkId++;
    console.log(`🆔 HOST: Assigned network ID ${hostNetworkId} to host`);
    
    // Create new multiplayer local player with the assigned network ID
    const { controller, entity } = this.createLocalPlayer(this.playerId, hostNetworkId.toString());
    
    console.log(`✅ Multiplayer game created - ID: ${this.gameId}, Host: ${this.playerId}`);
    console.log(`🎮 HOST: Created player entity with ID: ${entity.id}, Network ID: ${hostNetworkId}`);
    console.log(`📊 HOST: Total entities after creation: ${Entity.all.length}`);
    
    try {
      const offer = await this.net.createOffer();
      console.log(`✅ WebRTC offer created`);
      return this.gameId;
    } catch (error: any) {
      console.error('Failed to create multiplayer game:', error);
      // Fallback to single-player on error
      this.createSinglePlayerGame();
      throw error;
    }
  }

  /**
   * Join an existing multiplayer game as client
   * This deletes the existing single-player game and prepares for multiplayer
   */
  async joinMultiplayerGame(gameId: string): Promise<void> {
    console.log(`🔗 GAME MANAGER: Preparing to join multiplayer game: ${gameId}`);
    
    // Note: We DON'T clean up the single-player game yet!
    // We wait until the connection is established and we receive the full game state
    
    // Set multiplayer state but keep existing game running
    this.gameMode = 'multiplayer';
    this.isHost = false;
    this.gameId = gameId;
    this.playerId = this.generatePlayerId();
    
    console.log(`✅ Prepared to join game: ${gameId} as ${this.playerId}`);
    console.log(`🎮 Keeping single-player game active until connection established`);
    
    // The actual game transition happens in handleGameState() when we receive the full game state
  }

  /**
   * Called when multiplayer connection is fully established and game state received
   * This replaces the single-player game with the multiplayer game state
   */
  private transitionToMultiplayerGame(gameStateData: any): void {
    console.log('🔄 GAME MANAGER: Transitioning from single-player to multiplayer');
    
    // Now we can safely clean up the single-player game
    this.cleanupCurrentGame();
    
    // Load the multiplayer game state
    this.loadGameState(gameStateData);
    
    console.log('✅ Successfully transitioned to multiplayer game');
  }

  /**
   * Clean up the current game (removes all entities and controllers)
   */
  private cleanupCurrentGame(): void {
    console.log(`🗑️ GAME MANAGER: Cleaning up current ${this.gameMode} game`);
    
    // Remove all entities
    const entityCount = Entity.all.length;
    Entity.clearAllEntities();
    
    // Clear all controllers
    this.controllers.clear();
    this.localController = null;
    
    // Clear multiplayer state
    this.peerToNetworkIdMap.clear();
    
    console.log(`✅ Cleaned up ${entityCount} entities and ${this.controllers.size} controllers`);
  }

  // ========================================
  // NETWORK HANDLERS
  // ========================================

  private setupNetworkHandlers(): void {
    this.net.onMessage((message: NetworkMessage, senderId: string) => {
      // Only handle network messages in multiplayer mode
      if (this.gameMode !== 'multiplayer') {
        return;
      }

      switch (message.type) {
        case MessageType.PLAYER_LEAVE:
          this.handlePlayerLeave(message);
          break;
        case MessageType.ENTITY_UPDATE:
          this.handleEntityUpdate(message, senderId);
          break;
        case MessageType.FULL_GAME_STATE:
          this.handleGameState(message);
          break;
        case MessageType.PLAYER_INPUT:
          this.handlePlayerInput(message);
          break;
        case MessageType.CHAT:
          // Chat messages are handled by Net.handleIncomingMessage
          break;
        default:
          console.warn('Unknown message type:', message.type.toString());
      }
    });

    this.net.onDataChannelReady((peerIdString: string) => {
      console.log(`📡 DATA CHANNEL READY: ${peerIdString}`);
      
      if (this.gameMode !== 'multiplayer') {
        console.log('📡 Ignoring data channel ready - not in multiplayer mode');
        return;
      }
      
      const peerId = createPeerId(peerIdString);
      
      if (this.isHost) {
        // HOST: Create network ID mapping and send game state
        if (!this.peerToNetworkIdMap.has(peerId)) {
          const networkId = createNetworkId(this.nextNetworkId++);
          this.peerToNetworkIdMap.set(peerId, networkId);
          console.log(`🆔 HOST: Created mapping: peer ${peerId} → network ID ${networkId}`);
          
          // Create remote player for this peer
          this.createRemotePlayer(networkId.toString());
        }
        
        console.log(`📤 HOST: Sending full game state to ${peerId}`);
        this.sendFullGameStateToPlayer(peerId);
      } else {
        // CLIENT: Wait for game state from host
        console.log(`📥 CLIENT: Data channel ready, waiting for game state from host`);
      }
    });

    this.net.onPlayerLeave((playerId: string) => {
      if (this.gameMode === 'multiplayer') {
        console.log('Player disconnected:', playerId);
        this.removePlayer(playerId);
      }
    });
  }

  private handleGameState(message: NetworkMessage): void {
    if (this.isHost) {
      console.warn('Host received full game state message - ignoring');
      return;
    }

    console.log('🔄 CLIENT: Received full game state from host');
    
    const fullStateMessage = message as FullGameStateMessage;
    const { entities, hostId, peerMappings } = fullStateMessage.data;
    
    // This is where we transition from single-player to multiplayer
    this.transitionToMultiplayerGame(fullStateMessage.data);
    
    // Process peer mappings
    if (peerMappings && peerMappings.length > 0) {
      console.log(`📋 Processing ${peerMappings.length} peer mappings`);
      this.peerToNetworkIdMap.clear();
      for (const mapping of peerMappings) {
        const peerId = createPeerId(mapping.peerId);
        const networkId = createNetworkId(parseInt(mapping.networkId));
        this.peerToNetworkIdMap.set(peerId, networkId);
      }
    }
    
    // Load entities from server snapshots
    const loadedEntities = Entity.loadEntitiesFromSnapshots(entities);
    console.log(`📦 Loaded ${loadedEntities.length} entities from host`);
    
    // Mark all entities as network entities
    for (const entity of loadedEntities) {
      entity.isNetworkEntity = true;
      entity.ownerId = hostId;
    }
    
    // Create controllers for player entities
    const playerEntities = loadedEntities.filter(e => e.player !== null);
    const networkIds = Array.from(this.peerToNetworkIdMap.values()).map(id => id.toString());
    
    for (let i = 0; i < Math.min(playerEntities.length, networkIds.length); i++) {
      const entity = playerEntities[i];
      const networkId = networkIds[i];
      
      if (!this.controllers.has(networkId)) {
        const controller = new RemotePlayerController(networkId);
        controller.setPlayerEntity(entity);
        this.controllers.set(networkId, controller);
        console.log(`🎮 CLIENT: Created remote controller for network ID ${networkId}`);
      }
    }
    
    console.log(`✅ Multiplayer game state loaded with ${Entity.all.length} entities`);
  }

  private handlePlayerLeave(message: NetworkMessage): void {
    const { playerId } = message.data;
    console.log('Player left:', playerId);
    this.removePlayer(playerId);
  }

  private handleEntityUpdate(message: NetworkMessage, senderId?: string): void {
    const { entities } = message.data;
    
    if (!entities || !Array.isArray(entities)) {
      console.warn('Received entity update without entities array');
      return;
    }
    
    for (const entityData of entities) {
      if (entityData.entityType === 'player') {
        this.updateRemotePlayerEntity(entityData, senderId);
      } else {
        this.updateOrCreateNonPlayerEntity(entityData);
      }
    }
  }

  private handlePlayerInput(message: NetworkMessage): void {
    const { playerId, input, timestamp } = message.data;
    
    const controller = this.controllers.get(playerId);
    if (controller && controller instanceof RemotePlayerController) {
      controller.applyNetworkUpdate({ input, timestamp });
    }
  }

  // ========================================
  // PLAYER MANAGEMENT
  // ========================================

  /**
   * Create the local player controller and entity
   */
  private createLocalPlayer(playerId: string, networkId?: string): { controller: LocalPlayerController, entity: Entity } {
    if (this.localController) {
      console.warn(`Local player already exists`);
      return {
        controller: this.localController,
        entity: this.localController.getPlayerEntity()!
      };
    }
    
    // Create local controller
    this.localController = new LocalPlayerController(playerId);
    this.controllers.set(playerId, this.localController);
    
    // Determine network ID for local player
    const finalNetworkId = networkId || (this.isHost ? (this.nextNetworkId++).toString() : playerId);
    
    console.log(`🆔 Creating local player: mode=${this.gameMode}, isHost=${this.isHost}, playerId=${playerId}, networkId=${finalNetworkId}`);
    
    // Create local player entity using factory
    const entity = createPlayer(true, finalNetworkId);
    
    // Connect controller to entity
    this.localController.setPlayerEntity(entity);
    
    console.log(`✅ Created local player: ${playerId} (Entity ID: ${entity.id})`);
    
    return { controller: this.localController, entity };
  }

  /**
   * Create a remote player controller and entity
   */
  private createRemotePlayer(playerId: string): { controller: RemotePlayerController, entity: Entity } {
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
    
    // Create remote player entity using factory
    const entity = createPlayer(false, playerId);
    
    // Connect controller to entity
    controller.setPlayerEntity(entity);
    
    console.log(`✅ Created remote player: ${playerId} (Entity ID: ${entity.id})`);
    
    return { controller, entity };
  }

  /**
   * Remove a player (usually when they disconnect)
   */
  private removePlayer(playerId: string): void {
    const controller = this.controllers.get(playerId);
    if (!controller) return;
    
    const entity = controller.getPlayerEntity();
    if (entity) {
      const index = Entity.all.indexOf(entity);
      if (index !== -1) {
        Entity.all.splice(index, 1);
      }
    }
    
    this.controllers.delete(playerId);
    
    if (controller === this.localController) {
      this.localController = null;
    }
    
    console.log(`Removed player: ${playerId}`);
  }

  // ========================================
  // PUBLIC API
  // ========================================

  /**
   * Get the current game mode
   */
  getGameMode(): 'single-player' | 'multiplayer' {
    return this.gameMode;
  }

  /**
   * Check if this is a multiplayer host
   */
  isMultiplayerHost(): boolean {
    return this.gameMode === 'multiplayer' && this.isHost;
  }

  /**
   * Check if connected to multiplayer
   */
  isMultiplayerConnected(): boolean {
    return this.gameMode === 'multiplayer' && this.net.isConnectionActive();
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
  getLocalPlayerEntity(): Entity | null {
    return this.localController?.getPlayerEntity() || null;
  }

  /**
   * Get the current player ID
   */
  getPlayerId(): string {
    return this.playerId;
  }

  /**
   * Update all game systems
   */
  update(deltaTime: number): void {
    // Update all player controllers
    for (const controller of this.controllers.values()) {
      controller.update(deltaTime);
    }

    // Handle multiplayer networking
    if (this.gameMode === 'multiplayer') {
      this.sendLocalPlayerUpdate();
      
      if (this.isHost) {
        this.sendEntityUpdates();
      }
    }
  }

  /**
   * Get debug information about the current game state
   */
  getDebugInfo(): any {
    return {
      gameMode: this.gameMode,
      isHost: this.isHost,
      gameId: this.gameId,
      playerId: this.playerId,
      isConnected: this.net.isConnectionActive(),
      entityCount: Entity.all.length,
      controllerCount: this.controllers.size,
      localController: this.localController?.getPlayerId() || null,
      playerEntities: Entity.findAllPlayerEntities().map(e => ({
        id: e.id,
        name: e.player?.playerName,
        isLocal: e.player?.isLocalPlayer
      }))
    };
  }

  /**
   * Disconnect from multiplayer and return to single-player
   */
  disconnectAndReturnToSinglePlayer(): void {
    if (this.gameMode === 'multiplayer') {
      console.log('🔌 GAME MANAGER: Disconnecting from multiplayer');
      
      this.net.disconnect();
      this.cleanupCurrentGame();
      this.createSinglePlayerGame();
      
      console.log('✅ Returned to single-player mode');
    }
  }

  // ========================================
  // PRIVATE HELPER METHODS
  // ========================================

  private generateGameId(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  private generatePlayerId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private loadGameState(gameStateData: any): void {
    // This method handles loading the game state from multiplayer host
    // Implementation depends on the specific game state format
    console.log('Loading game state from host...');
  }

  private sendLocalPlayerUpdate(): void {
    const now = Date.now();
    if (now - this.lastEntityUpdate < this.entityUpdateInterval) {
      return;
    }
    
    const localEntity = this.getLocalPlayerEntity();
    if (!localEntity || !this.net.isConnectionActive()) {
      return;
    }

    const update = {
      id: localEntity.id,
      position: [localEntity.localPosition[0], localEntity.localPosition[1], localEntity.localPosition[2]],
      rotation: [localEntity.localRotation[0], localEntity.localRotation[1], localEntity.localRotation[2], localEntity.localRotation[3]],
      velocity: localEntity.velocity,
      entityType: 'player'
    };

    this.net.sendMessage({
      type: MessageType.ENTITY_UPDATE,
      priority: 1,
      timestamp: Date.now(),
      sequenceNumber: 0,
      data: { entities: [update] }
    });

    this.lastEntityUpdate = now;
  }

  private sendEntityUpdates(): void {
    const connectedPeers = this.net.getConnectedPeerIds();
    if (connectedPeers.length === 0) return;

    for (const peerIdString of connectedPeers) {
      this.sendEntityUpdatesToClient(peerIdString);
    }
  }

  private sendEntityUpdatesToClient(peerIdString: string): void {
    const peerId = createPeerId(peerIdString);
    const clientNetworkId = this.peerToNetworkIdMap.get(peerId);
    
    const updates = Entity.all
      .filter(entity => {
        // Don't send player entity back to itself
        if (entity.player) {
          const entityController = Array.from(this.controllers.entries()).find(([_, controller]) => 
            controller.getPlayerEntity() === entity
          );
          
          if (entityController) {
            const entityNetworkId = entityController[0];
            return entityNetworkId !== clientNetworkId?.toString();
          }
        }
        return true;
      })
      .map(entity => ({
        id: entity.id,
        position: [entity.localPosition[0], entity.localPosition[1], entity.localPosition[2]],
        rotation: [entity.localRotation[0], entity.localRotation[1], entity.localRotation[2], entity.localRotation[3]],
        velocity: entity.velocity,
        modelId: entity.modelId,
        frame: entity.frame,
        entityType: entity.player ? 'player' : 'entity'
      }));

    if (updates.length > 0) {
      this.net.sendMessageToPlayer(peerId, {
        type: MessageType.ENTITY_UPDATE,
        priority: 2,
        timestamp: Date.now(),
        sequenceNumber: 0,
        data: { entities: updates }
      });
    }
  }

  private sendFullGameStateToPlayer(peerId: PeerId): void {
    if (!this.isHost) {
      console.warn('Only host can send full game state');
      return;
    }

    const entitySnapshots = Entity.all.map(entity => entity.serialize());
    
    const peerMappings = Array.from(this.peerToNetworkIdMap.entries()).map(([pId, nId]) => ({
      peerId: pId.toString(),
      networkId: nId.toString()
    }));

    const message: FullGameStateMessage = {
      type: MessageType.FULL_GAME_STATE,
      priority: 1,
      timestamp: Date.now(),
      sequenceNumber: 0,
      data: {
        entities: entitySnapshots,
        gameTime: Date.now(),
        hostId: this.playerId,
        peerMappings: peerMappings
      }
    };

    console.log(`📤 Sending full game state with ${entitySnapshots.length} entities to ${peerId}`);
    this.net.sendMessageToPlayer(peerId, message);
  }

  private updateRemotePlayerEntity(entityData: any, senderId?: string): void {
    if (this.isHost) {
      // Host: Find player by sender peer ID
      if (!senderId) {
        console.warn('Host received player update without sender ID');
        return;
      }
      
      const peerId = createPeerId(senderId);
      const networkId = this.peerToNetworkIdMap.get(peerId);
      
      if (!networkId) {
        console.warn(`Host: No network ID mapping for peer ${senderId} - ignoring update`);
        return;
      }
      
      // Find entity by network ID using our controller mapping
      const entity = this.findPlayerEntityByNetworkId(networkId.toString());
      
      if (!entity) {
        console.warn(`Host: No entity found for network ID ${networkId} - ignoring update`);
        return;
      }
      
      // Update the entity
      this.updateEntityFromEntityData(entity, entityData);
      
    } else {
      // Client: Update by network ID (from host)
      const networkId = entityData.networkPlayerId;
      if (!networkId) {
        console.warn('Client received entity update without networkPlayerId');
        return;
      }
      
      // Find entity by network ID using our controller mapping
      const entity = this.findPlayerEntityByNetworkId(networkId);
      
      if (!entity) {
        console.warn(`Client: No entity found for network ID ${networkId} - ignoring update`);
        return;
      }
      
      // Update the entity
      this.updateEntityFromEntityData(entity, entityData);
    }
  }

  private updateOrCreateNonPlayerEntity(entityData: any): void {
    let entity = Entity.all.find(e => e.id === entityData.id);
    
    if (entity) {
      this.updateEntityFromNetworkData(entity, entityData);
    } else {
      entity = new Entity();
      const index = Entity.all.indexOf(entity);
      Entity.all.splice(index, 1);
      entity.id = entityData.id;
      Entity.all.push(entity);
      
      if (entity.id >= Entity.nextId) {
        Entity.nextId = entity.id + 1;
      }
      
      entity.isNetworkEntity = true;
      this.updateEntityFromNetworkData(entity, entityData);
    }
  }

  private updateEntityFromNetworkData(entity: Entity, entityData: any): void {
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
    }
    if (entityData.velocity) {
      entity.velocity[0] = entityData.velocity[0];
      entity.velocity[1] = entityData.velocity[1];
      entity.velocity[2] = entityData.velocity[2];
    }
    if (entityData.modelId !== undefined) {
      entity.modelId = entityData.modelId;
    }
    if (entityData.frame !== undefined) {
      entity.frame = entityData.frame;
    }
    entity.dirty = true;
  }

  private updateEntityFromEntityData(entity: Entity, entityData: any): void {
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
    }

    if (entityData.velocity) {
      entity.velocity[0] = entityData.velocity[0];
      entity.velocity[1] = entityData.velocity[1];
      entity.velocity[2] = entityData.velocity[2];
    }
    
    entity.dirty = true;
  }

  private findPlayerEntityByNetworkId(networkId: string): Entity | null {
    const controller = this.controllers.get(networkId);
    return controller ? controller.getPlayerEntity() : null;
  }

  // ========================================
  // LEGACY METHODS FOR BACKWARD COMPATIBILITY
  // ========================================

  /**
   * Legacy method for backward compatibility
   */
  initializeLocalPlayer(): void {
    // This is handled automatically in createSinglePlayerGame()
    console.log('initializeLocalPlayer() called - handled automatically by GameManager');
  }

  /**
   * Legacy method for backward compatibility
   */
  async createGame(): Promise<string> {
    return this.createMultiplayerGame();
  }

  /**
   * Legacy method for backward compatibility
   */
  async joinGame(gameId: string): Promise<void> {
    return this.joinMultiplayerGame(gameId);
  }
}
