import { mat4, quat, vec3 } from 'gl-matrix';
import type { Model } from './Model';
import type { Level } from './Level';
import type { Player } from './Player';

export enum PhysicsLayer {
  Default = 0b00000001,
  Player = 0b00000010, 
  Enemy = 0b00000100,
  Projectile = 0b00001000,
  Pickup = 0b00010000,
  Trigger = 0b00100000,
  Static = 0b01000000,
  All = 0b11111111
}

// Network state for interpolation and prediction
export interface NetworkState {
  position: vec3;
  rotation: quat;
  velocity?: vec3;
  timestamp: number;
  sequenceNumber: number;
}

// Network prediction and reconciliation
export interface PredictionState {
  inputSequence: number;
  position: vec3;
  rotation: quat;
  velocity?: vec3;
  timestamp: number;
}

export class Entity {
  static all: Entity[] = [];
  static nextId: number = 1;

  id: number = 0;
  parent: Entity | null = null;
  children: Entity[] = [];

  // Transform properties
  dirty: boolean = true;
  localPosition: vec3 = vec3.create();
  localRotation: quat = quat.create();
  localScale: vec3 = vec3.fromValues(1, 1, 1);
  localToWorldTransform: mat4 = mat4.create();

  worldPosition: vec3 = vec3.create();
  worldRotation: quat = quat.create();
  worldScale: vec3 = vec3.fromValues(1, 1, 1);
  worldToLocalTransform: mat4 = mat4.create();

  // Visual properties
  model: Model | null = null;
  modelId: number = -1;
  frame: number = 0;
  frameTime: number = 0;
  animationFrame: number = 0;

  // Physics properties
  height: number = 0;
  radius: number = 0;
  vel: vec3 = vec3.create();
  velocity: vec3 = vec3.create(); // Alias for vel for consistency
  gravity: boolean = false;    // Whether this entity is affected by gravity
  collision: boolean = false;  // Whether this entity collides with others
  spawn: boolean = false;      // Whether this is a spawn point

  // Physics layer properties
  physicsLayer: PhysicsLayer = PhysicsLayer.Default;
  collidesWith: PhysicsLayer = PhysicsLayer.All;
  
  // Physics optimization properties
  _tempGravity?: boolean;
  _tempCollision?: boolean;

  // Network synchronization properties
  isNetworkEntity: boolean = false;
  ownerId: string = '';
  lastNetworkUpdate: number = 0;
  networkStates: NetworkState[] = [];
  predictionStates: PredictionState[] = [];
  
  // Interpolation properties
  isInterpolating: boolean = false;
  interpolationTarget: NetworkState | null = null;
  interpolationStart: NetworkState | null = null;
  interpolationStartTime: number = 0;
  interpolationDuration: number = 100; // ms
  
  // Smoothing for network updates
  smoothingEnabled: boolean = true;
  maxInterpolationDistance: number = 5.0; // Max distance before teleporting
  maxExtrapolationTime: number = 200; // Max time to extrapolate without updates

  constructor() {
    // Generate entity ID and add to global list
    this.id = Entity.nextId++;
    Entity.all.push(this);
    
    // Sync velocity alias with vel
    this.velocity = this.vel;
  }

  updateTransforms(parentTransform: mat4 | null): void {
    if (this.dirty) {
      mat4.fromRotationTranslationScale(
        this.localToWorldTransform,
        this.localRotation,
        this.localPosition,
        this.localScale
      );

      if (parentTransform) {
        mat4.multiply(this.localToWorldTransform, parentTransform, this.localToWorldTransform);
      }

      mat4.getTranslation(this.worldPosition, this.localToWorldTransform);
      mat4.getRotation(this.worldRotation, this.localToWorldTransform);
      mat4.getScaling(this.worldScale, this.localToWorldTransform);
      this.dirty = false;
    }

    for (const child of this.children) {
      child.dirty = true;
      child.updateTransforms(this.localToWorldTransform);
    }
  }

