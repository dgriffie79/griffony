// Integration layer for multiplayer systems
// This file demonstrates how to integrate the new multiplayer components

import { Net } from './Net';
import { InputManager } from './InputManager';
import { Entity } from './Entity';
import { MessageType, MessagePriority, type NetworkMessage } from './types';
import { Logger } from './Logger.js';

const logger = Logger.getInstance();

export class MultiplayerManager {
  private net: Net;
  private inputManager: InputManager;
  private playerId: string = '';
  private isHost: boolean = false;
  private lastEntityUpdate: number = 0;
  private readonly ENTITY_UPDATE_INTERVAL = 50; // 20 FPS for entity updates

  constructor() {
    this.net = new Net();
    this.inputManager = InputManager.getInstance();
    this.setupCallbacks();
  }

  private setupCallbacks(): void {
    // Input callbacks
    this.inputManager.onInput((bufferedInput) => {
      if (this.net.isConnectionActive()) {
        const inputMessage = this.inputManager.createNetworkInputMessage(this.playerId, bufferedInput);
        this.net.sendMessage(inputMessage);
      }
    });

    this.inputManager.onAction((action, position) => {
      if (this.net.isConnectionActive()) {
        const actionMessage = this.inputManager.createNetworkActionMessage(
          this.playerId, 
          action, 
          position as [number, number, number]
        );
        this.net.sendMessage(actionMessage);
      }
    });    // Network callbacks
    this.net.onPlayerJoin((playerId, playerName) => {
      logger.info('MULTIPLAYER', `Player joined: ${playerName} (${playerId})`);
      
      // If we're the host, send the full game state to the new player
      if (this.isHost) {
        this.sendFullGameStateToPlayer(playerId);
      }
    });

    this.net.onPlayerLeave((playerId) => {
      logger.info('MULTIPLAYER', `Player left: ${playerId}`);
      // Handle player leave logic here
    });

    this.net.onMessage((message, senderId) => {
      this.handleNetworkMessage(message, senderId);
    });

    this.net.onConnectionStateChange((isConnected) => {
      logger.info('MULTIPLAYER', `Connection state changed: ${isConnected ? 'Connected' : 'Disconnected'}`);
    });
  }

  // Host or join game
  async createGame(hostId: string): Promise<void> {
    this.playerId = hostId;
    this.isHost = true;
    await this.net.createHost(hostId);
    logger.info('MULTIPLAYER', `Game hosted with ID: ${hostId}`);
  }

  async joinGame(clientId: string, hostId: string): Promise<void> {
    this.playerId = clientId;
    this.isHost = false;
    await this.net.connectToHost(clientId, hostId);
    logger.info('MULTIPLAYER', `Attempting to join game: ${hostId}`);
  }

  // Update loop integration
  update(deltaTime: number): void {
    // Update input system
    const currentInput = this.inputManager.update(deltaTime);

    // Update entity network interpolation
    this.updateEntityNetworking();

    // Update network system
    this.net.update();

    // Clean up old data periodically
    if (Date.now() % 1000 < 16) { // Roughly once per second
      this.inputManager.clearOldInputs();
    }
  }

  private updateEntityNetworking(): void {
    const now = Date.now();
    
    // Send entity updates at regular intervals (host only)
    if (this.isHost && now - this.lastEntityUpdate > this.ENTITY_UPDATE_INTERVAL) {
      this.sendEntityUpdates();
      this.lastEntityUpdate = now;
    }

    // Update entity interpolation for all entities
    for (const entity of Entity.all) {
      if (entity.isNetworkEntity) {
        entity.updateNetworkInterpolation(this.ENTITY_UPDATE_INTERVAL);
      }
    }
  }
  private sendEntityUpdates(): void {
    if (!this.isHost || !this.net.isConnectionActive()) return;
    
    // Get all entities that need updates (network entities or those that changed)
    const entitiesToSync = Entity.all.filter(entity => 
      entity.isNetworkEntity || entity.dirty
    );
    
    if (entitiesToSync.length === 0) return;
    
    // Create entity batch message
    const entitySnapshots = entitiesToSync.map(entity => ({
      entityId: entity.id.toString(),
      position: Array.from(entity.localPosition) as [number, number, number],
      rotation: Array.from(entity.localRotation) as [number, number, number, number],
      velocity: Array.from(entity.velocity) as [number, number, number],
      timestamp: Date.now()
    }));
    
    const batchMessage = {
      type: MessageType.ENTITY_STATE_BATCH,
      priority: MessagePriority.MEDIUM,
      timestamp: Date.now(),
      sequenceNumber: 0, // Will be set by Net
      data: {
        entities: entitySnapshots,
        timestamp: Date.now()
      }
    };
    
    this.net.sendMessage(batchMessage);
  }
  private handleNetworkMessage(message: NetworkMessage, senderId: string): void {
    switch (message.type) {
      case MessageType.PLAYER_INPUT:
        if (this.isHost) {
          // Process player input for physics simulation
          this.processPlayerInput(message.data, senderId);
        }
        break;
      
      case MessageType.PLAYER_ACTION:
        this.processPlayerAction(message.data, senderId);
        break;
      
      case MessageType.ENTITY_UPDATE:
        this.processEntityUpdate(message.data);
        break;
      
      case MessageType.ENTITY_STATE_BATCH:
        this.processEntityBatch(message.data);
        break;
      
      case MessageType.FULL_GAME_STATE:
        this.processFullGameState(message.data);
        break;
      
      case MessageType.COMBAT_ATTACK:
        this.processCombatAttack(message.data);
        break;
      
      default:
        logger.debug('MULTIPLAYER', `Unhandled message type: ${message.type}`);
        break;
    }
  }

