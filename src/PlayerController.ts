import { vec3, quat } from 'gl-matrix';
import { InputManager } from './InputManager.js';
import { Entity } from './Entity.js';
import { Camera } from './Camera.js';

/**
 * Base class for player controllers
 */
export abstract class PlayerController {
  protected playerId: string;
  protected playerEntity: Entity | null = null;
  
  constructor(playerId: string) {
    this.playerId = playerId;
  }
  
  abstract update(deltaTime: number): void;
  
  setPlayerEntity(entity: Entity): void {
    this.playerEntity = entity;
    entity.player?.setController(this);
  }
  
  getPlayerEntity(): Entity | null {
    return this.playerEntity;
  }
  
  getPlayerId(): string {
    return this.playerId;
  }
}

/**
 * Local player controller - handles input and camera
 */
export class LocalPlayerController extends PlayerController {
  private inputManager: InputManager;
  
  constructor(playerId: string) {
    super(playerId);
    this.inputManager = InputManager.getInstance();
    
    console.log(`Created local player controller: ${playerId}`);
  }
  
  update(deltaTime: number): void {
    if (!this.playerEntity) return;
    
    // Get input from InputManager
    const input = this.inputManager.update(deltaTime);
    
    // Apply input to player entity
    this.playerEntity.player?.processInput(input);
    
    // Update camera to follow this player
    this.updateCamera();
  }
  
  private updateCamera(): void {
    if (!this.playerEntity) {
      console.warn('LocalPlayerController: No player entity for camera update');
      return;
    }
    
    // Use global camera directly
    const globalCamera = (globalThis as any).camera;
    if (!globalCamera) {
      console.warn('Global camera not available yet - skipping camera update');
      return;
    }
    
    // Set global camera to follow this player's head
    const playerHead = this.playerEntity.player?.getHead();
    if (!playerHead) {
      console.warn('LocalPlayerController: Player has no head entity for camera');
      return;
    }
    
    globalCamera.entity = playerHead;
    console.log(`LocalPlayerController: Updated camera to follow player head (Entity ID: ${this.playerEntity.id})`);
  }
  
  getCamera(): Camera | null {
    return (globalThis as any).camera || null;
  }
}

/**
 * Remote player controller - receives network updates
 */
export class RemotePlayerController extends PlayerController {
  private lastNetworkUpdate: number = 0;
    constructor(playerId: string) {
    super(playerId);
    console.log(`Created remote player controller: ${playerId}`);
  }
  
  update(deltaTime: number): void {
    if (!this.playerEntity) return;
    
    // Remote players are updated via network, not local input
    // Just update network interpolation
    this.playerEntity.updateNetworkInterpolation(deltaTime);
  }
  
  applyNetworkUpdate(updateData: any): void {
    if (!this.playerEntity) return;
    
    this.playerEntity.applyNetworkUpdate({
      position: updateData.position,
      rotation: updateData.rotation,
      velocity: updateData.velocity,
      timestamp: updateData.timestamp,
      sequenceNumber: updateData.sequenceNumber || 0
    });
    
    this.lastNetworkUpdate = Date.now();
  }
  
  getLastNetworkUpdate(): number {
    return this.lastNetworkUpdate;
  }
}