  // Network synchronization methods
  applyNetworkUpdate(state: NetworkState, isAuthoritative: boolean = false): void {
    this.lastNetworkUpdate = Date.now();
    
    // Store network state for interpolation
    this.networkStates.push(state);
    
    // Keep only recent states (last 500ms)
    const cutoff = Date.now() - 500;
    this.networkStates = this.networkStates.filter(s => s.timestamp > cutoff);
    
    if (isAuthoritative) {
      // Direct application for authoritative updates
      vec3.copy(this.localPosition, state.position);
      quat.copy(this.localRotation, state.rotation);
      if (state.velocity) {
        vec3.copy(this.velocity, state.velocity);
      }
      this.dirty = true;
    } else if (this.smoothingEnabled) {
      // Start interpolation for smooth movement
      this.startInterpolation(state);
    } else {
      // Direct snap for non-smoothed entities
      vec3.copy(this.localPosition, state.position);
      quat.copy(this.localRotation, state.rotation);
      this.dirty = true;
    }
  }

  private startInterpolation(targetState: NetworkState): void {
    const currentState: NetworkState = {
      position: vec3.clone(this.localPosition),
      rotation: quat.clone(this.localRotation),
      velocity: vec3.clone(this.velocity),
      timestamp: Date.now(),
      sequenceNumber: 0
    };

    // Check if we need to teleport instead of interpolate
    const distance = vec3.distance(currentState.position, targetState.position);
    if (distance > this.maxInterpolationDistance) {
      // Teleport for large distances
      vec3.copy(this.localPosition, targetState.position);
      quat.copy(this.localRotation, targetState.rotation);
      if (targetState.velocity) {
        vec3.copy(this.velocity, targetState.velocity);
      }
      this.dirty = true;
      return;
    }

    this.interpolationStart = currentState;
    this.interpolationTarget = targetState;
    this.interpolationStartTime = Date.now();
    this.isInterpolating = true;
    
    // Calculate appropriate interpolation duration based on distance
    this.interpolationDuration = Math.min(200, Math.max(50, distance * 20));
  }

  updateNetworkInterpolation(deltaTime: number): void {
    if (!this.isNetworkEntity) return;

    if (this.isInterpolating && this.interpolationStart && this.interpolationTarget) {
      const elapsed = Date.now() - this.interpolationStartTime;
      const progress = Math.min(1.0, elapsed / this.interpolationDuration);
      
      // Use smoothstep for natural acceleration/deceleration
      const smoothProgress = progress * progress * (3 - 2 * progress);
      
      // Interpolate position
      vec3.lerp(
        this.localPosition,
        this.interpolationStart.position,
        this.interpolationTarget.position,
        smoothProgress
      );
      
      // Interpolate rotation
      quat.slerp(
        this.localRotation,
        this.interpolationStart.rotation,
        this.interpolationTarget.rotation,
        smoothProgress
      );
      
      // Interpolate velocity if available
      if (this.interpolationStart.velocity && this.interpolationTarget.velocity) {
        vec3.lerp(
          this.velocity,
          this.interpolationStart.velocity,
          this.interpolationTarget.velocity,
          smoothProgress
        );
      }
      
      this.dirty = true;
      
      // End interpolation when complete
      if (progress >= 1.0) {
        this.isInterpolating = false;
        this.interpolationStart = null;
        this.interpolationTarget = null;
      }
    } else {
      // Handle extrapolation for missing updates
      this.updateExtrapolation(deltaTime);
    }
  }

  private updateExtrapolation(deltaTime: number): void {
    if (this.networkStates.length === 0) return;
    
    const timeSinceLastUpdate = Date.now() - this.lastNetworkUpdate;
    if (timeSinceLastUpdate > this.maxExtrapolationTime) return;
    
    // Get latest network state
    const latestState = this.networkStates[this.networkStates.length - 1];
    if (!latestState.velocity) return;
    
    // Simple extrapolation using velocity
    const extrapolationTime = timeSinceLastUpdate / 1000; // Convert to seconds
    const extrapolatedPosition = vec3.create();
    vec3.scaleAndAdd(extrapolatedPosition, latestState.position, latestState.velocity, extrapolationTime);
    
    // Apply extrapolated position
    vec3.copy(this.localPosition, extrapolatedPosition);
    this.dirty = true;
  }

