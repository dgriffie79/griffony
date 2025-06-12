import { vec3 } from 'gl-matrix';
import { Component } from './Component';
import type { Entity } from '../Entity';

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

export interface PhysicsConfig {
  hasGravity?: boolean;
  hasCollision?: boolean;
  layer?: PhysicsLayer;
  collidesWith?: PhysicsLayer;
  radius?: number;
  height?: number;
  mass?: number;
}

/**
 * Handles physics simulation for entities
 * Replaces the old physics properties scattered in Entity class
 */
export class PhysicsComponent extends Component {
  velocity: vec3 = vec3.create();
  acceleration: vec3 = vec3.create();
  
  hasGravity: boolean = false;
  hasCollision: boolean = false;
  isStatic: boolean = false;
  
  layer: PhysicsLayer = PhysicsLayer.Default;
  collidesWith: PhysicsLayer = PhysicsLayer.All;
  
  radius: number = 0;
  height: number = 0;
  mass: number = 1.0;
  
  // Physics optimization properties
  _tempGravity?: boolean;
  _tempCollision?: boolean;
  
  // Ground detection
  isGrounded: boolean = false;
  groundCheckDistance: number = 0.1;

  constructor(entity: Entity, config: PhysicsConfig = {}) {
    super(entity);
    this.configure(config);
  }

  /**
   * Configure physics properties
   */
  configure(config: PhysicsConfig): void {
    this.hasGravity = config.hasGravity ?? this.hasGravity;
    this.hasCollision = config.hasCollision ?? this.hasCollision;
    this.layer = config.layer ?? this.layer;
    this.collidesWith = config.collidesWith ?? this.collidesWith;
    this.radius = config.radius ?? this.radius;
    this.height = config.height ?? this.height;
    this.mass = config.mass ?? this.mass;
  }

  update(deltaTime: number): void {
    if (!this.enabled) return;
    
    // Physics integration is handled by PhysicsSystem
    // This method can be used for component-specific physics logic
    
    // Reset acceleration for next frame
    vec3.zero(this.acceleration);
  }

  /**
   * Apply a force to this physics body
   * @param force Force vector to apply
   * @param mode How to apply the force (impulse, continuous, etc.)
   */
  applyForce(force: vec3, mode: 'impulse' | 'continuous' = 'continuous'): void {
    if (this.isStatic) return;

    switch (mode) {
      case 'impulse':
        // Apply immediately to velocity
        const impulse = vec3.create();
        vec3.scale(impulse, force, 1 / this.mass);
        vec3.add(this.velocity, this.velocity, impulse);
        break;
      case 'continuous':
        // Add to acceleration for gradual application
        const accel = vec3.create();
        vec3.scale(accel, force, 1 / this.mass);
        vec3.add(this.acceleration, this.acceleration, accel);
        break;
    }
  }

  /**
   * Check if this entity can collide with another entity
   */
  canCollideWith(other: PhysicsComponent): boolean {
    return (this.layer & other.collidesWith) !== 0 && 
           (other.layer & this.collidesWith) !== 0;
  }

  /**
   * Set as a static physics body (doesn't move)
   */
  setStatic(isStatic: boolean): void {
    this.isStatic = isStatic;
    if (isStatic) {
      vec3.zero(this.velocity);
      vec3.zero(this.acceleration);
    }
  }

  /**
   * Get the current speed (magnitude of velocity)
   */
  getSpeed(): number {
    return vec3.length(this.velocity);
  }

  /**
   * Stop all movement
   */
  stop(): void {
    vec3.zero(this.velocity);
    vec3.zero(this.acceleration);
  }
}