import { Net } from './Net.js';
import { NetworkMessage, MessageType, FullGameStateMessage, PeerId, NetworkId, createPeerId, createNetworkId, EntityUpdateData, GameStateData, GameDebugInfo } from './types/index.js';
import { Entity } from './Entity.js';
import { createPlayer } from './EntityFactory.js';

/**
 * Unified game manager that handles both single-player and multiplayer scenarios
 * Replaces both MultiplayerManager and PlayerManager with a cleaner architecture
 */
export class GameManager {
  // Game state
  private gameMode: 'single-player' | 'multiplayer' = 'single-player';
  private isHost: boolean = false;
  private gameId: string = '';
  
  // Player management - use globalThis.player directly
  
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
    
    // Single-player game will be created later after resources are loaded
  }

  // ========================================
  // GAME LIFECYCLE METHODS
  // ========================================

  /**
   * Create initial single-player game when app launches
   */
  public createSinglePlayerGame(): void {
    console.log('🎮 GAME MANAGER: Creating single-player game');
    
    this.gameMode = 'single-player';
    this.isHost = false;
    this.gameId = '';
    
    // Create local player for single-player (network ID 1 for single-player)
    globalThis.player = this.createLocalPlayer("1");
    
    console.log(`✅ Single-player game created`);
  }

  /**
   * Create a new multiplayer game as host (legacy method for ManualSignalingUI compatibility)
   * The actual multiplayer transition now happens in the data channel callback
   */
  async createMultiplayerGame(): Promise<string> {
    console.log('🏗️ GAME MANAGER: Legacy createMultiplayerGame called - actual transition happens on data channel ready');
    
    try {
      const offer = await this.net.createOffer();
      console.log(`✅ WebRTC offer created`);
      return 'PENDING'; // Game ID will be set when data channel becomes ready
    } catch (error: unknown) {
      console.error('Failed to create multiplayer game:', error);
      // Fallback to single-player on error
      this.createSinglePlayerGame();
      throw error;
    }
  }

  /**
   * Join an existing multiplayer game as client (legacy method for ManualSignalingUI compatibility)
   * The actual multiplayer transition now happens in the data channel callback
   */
  async joinMultiplayerGame(gameId: string): Promise<void> {
    console.log(`🔗 GAME MANAGER: Legacy joinMultiplayerGame called - actual transition happens on data channel ready`);
    console.log(`🎮 Keeping single-player game active until data channel established`);
    
    // The actual game transition happens in prepareForMultiplayerFromDataChannel() when data channel becomes ready
  }
  /**
   * Called when multiplayer connection is fully established and game state received
   * This replaces the single-player game with the multiplayer game state
   */
  private transitionToMultiplayerGame(gameStateData: GameStateData): void {
    console.log('🔄 GAME MANAGER: Transitioning from single-player to multiplayer');
    
    // Clear the single-player game with proper component cleanup
    this.cleanupCurrentGame();
    
    // Load the complete multiplayer game state from host
    this.loadGameState(gameStateData);
    
    console.log('✅ Successfully transitioned to multiplayer game with complete state');
  }
  /**
   * Clean up the current game (removes all entities and properly destroys components)
   */
  private cleanupCurrentGame(): void {
    console.log(`🗑️ GAME MANAGER: Cleaning up current ${this.gameMode} game`);
    
    // Properly destroy all components before clearing array (fixes ghost entities)
    const entityCount = Entity.all.length;
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
    }
    
    // Clear the entity array
    Entity.all.length = 0;
    
    // Clear global player reference
    globalThis.player = null;
    
    // Clear multiplayer state
    this.peerToNetworkIdMap.clear();
    
    console.log(`✅ Cleaned up ${entityCount} entities with proper component destruction`);
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
      
      // If we're in single-player mode, this means we need to transition to multiplayer
      if (this.gameMode === 'single-player') {
        console.log('📡 Data channel ready - transitioning from single-player to multiplayer');
        
        // We need to determine if we're host or client based on the Net connection state
        // The ManualSignalingUI should have set this up already
        const isHostFromNet = this.net.getIsHost();
        
        if (isHostFromNet) {
          // We are the host - create multiplayer game
          console.log('🏗️ HOST: Data channel ready, creating multiplayer game');
          this.createMultiplayerGameFromDataChannel()
            .then(() => {
              // After creating multiplayer game, handle the peer
              this.handleDataChannelReadyAsHost(peerIdString);
            })
            .catch((error) => {
              console.error('❌ Failed to create multiplayer game from data channel:', error);
            });
        } else {
          // We are the client - prepare for multiplayer
          console.log('🔗 CLIENT: Data channel ready, preparing for multiplayer');
          this.prepareForMultiplayerFromDataChannel()
            .then(() => {
              // After preparing for multiplayer, handle the peer
              this.handleDataChannelReadyAsClient(peerIdString);
            })
            .catch((error) => {
              console.error('❌ Failed to prepare for multiplayer from data channel:', error);
            });
        }
        return;
      }
      
      // Already in multiplayer mode, handle normally
      const peerId = createPeerId(peerIdString);
      
      if (this.isHost) {
        this.handleDataChannelReadyAsHost(peerIdString);
      } else {
        this.handleDataChannelReadyAsClient(peerIdString);
      }
    });

    this.net.onPlayerLeave((peerId: string) => {
      if (this.gameMode === 'multiplayer') {
        console.log('Player disconnected:', peerId);
        
        // Convert peerId to networkId for player removal
        const peerIdObj = createPeerId(peerId);
        const networkId = this.peerToNetworkIdMap.get(peerIdObj);
        
        if (networkId) {
          this.removePlayer(networkId.toString());
        } else {
          console.warn(`No network ID found for disconnected peer: ${peerId}`);
        }
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
      if (!entity.network) {
        entity.addNetwork(hostId);
      } else {
        entity.network.ownerId = hostId;
      }
    }
      // Create controllers for player entities
    const playerEntities = loadedEntities.filter(e => e.player !== null);
    
    // Find our own network ID by looking for our peer ID in the mappings
    const ourPeerId = createPeerId(this.net.getPeerId());
    const ourNetworkId = this.peerToNetworkIdMap.get(ourPeerId);
    
    console.log(`🔍 CLIENT: Looking for our player entity - Our Peer ID: ${ourPeerId}, Our Network ID: ${ourNetworkId}`);
    console.log(`🔍 CLIENT: Available player entities:`, playerEntities.map(e => ({
      id: e.id,
      networkId: e.networkId,
      playerName: e.player?.playerName
    })));
      let foundOurPlayer = false;
      // First, ensure ALL player entities are marked as remote    // Note: Player local/remote status is now determined automatically by peerId comparison
    console.log(`🔧 CLIENT: Processing ${playerEntities.length} player entities from game state`);
    
    for (const entity of playerEntities) {
      // Use the networkId from the entity (which is properly deserialized from the snapshot)
      const networkId = entity.networkId;
      
      if (!networkId) {
        console.warn(`⚠️ CLIENT: Player entity ${entity.id} has no networkId - skipping`);
        continue;
      }
        // Check if this is our local player entity
      if (ourNetworkId && networkId === ourNetworkId.toString()) {        // This is our local player entity
        console.log(`🎮 CLIENT: Found our local player entity ID: ${entity.id}, Network ID: ${networkId}`);
        
        globalThis.player = entity;
        foundOurPlayer = true;
        
        // Update game resources to follow the new local player
        if (globalThis.gameResources) {
          globalThis.gameResources.setPlayer(entity);
        }
      } else {
        // This is a remote player entity
        console.log(`🤖 CLIENT: Found remote player entity ID: ${entity.id}, Network ID: ${networkId}`);
      }
    }
    
    if (!foundOurPlayer) {
      console.error(`❌ CLIENT: Could not find our player entity! Our Network ID: ${ourNetworkId}`);
      console.error(`Available network IDs:`, playerEntities.map(e => e.networkId));
    }
    
    console.log(`✅ Multiplayer game state loaded with ${Entity.all.length} entities`);
  }

  private handlePlayerLeave(message: NetworkMessage): void {
    const networkId = message.data.networkId;
    if (typeof networkId === 'string') {
      console.log('Player left:', networkId);
      this.removePlayer(networkId);
    }
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
    const { networkId, inputSequence, timestamp, keys, mouse } = message.data;
    
    if (typeof networkId !== 'string' || typeof timestamp !== 'number') {
      console.warn('Invalid player input message format');
      return;
    }

    // Find the player entity for this network ID
    const playerEntity = Entity.findAllPlayerEntities().find(e => 
      e.player && e.networkId === networkId
    );
    
    if (playerEntity?.player) {
      // Create PlayerInput object from the message data
      const defaultKeys = { forward: false, backward: false, left: false, right: false, jump: false, crouch: false, up: false, down: false };
      const defaultMouse = { deltaX: 0, deltaY: 0 };
      
      const playerInput: import('./types/index').PlayerInput = {
        keys: keys ? { ...defaultKeys, ...keys } : defaultKeys,
        mouse: mouse ? { ...defaultMouse, ...mouse } : defaultMouse
      };

      // Process input on server side (authoritative)
      playerEntity.player.processInput({ 
        input: playerInput, 
        timestamp 
      });

      // If this is the host/server, send authoritative position update to all clients
      if (this.isHost && this.net.isConnectionActive()) {
        const positionUpdate: import('./types/index').EntityUpdateData = {
          id: playerEntity.id,
          position: [playerEntity.localPosition[0], playerEntity.localPosition[1], playerEntity.localPosition[2]],
          rotation: [playerEntity.localRotation[0], playerEntity.localRotation[1], playerEntity.localRotation[2], playerEntity.localRotation[3]],
          velocity: playerEntity.physics ? [playerEntity.physics.velocity[0], playerEntity.physics.velocity[1], playerEntity.physics.velocity[2]] : [0, 0, 0],
          entityType: 'player'
        };
        // Send to all connected peers
        this.net.sendMessage({
          type: MessageType.ENTITY_UPDATE,
          priority: 1,
          timestamp: Date.now(),
          sequenceNumber: typeof inputSequence === 'number' ? inputSequence : 0,
          data: { entities: [positionUpdate] }
        });
      }
    }
  }

  // ========================================
  // PLAYER MANAGEMENT
  // ========================================
  /**
   * Create the local player entity
   */
  private createLocalPlayer(networkId: string): Entity {
    if (globalThis.player) {
      console.warn(`Local player already exists`);
      return globalThis.player;
    }
    
    console.log(`🆔 Creating local player: mode=${this.gameMode}, isHost=${this.isHost}, networkId=${networkId}`);
    
    // Create local player entity using factory with local peer ID
    const localPeerId = this.net.getPeerId();
    const entity = createPlayer(localPeerId, networkId);
    
    console.log(`✅ Created local player with network ID: ${networkId} (Entity ID: ${entity.id})`);
    
    return entity;
  }
  /**
   * Create a remote player entity
   */
  private createRemotePlayer(networkId: string): Entity {
    // Check if remote player already exists
    const existingPlayer = Entity.findAllPlayerEntities().find(e => 
      e.networkId === networkId
    );
    
    if (existingPlayer) {
      console.warn(`Remote player ${networkId} already exists`);
      return existingPlayer;
    }
    
    // Create remote player entity using factory with no peerId (remote player)
    const entity = createPlayer(undefined, networkId);
    
    console.log(`✅ Created remote player with network ID: ${networkId} (Entity ID: ${entity.id})`);
    
    return entity;
  }

  /**
   * Remove a player (usually when they disconnect)
   */
  private removePlayer(networkId: string): void {
    const entity = Entity.findAllPlayerEntities().find(e => 
      e.networkId === networkId
    );
    
    if (!entity) return;
    
    const index = Entity.all.indexOf(entity);
    if (index !== -1) {
      Entity.all.splice(index, 1);
    }
    
    if (entity === globalThis.player) {
      globalThis.player = null;
    }
    
    console.log(`Removed player: ${networkId}`);
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
   * Check if the network connection is active
   */
  isNetworkConnectionActive(): boolean {
    return this.net.isConnectionActive();
  }

  /**
   * Send a network message
   */
  sendNetworkMessage(message: NetworkMessage): void {
    this.net.sendMessage(message);
  }

  /**
   * Get the local player entity
   */  getLocalPlayerEntity(): Entity | null {
    return globalThis.player;
  }

  getLocalPlayerNetworkId(): string | null {
    const localEntity = this.getLocalPlayerEntity();
    return localEntity?.networkId || null;
  }



  /**
   * Update all game systems
   */  update(deltaTime: number): void {
    // Player components update themselves via Entity.update()
    // No need to manually update controllers anymore
    
    // Handle multiplayer networking
    if (this.gameMode === 'multiplayer') {
      // TODO: Remove this when proper input command architecture is working
      // For now, we're disabling position updates for local players
      // this.sendLocalPlayerUpdate();
      
      if (this.isHost) {
        this.sendEntityUpdates();
      }
    }
  }

  /**
   * Get debug information about the current game state
   */
  getDebugInfo(): GameDebugInfo {
    return {
      gameMode: this.gameMode,
      isHost: this.isHost,
      gameId: this.gameId,
      isConnected: this.net.isConnectionActive(),
      entityCount: Entity.all.length,
      localPlayerNetworkId: globalThis.player?.networkId || null,      playerEntities: Entity.findAllPlayerEntities().map(e => ({
        id: e.id,
        name: e.player?.playerName,
        isLocal: e.player?.isLocal(),
        networkId: e.networkId
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
  // DATA CHANNEL TRANSITION METHODS
  // ========================================
  /**
   * Create multiplayer game when data channel becomes ready (for host)
   * Uses "invite to existing game" paradigm - preserves all existing entities
   */
  private async createMultiplayerGameFromDataChannel(): Promise<void> {
    console.log('🏗️ HOST: Inviting to existing game from data channel');
    
    // DON'T clean up the existing game - preserve all entities!
    // This is the key change: "invite to existing" instead of "create new"
    
    // Set up multiplayer state
    this.gameMode = 'multiplayer';
    this.isHost = true;
    this.gameId = this.generateGameId();
    this.nextNetworkId = 1;
    
    // Host gets the first network ID
    const hostNetworkId = this.nextNetworkId++;
    console.log(`🆔 HOST: Assigned network ID ${hostNetworkId} to host`);
    
    // Update existing local player with network ID instead of creating new one
    if (globalThis.player) {
      globalThis.player.networkId = hostNetworkId.toString();
      // Add network component to existing entities
      this.addNetworkComponentsToExistingEntities();
    } else {
      // Fallback: create new player if none exists
      globalThis.player = this.createLocalPlayer(hostNetworkId.toString());
    }
    
    console.log(`✅ Multiplayer game created from data channel - ID: ${this.gameId}`);
    console.log(`🎮 HOST: Created player entity with ID: ${globalThis.player.id}, Network ID: ${hostNetworkId}`);
    console.log(`📊 HOST: Total entities after creation: ${Entity.all.length}`);
  }

  /**
   * Prepare for multiplayer when data channel becomes ready (for client)
   */
  private async prepareForMultiplayerFromDataChannel(): Promise<void> {
    console.log('🔗 CLIENT: Preparing for multiplayer from data channel');
    
    // Note: We DON'T clean up the single-player game yet!
    // We wait until the connection is established and we receive the full game state
    
    // Set multiplayer state but keep existing game running
    this.gameMode = 'multiplayer';
    this.isHost = false;
    this.gameId = 'incoming_game'; // Will be updated when we receive game state
    
    console.log('✅ CLIENT: Prepared for multiplayer from data channel');
    console.log('🎮 CLIENT: Keeping single-player game active until connection established');
  }
  /**
   * Handle data channel ready as host (after multiplayer game is created)
   */
  private handleDataChannelReadyAsHost(peerIdString: string): void {
    const peerId = createPeerId(peerIdString);
    
    // HOST: Create network ID mapping and send game state
    if (!this.peerToNetworkIdMap.has(peerId)) {
      const networkId = createNetworkId(this.nextNetworkId++);
      this.peerToNetworkIdMap.set(peerId, networkId);
      console.log(`🆔 HOST: Created mapping: peer ${peerId} → network ID ${networkId}`);
      
      // Create remote player for this peer at a spawn point
      const remotePlayer = this.createRemotePlayer(networkId.toString());
      
      // Position the remote player at a spawn point
      this.positionPlayerAtSpawn(remotePlayer);
    }
    
    console.log(`📤 HOST: Sending full game state to ${peerId}`);
    this.sendFullGameStateToPlayer(peerId);
  }

  /**
   * Handle data channel ready as client (after preparing for multiplayer)
   */
  private handleDataChannelReadyAsClient(peerIdString: string): void {
    // CLIENT: Wait for game state from host
    console.log(`📥 CLIENT: Data channel ready, waiting for game state from host`);
  }

  /**
   * Position a player entity at a spawn point
   */
  private positionPlayerAtSpawn(playerEntity: Entity): void {
    // Find spawn points
    const spawnPoints = Entity.all.filter(e => e.spawn);
    
    if (spawnPoints.length > 0) {
      // Use a random spawn point
      const spawnPoint = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
      playerEntity.localPosition[0] = spawnPoint.localPosition[0];
      playerEntity.localPosition[1] = spawnPoint.localPosition[1];
      playerEntity.localPosition[2] = spawnPoint.localPosition[2];
      console.log(`🎯 Positioned player ${playerEntity.networkId} at spawn point (${spawnPoint.localPosition[0]}, ${spawnPoint.localPosition[1]}, ${spawnPoint.localPosition[2]})`);
    } else {
      // Fallback position if no spawn points
      playerEntity.localPosition[0] = 0;
      playerEntity.localPosition[1] = 0;
      playerEntity.localPosition[2] = 2;
      console.log(`🎯 Positioned player ${playerEntity.networkId} at fallback position (0, 0, 2)`);
    }
    
    playerEntity.dirty = true;
  }

  // ========================================
  // PRIVATE HELPER METHODS
  // ========================================

  private generateGameId(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  private loadGameState(gameStateData: GameStateData): void {
    console.log('📦 Loading complete game state from host...');
    
    const { entities } = gameStateData;
    
    // Load ALL entities from server snapshots
    const loadedEntities = Entity.loadEntitiesFromSnapshots(entities);
    console.log(`📦 Loaded ${loadedEntities.length} entities from host`);
      // Mark all entities as network entities
    for (const entity of loadedEntities) {
      if (!entity.network) {
        entity.addNetwork("host");
      } else {
        entity.network.ownerId = "host";
      }
    }
    
    // Find our local player entity and set up camera/resources
    const ourPeerId = createPeerId(this.net.getPeerId());
    const ourNetworkId = this.peerToNetworkIdMap.get(ourPeerId);
    
    if (ourNetworkId) {
      const playerEntity = loadedEntities.find(e => 
        e.player && e.networkId === ourNetworkId.toString()
      );
        if (playerEntity) {
        globalThis.player = playerEntity;
        
        // Update game resources
        if (globalThis.gameResources) {
          globalThis.gameResources.setPlayer(playerEntity);
        }
        
        console.log(`🎮 Set up local player entity ID: ${playerEntity.id}`);
      }
    }
    
    console.log(`✅ Game state loaded - Total entities: ${Entity.all.length}`);
    console.log(`📊 Entity breakdown:`, {
      players: Entity.all.filter(e => e.player).length,
      spawns: Entity.all.filter(e => e.spawn).length,
      others: Entity.all.filter(e => !e.player && !e.spawn).length
    });
  }

  private sendLocalPlayerUpdate(): void {
    const now = Date.now();
    if (now - this.lastEntityUpdate < this.entityUpdateInterval) {
      return;
    }
    
    const localEntity = this.getLocalPlayerEntity();
    if (!localEntity || !this.net.isConnectionActive()) {
      return;
    }    const update: EntityUpdateData = {
      id: localEntity.id,
      position: [localEntity.localPosition[0], localEntity.localPosition[1], localEntity.localPosition[2]],
      rotation: [localEntity.localRotation[0], localEntity.localRotation[1], localEntity.localRotation[2], localEntity.localRotation[3]],
      velocity: localEntity.physics ? [localEntity.physics.velocity[0], localEntity.physics.velocity[1], localEntity.physics.velocity[2]] : [0, 0, 0],
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
    const clientNetworkId = this.peerToNetworkIdMap.get(peerId);    const updates = Entity.all
      .filter(entity => {
        // Send all entities to clients, including their own player entity
        // The client's player component will ignore updates if it's marked as local
        return true;
      })
      .map(entity => {
        const update: EntityUpdateData = {
          id: entity.id,          position: [entity.localPosition[0], entity.localPosition[1], entity.localPosition[2]],
          rotation: [entity.localRotation[0], entity.localRotation[1], entity.localRotation[2], entity.localRotation[3]],
          velocity: entity.physics ? [entity.physics.velocity[0], entity.physics.velocity[1], entity.physics.velocity[2]] : [0, 0, 0],
          modelId: entity.render?.modelId ?? -1,
          frame: entity.render?.frame ?? 0,
          entityType: entity.player ? 'player' : 'entity'
        };
        
        // Log player entity updates for debugging
        if (entity.player) {
          console.log(`📤 HOST: Sending player entity update - entityId: ${entity.id}, networkId: ${entity.networkId}`);
        }
        
        return update;
      });

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

    // Send ALL entities to joining clients (players, enemies, pickups, spawn points, level geometry)
    const entitySnapshots = Entity.all.map(entity => {
      const snapshot = entity.serialize();
      // Include network ID in serialization to fix the limitation mentioned in summary
      if (entity.networkId) {
        snapshot.networkId = entity.networkId;
      }
      return snapshot;
    });
    
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
        hostId: "host",
        peerMappings: peerMappings
      }
    };
    
    console.log(`📤 Sending COMPLETE game state with ${entitySnapshots.length} entities to ${peerId}`);
    console.log(`📊 Entity breakdown:`, {
      players: entitySnapshots.filter(e => e.player).length,
      spawns: entitySnapshots.filter(e => e.spawn).length,
      total: entitySnapshots.length
    });
    this.net.sendMessageToPlayer(peerId, message);
  }

  private updateRemotePlayerEntity(entityData: EntityUpdateData, senderId?: string): void {
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
      
      // Find entity by network ID
      const entity = Entity.findAllPlayerEntities().find(e => 
        e.networkId === networkId.toString()
      );
      
      if (!entity) {
        console.warn(`Host: No entity found for network ID ${networkId} - ignoring update`);
        return;
      }
        // Update the entity through PlayerComponent for proper local/remote handling
      if (entity.player) {
        entity.player.applyNetworkUpdate({
          position: entityData.position,
          rotation: entityData.rotation,
          velocity: entityData.velocity,
          timestamp: Date.now()
        });
      } else {
        this.updateEntityFromEntityData(entity, entityData);
      }
      
    } else {
      // Client: Find entity by entity ID (simpler approach since we have full game state)
      const entity = Entity.findAllPlayerEntities().find(e => 
        e.id === entityData.id
      );
      
      if (!entity) {
        console.warn(`Client: No player entity found for ID ${entityData.id} - ignoring update`);
        return;
      }
      
      // Update the entity through PlayerComponent for proper local/remote handling
      if (entity.player) {
        entity.player.applyNetworkUpdate({
          position: entityData.position,
          rotation: entityData.rotation,
          velocity: entityData.velocity,
          timestamp: Date.now()
        });
      } else {
        this.updateEntityFromEntityData(entity, entityData);
      }
    }
  }

  private updateOrCreateNonPlayerEntity(entityData: EntityUpdateData): void {
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
        if (!entity.network) {
        entity.addNetwork('');
      }
      this.updateEntityFromNetworkData(entity, entityData);
    }
  }

  private updateEntityFromNetworkData(entity: Entity, entityData: EntityUpdateData): void {
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
    }    if (entityData.velocity && entity.physics) {
      entity.physics.velocity[0] = entityData.velocity[0];
      entity.physics.velocity[1] = entityData.velocity[1];
      entity.physics.velocity[2] = entityData.velocity[2];
    }
    if (entityData.modelId !== undefined && entity.render) {
      entity.render.modelId = entityData.modelId;
    }
    if (entityData.frame !== undefined && entity.render) {
      entity.render.frame = entityData.frame;
    }
    entity.dirty = true;
  }

  private updateEntityFromEntityData(entity: Entity, entityData: EntityUpdateData): void {
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
    }    if (entityData.velocity && entity.physics) {
      entity.physics.velocity[0] = entityData.velocity[0];
      entity.physics.velocity[1] = entityData.velocity[1];
      entity.physics.velocity[2] = entityData.velocity[2];
    }
    
    entity.dirty = true;
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

  /**
   * Add network components to existing entities when transitioning to multiplayer
   */
  private addNetworkComponentsToExistingEntities(): void {
    console.log('🔗 Adding network components to existing entities');
    
    let networkEntityCount = 0;
    for (const entity of Entity.all) {      // Add network component if entity doesn't have one
      if (!entity.network) {
        entity.addNetwork("host");
        networkEntityCount++;
      }
        // Assign network IDs to entities that don't have them
      if (!entity.networkId) {
        entity.networkId = (this.nextNetworkId++).toString();
      }
        // Mark as network entity
      if (!entity.network) {
        entity.addNetwork("host");
      } else {
        entity.network.ownerId = "host";
      }
    }
    
    console.log(`✅ Added network components to ${networkEntityCount} entities`);
  }

  // ========================================
  // INVITE TO EXISTING GAME API
  // ========================================

  /**
   * Invite to existing game - preserves all existing entities and adds network components
   * This is the new paradigm for multiplayer: invite to existing game rather than create new
   */
  async inviteToExistingGame(): Promise<void> {
    console.log('🎮 GAME MANAGER: Inviting to existing game');
    
    if (this.gameMode === 'multiplayer') {
      console.warn('Already in multiplayer mode');
      return;
    }
    
    // Preserve all existing entities
    // Add network components to existing entities
    this.addNetworkComponentsToExistingEntities();
    
    // Only update the local player with network ID
    if (globalThis.player) {
      globalThis.player.networkId = "1"; // Host gets ID 1
    }
    
    // Set multiplayer mode
    this.gameMode = 'multiplayer';
    this.isHost = true;
    this.gameId = this.generateGameId();
    this.nextNetworkId = 2; // Next client gets ID 2
    
    console.log('✅ Successfully invited to existing game, preserving all entities');
  }
}

// ========================================
// DEBUG UTILITIES (from multiplayer-fixes-summary.md)
// ========================================

/**
 * Force reload level (HOST ONLY) - debug utility from summary
 */
async function reloadLevel() {
  if (globalThis.gameManager?.isMultiplayerHost()) {
    await globalThis.level.load();
    globalThis.physicsSystem.setLevel(globalThis.level);
    console.log('✅ Level reloaded by host');
  } else {
    console.warn('⚠️ Only host can reload level');
  }
}

/**
 * Debug entity state - utility from summary
 */
function debugEntities() {
  const Entity = globalThis.Entity;
  if (!Entity) {
    console.error('❌ Entity class not available');
    return;
  }
  
  const info = {
    total: Entity.all.length,    players: Entity.all.filter((e: any) => e.player).map((e: any) => ({
      id: e.id,
      networkId: e.networkId,
      local: e.player?.isLocal()
    })),
    spawns: Entity.all.filter((e: any) => e.spawn).length,
    physics: Entity.all.filter((e: any) => e.physics).length,
    render: Entity.all.filter((e: any) => e.render).length,
    networkEntities: Entity.all.filter((e: any) => e.isNetworkEntity).length
  };
  
  console.table(info);
  console.log('Detailed player info:', info.players);
  
  return info;
}

// Make debug functions globally available
if (typeof globalThis !== 'undefined') {
  (globalThis as any).reloadLevel = reloadLevel;
  (globalThis as any).debugEntities = debugEntities;
}
