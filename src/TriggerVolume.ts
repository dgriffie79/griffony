import { vec3 } from 'gl-matrix';
import { Entity } from './Entity';
import { PhysicsLayer } from './components/PhysicsComponent';
import { physicsSystem } from './PhysicsSystem';
import type { CollisionEvent } from './types/index';

/**
 * Different shapes for trigger volumes
 */
export enum TriggerShape {
  Box,
  Sphere,
  Cylinder
}

/**
 * A trigger callback interface
 */
export interface TriggerCallback {
  onEnter?: (entity: Entity) => void;
  onExit?: (entity: Entity) => void;
  onStay?: (entity: Entity) => void;
}

/**
 * TriggerVolume is an invisible entity that can detect when other entities enter/exit its area
 */
export class TriggerVolume extends Entity {
  private shape: TriggerShape = TriggerShape.Box;
  private size: vec3 = vec3.fromValues(1, 1, 1); // Box dimensions or sphere/cylinder radius
  private entitiesInside: Set<Entity> = new Set();
  private callback: TriggerCallback | null = null;
  
  /**
   * Create a new trigger volume
   */
  constructor(shape: TriggerShape = TriggerShape.Box, size: vec3 = vec3.fromValues(1, 1, 1)) {
    super();
    this.shape = shape;
    this.size = vec3.clone(size);
    
    // Add physics component for trigger functionality
    this.addPhysics({
      hasCollision: true,
      layer: PhysicsLayer.Trigger,
      collidesWith: PhysicsLayer.All,
      radius: Math.max(this.size[0], this.size[1], this.size[2]),
      height: this.size[2] * 2
    });
    
    // Register with physics system
    physicsSystem.addCollisionListener(this, this.handleCollision.bind(this));
  }
  
  /**
   * Check if a point is inside this trigger volume
   */
  isPointInside(point: vec3): boolean {
    // Transform point to local space
    const localPoint = vec3.create();
    vec3.subtract(localPoint, point, this.worldPosition);
    
    // Check based on shape
    switch (this.shape) {
      case TriggerShape.Box:
        return Math.abs(localPoint[0]) <= this.size[0] &&
               Math.abs(localPoint[1]) <= this.size[1] &&
               Math.abs(localPoint[2]) <= this.size[2];
               
      case TriggerShape.Sphere:
        return vec3.length(localPoint) <= this.size[0];
        
      case TriggerShape.Cylinder:
        const horizontalDistance = Math.sqrt(localPoint[0] * localPoint[0] + localPoint[1] * localPoint[1]);
        return horizontalDistance <= this.size[0] && Math.abs(localPoint[2]) <= this.size[2];
    }
    
    return false;
  }
  
  /**
   * Set the trigger callback functions
   */
  setCallback(callback: TriggerCallback): void {
    this.callback = callback;
  }
  
  /**
   * Update trigger status - check for entities that should stay/exit
   */
  update(elapsed: number): void {
    super.update(elapsed);
    
    // Check for entities that should exit
    for (const entity of this.entitiesInside) {
      if (!this.isEntityInside(entity)) {
        this.handleEntityExit(entity);
      } else if (this.callback?.onStay) {
        this.callback.onStay(entity);
      }
    }
  }
  
  /**
   * Check if an entity is inside this trigger
   */
  isEntityInside(entity: Entity): boolean {
    // Skip entities without a position
    if (!entity.worldPosition) return false;
    
    return this.isPointInside(entity.worldPosition);
  }
  
  /**
   * Handle collision events
   */
  private handleCollision(event: CollisionEvent): void {
    // Skip if there's no other entity
    if (!event.otherEntity) return;
    
    // Check if entity is entering the trigger
    if (!this.entitiesInside.has(event.otherEntity) && this.isEntityInside(event.otherEntity)) {
      this.handleEntityEnter(event.otherEntity);
    }
  }
  
  /**
   * Handle entity entering the trigger
   */
  private handleEntityEnter(entity: Entity): void {
    this.entitiesInside.add(entity);
    
    // Call the enter callback if set
    if (this.callback?.onEnter) {
      this.callback.onEnter(entity);
    }
  }
  
  /**
   * Handle entity exiting the trigger
   */
  private handleEntityExit(entity: Entity): void {
    this.entitiesInside.delete(entity);
    
    // Call the exit callback if set
    if (this.callback?.onExit) {
      this.callback.onExit(entity);
    }
  }
  
  /**
   * Clean up when removing the trigger
   */
  dispose(): void {
    physicsSystem.removeCollisionListener(this);
  }
}
