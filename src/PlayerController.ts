import { vec3, quat } from 'gl-matrix';
import { InputManager } from './InputManager.js';
import { PlayerEntity } from './PlayerEntity.js';
import { Camera } from './Camera.js';

/**
 * Base class for player controllers
 */
export abstract class PlayerController {
  protected playerId: string;
  protected playerEntity: PlayerEntity | null = null;
  
  constructor(playerId: string) {
    this.playerId = playerId;
  }
  
  abstract update(deltaTime: number): void;
  
  setPlayerEntity(entity: PlayerEntity): void {
    this.playerEntity = entity;
    entity.setController(this);
  }
  
  getPlayerEntity(): PlayerEntity | null {
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
  private camera: Camera;
    constructor(playerId: string) {
    super(playerId);
    this.inputManager = InputManager.getInstance();
    this.camera = new Camera();
    
    console.log(`Created local player controller: ${playerId}`);
  }
  
  update(deltaTime: number): void {
    if (!this.playerEntity) return;
    
    // Get input from InputManager
    const input = this.inputManager.update(deltaTime);
    
    // Apply input to player entity
    this.playerEntity.processInput(input);
    
    // Update camera to follow this player
    this.updateCamera();
  }
  
  private updateCamera(): void {
    if (!this.playerEntity) return;
    
    // Set camera to follow this player's head
    this.camera.entity = this.playerEntity.getHead();
  }
  
  getCamera(): Camera {
    return this.camera;
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