  private processPlayerInput(inputData: any, senderId: string): void {
    // Host processes player input and updates entity state
    // This would integrate with existing physics/movement systems
    logger.debug('MULTIPLAYER', `Processing input from ${senderId}`);
  }

  private processPlayerAction(actionData: any, senderId: string): void {
    logger.info('MULTIPLAYER', `Player ${senderId} performed action: ${actionData.action}`);
    // Handle actions like attack, interact, etc.
  }

  private processEntityUpdate(updateData: any): void {
    // Find entity and apply network update
    const entity = Entity.all.find(e => e.id.toString() === updateData.entityId);
    if (entity) {
      entity.applyNetworkUpdate({
        position: updateData.position,
        rotation: updateData.rotation,
        velocity: updateData.velocity,
        timestamp: updateData.timestamp,
        sequenceNumber: 0
      });
    }
  }

  private processEntityBatch(batchData: any): void {
    for (const entityData of batchData.entities) {
      this.processEntityUpdate(entityData);
    }
  }

  private processCombatAttack(attackData: any): void {
    logger.info('MULTIPLAYER', `Combat attack from ${attackData.attackerId}`);
    // Integrate with existing combat system
  }

  // Methods for handling full game state synchronization
  private sendFullGameStateToPlayer(playerId: string): void {
    try {
      // Collect all current entities as snapshots
      const entitySnapshots = Entity.getAllEntitiesAsSnapshots();
      
      // Get player position/rotation if available
      let playerPosition: [number, number, number] | undefined;
      let playerRotation: [number, number, number, number] | undefined;
      
      // Try to get player state from global game state
      if ((globalThis as any).gameState) {
        const gameState = (globalThis as any).gameState;
        playerPosition = gameState.playerPos;
        playerRotation = gameState.playerOrientation;
      }
      
      const fullStateMessage = {
        type: MessageType.FULL_GAME_STATE,
        priority: MessagePriority.CRITICAL,
        timestamp: Date.now(),
        sequenceNumber: 0, // Will be set by Net
        data: {
          entities: entitySnapshots,
          playerPosition,
          playerRotation,
          gameTime: Date.now(),
          hostId: this.playerId
        }
      };
      
      // Send to specific player
      this.net.sendMessageToPlayer(playerId, fullStateMessage);
      
      logger.info('MULTIPLAYER', `Sent full game state to ${playerId} (${entitySnapshots.length} entities)`);
    } catch (error) {
      logger.error('MULTIPLAYER', `Failed to send full game state: ${error}`);
    }
  }

  private processFullGameState(data: any): void {
    if (this.isHost) {
      // Hosts shouldn't receive full game state
      logger.warn('MULTIPLAYER', 'Host received full game state message - ignoring');
      return;
    }
    
    try {
      logger.info('MULTIPLAYER', `Received full game state with ${data.entities.length} entities`);
      
      // Clear all current entities except the player
      this.clearClientEntities();
      
      // Load entities from server snapshots
      const loadedEntities = Entity.loadEntitiesFromSnapshots(data.entities);
      
      // Mark all loaded entities as network entities
      for (const entity of loadedEntities) {
        entity.isNetworkEntity = true;
        entity.ownerId = data.hostId;
      }
      
      logger.info('MULTIPLAYER', `Loaded ${loadedEntities.length} entities from server`);
      
      // Update player position if provided
      if (data.playerPosition && (globalThis as any).gameState) {
        const gameState = (globalThis as any).gameState;
        gameState.playerPos = data.playerPosition;
        if (data.playerRotation) {
          gameState.playerOrientation = data.playerRotation;
        }
      }
      
    } catch (error) {
      logger.error('MULTIPLAYER', `Failed to process full game state: ${error}`);
    }
  }

  private clearClientEntities(): void {
    // Save the player entity if it exists
    const playerEntity = Entity.all.find(entity => 
      entity.ownerId === this.playerId || 
      !entity.isNetworkEntity
    );
    
    // Clear all entities
    Entity.clearAllEntities();
    
    // Restore the player entity if it existed
    if (playerEntity) {
      Entity.all.push(playerEntity);
      // Reset the ID counter to account for the player
      Entity.nextId = Math.max(Entity.nextId, playerEntity.id + 1);
    }
  }

  // Utility methods for game integration
  sendChatMessage(message: string): void {
    if (this.net.isConnectionActive()) {
      this.net.sendMessage({
        type: MessageType.CHAT,
        priority: MessagePriority.LOW,
        timestamp: Date.now(),
        sequenceNumber: 0, // Will be set by Net
        data: {
          playerId: this.playerId,
          playerName: `Player_${this.playerId}`,
          message,
          timestamp: Date.now()
        }
      });
    }
  }

  getNetworkStats() {
    return {
      ...this.net.getNetworkStats(),
      ...this.inputManager.getInputStats(),
      playerId: this.playerId,
      isHost: this.isHost,
      connectionActive: this.net.isConnectionActive()
    };
  }

  disconnect(): void {
    this.net.disconnect();
    this.inputManager.destroy();
  }
}

// Export singleton instance for easy integration
export const multiplayerManager = new MultiplayerManager();
