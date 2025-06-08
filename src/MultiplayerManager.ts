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
    });

    // Network callbacks
    this.net.onPlayerJoin((playerId, playerName) => {
      logger.info('MULTIPLAYER', `Player joined: ${playerName} (${playerId})`);
      // Handle player join logic here
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
    // This would typically be called from the main game loop
    // The Net.update() method already handles this, but this shows the integration
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
