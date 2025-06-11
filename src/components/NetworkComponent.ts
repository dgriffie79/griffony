import { vec3, quat } from 'gl-matrix';
import { Component } from './Component';
import type { Entity } from '../Entity';

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

/**
 * Handles network synchronization for entities
 * Manages interpolation, extrapolation, and client-side prediction
 */
export class NetworkComponent extends Component {
  ownerId: string;
  isAuthoritative: boolean = false;
  
  // Network state tracking
  lastNetworkUpdate: number = 0;
  networkStates: NetworkState[] = [];
  predictionStates: PredictionState[] = [];
  
  // Interpolation properties
  isInterpolating: boolean = false;
  interpolationTarget: NetworkState | null = null;
  interpolationStart: NetworkState | null = null;
  interpolationStartTime: number = 0;
  interpolationDuration: number = 100; // ms
  
  // Smoothing configuration
  smoothingEnabled: boolean = true;
  maxInterpolationDistance: number = 5.0; // Max distance before teleporting
  maxExtrapolationTime: number = 200; // Max time to extrapolate without updates

  constructor(entity: Entity, ownerId: string) {
    super(entity);
    this.ownerId = ownerId;
  }

  update(deltaTime: number): void {
    if (!this.enabled) return;
    
    this.updateNetworkInterpolation(deltaTime);
  }

  /**
   * Apply a network update from the server or another client
   */
  applyNetworkUpdate(state: NetworkState, isAuthoritative: boolean = false): void {
    this.lastNetworkUpdate = Date.now();
    
    // Store network state for interpolation
    this.networkStates.push(state);
    
    // Keep only recent states (last 500ms)
    const cutoff = Date.now() - 500;
    this.networkStates = this.networkStates.filter(s => s.timestamp > cutoff);
    
    if (isAuthoritative) {
      // Direct application for authoritative updates
      vec3.copy(this.entity.localPosition, state.position);
      quat.copy(this.entity.localRotation, state.rotation);
      
      // Apply velocity to physics component if present
      if (state.velocity && this.entity.physics) {
        vec3.copy(this.entity.physics.velocity, state.velocity);
      }
      
      this.entity.dirty = true;
    } else if (this.smoothingEnabled) {
      // Start interpolation for smooth movement
      this.startInterpolation(state);
    } else {
      // Direct snap for non-smoothed entities
      vec3.copy(this.entity.localPosition, state.position);
      quat.copy(this.entity.localRotation, state.rotation);
      this.entity.dirty = true;
    }
  }

  private startInterpolation(targetState: NetworkState): void {
    const currentState: NetworkState = {
      position: vec3.clone(this.entity.localPosition),
      rotation: quat.clone(this.entity.localRotation),
      velocity: this.entity.physics ? vec3.clone(this.entity.physics.velocity) : undefined,
      timestamp: Date.now(),
      sequenceNumber: 0
    };

    // Check if we need to teleport instead of interpolate
    const distance = vec3.distance(currentState.position, targetState.position);
    if (distance > this.maxInterpolationDistance) {
      // Teleport for large distances
      vec3.copy(this.entity.localPosition, targetState.position);
      quat.copy(this.entity.localRotation, targetState.rotation);
      
      if (targetState.velocity && this.entity.physics) {
        vec3.copy(this.entity.physics.velocity, targetState.velocity);
      }
      
      this.entity.dirty = true;
      return;
    }

    this.interpolationStart = currentState;
    this.interpolationTarget = targetState;
    this.interpolationStartTime = Date.now();
    this.isInterpolating = true;
    
    // Calculate appropriate interpolation duration based on distance
    this.interpolationDuration = Math.min(200, Math.max(50, distance * 20));
  }

  private updateNetworkInterpolation(deltaTime: number): void {
    if (this.isInterpolating && this.interpolationStart && this.interpolationTarget) {
      const elapsed = Date.now() - this.interpolationStartTime;
      const progress = Math.min(1.0, elapsed / this.interpolationDuration);
      
      // Use smoothstep for natural acceleration/deceleration
      const smoothProgress = progress * progress * (3 - 2 * progress);
      
      // Interpolate position
      vec3.lerp(
        this.entity.localPosition,
        this.interpolationStart.position,
        this.interpolationTarget.position,
        smoothProgress
      );
      
      // Interpolate rotation
      quat.slerp(
        this.entity.localRotation,
        this.interpolationStart.rotation,
        this.interpolationTarget.rotation,
        smoothProgress
      );
      
      // Interpolate velocity if available
      if (this.interpolationStart.velocity && this.interpolationTarget.velocity && this.entity.physics) {
        vec3.lerp(
          this.entity.physics.velocity,
          this.interpolationStart.velocity,
          this.interpolationTarget.velocity,
          smoothProgress
        );
      }
      
      this.entity.dirty = true;
      
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
    vec3.copy(this.entity.localPosition, extrapolatedPosition);
    this.entity.dirty = true;
  }

  /**
   * Save current state for client-side prediction
   */
  saveStateForPrediction(inputSequence: number): void {
    const state: PredictionState = {
      inputSequence,
      position: vec3.clone(this.entity.localPosition),
      rotation: quat.clone(this.entity.localRotation),
      velocity: this.entity.physics ? vec3.clone(this.entity.physics.velocity) : undefined,
      timestamp: Date.now()
    };
    
    this.predictionStates.push(state);
    
    // Keep only recent states (last 2 seconds)
    const cutoff = Date.now() - 2000;
    this.predictionStates = this.predictionStates.filter(s => s.timestamp > cutoff);
  }

  /**
   * Reconcile client prediction with server state
   */
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
      vec3.copy(this.entity.localPosition, serverState.position);
      quat.copy(this.entity.localRotation, serverState.rotation);
      
      if (serverState.velocity && this.entity.physics) {
        vec3.copy(this.entity.physics.velocity, serverState.velocity);
      }
      
      this.entity.dirty = true;
    }
    
    // Remove old prediction states
    this.predictionStates = this.predictionStates.slice(predictionIndex + 1);
  }

  /**
   * Get current network snapshot for sending to other clients
   */
  getNetworkSnapshot(): NetworkState {
    return {
      position: vec3.clone(this.entity.localPosition),
      rotation: quat.clone(this.entity.localRotation),
      velocity: this.entity.physics ? vec3.clone(this.entity.physics.velocity) : undefined,
      timestamp: Date.now(),
      sequenceNumber: 0 // Will be set by network layer
    };
  }
}