  // Client-side prediction support
  saveStateForPrediction(inputSequence: number): void {
    const state: PredictionState = {
      inputSequence,
      position: vec3.clone(this.localPosition),
      rotation: quat.clone(this.localRotation),
      velocity: vec3.clone(this.velocity),
      timestamp: Date.now()
    };
    
    this.predictionStates.push(state);
    
    // Keep only recent states (last 2 seconds)
    const cutoff = Date.now() - 2000;
    this.predictionStates = this.predictionStates.filter(s => s.timestamp > cutoff);
  }

  reconcileWithServer(serverState: NetworkState, inputSequence: number): void {
    // Find the corresponding prediction state
    const predictionIndex = this.predictionStates.findIndex(s => s.inputSequence === inputSequence);
    if (predictionIndex === -1) return;
    
    const predictedState = this.predictionStates[predictionIndex];
    
    // Calculate difference between prediction and server state
    const positionDiff = vec3.distance(predictedState.position, serverState.position);
    const threshold = 0.1; // 10cm threshold
    
    if (positionDiff > threshold) {
      // Significant difference - apply correction
      vec3.copy(this.localPosition, serverState.position);
      quat.copy(this.localRotation, serverState.rotation);
      if (serverState.velocity) {
        vec3.copy(this.velocity, serverState.velocity);
      }
      this.dirty = true;
      
      // Re-apply inputs that came after this server state
      const subsequentStates = this.predictionStates.slice(predictionIndex + 1);
      for (const state of subsequentStates) {
        // Re-apply the movement for this state
        // This would typically re-run the input processing
        // For now, we'll just smooth towards the corrected position
      }
    }
    
    // Remove old prediction states
    this.predictionStates = this.predictionStates.slice(predictionIndex + 1);
  }

  // Get current network snapshot
  getNetworkSnapshot(): NetworkState {
    return {
      position: vec3.clone(this.localPosition),
      rotation: quat.clone(this.localRotation),
      velocity: vec3.clone(this.velocity),
      timestamp: Date.now(),
      sequenceNumber: 0 // Will be set by network layer
    };
  }

  static deserialize(data: any): Entity | null {
    let entity: Entity;

    switch (data.type.toUpperCase()) {
      case 'PLAYER':
        return null;
      case 'SPAWN':
        entity = new Entity();
        entity.spawn = true;
        entity.model = globalThis.models['spawn'];
        break;
      default:
        entity = new Entity();
        break;
    }

    entity.localPosition = vec3.fromValues(data.x / 32, data.y / 32, 1);

    for (const property of data.properties ?? []) {
      switch (property.name) {
        case 'rotation':
          quat.fromEuler(entity.localRotation, 0, 0, property.value);
          break;
        case 'scale':
          entity.localScale = vec3.fromValues(property.value, property.value, property.value);
          entity.radius = property.value;
          break;
        case 'model_id':
          entity.modelId = property.value;
          break;
      }
    }
    
    entity.model = globalThis.models[entity.modelId];

    return entity;
  }

  onGround(terrain: Level): boolean {
    const r = 0.85 * this.radius;
    const x = this.worldPosition[0];
    const y = this.worldPosition[1];
    // Use small vertical offset to check just below entity for ground contact
    const z = this.worldPosition[2] - 0.1;

    return !!(
      terrain.volume.getVoxelFloor(x, y, z) ||
      terrain.volume.getVoxelFloor(x + r, y, z) ||
      terrain.volume.getVoxelFloor(x - r, y, z) ||
      terrain.volume.getVoxelFloor(x, y + r, z) ||
      terrain.volume.getVoxelFloor(x, y - r, z)
    );
  }

  update(elapsed: number): void {
    // Update network interpolation
    this.updateNetworkInterpolation(elapsed);
    
    // Base implementation - can be overridden by subclasses
  }

  /**
   * Check if this entity can collide with another entity based on layers
   * and godMode status
   */
  canCollideWith(other: Entity): boolean {
    // Check if either entity is a player in godMode
    // Use head property as a way to identify players since we can't use instanceof
    if (((globalThis as any).godMode && 'head' in this) || 
        ((globalThis as any).godMode && 'head' in other)) {
      return false;
    }
    
    return (this.physicsLayer & other.collidesWith) !== 0 && 
           (other.physicsLayer & this.collidesWith) !== 0;
  }
}
