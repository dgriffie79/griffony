import { vec3 } from 'gl-matrix';
import { Entity, PhysicsLayer } from './Entity';
import { Level } from './Level';
import type { CollisionEvent, CollisionCallback } from './types/index';
import { getConfig } from './Config';

export interface PhysicsConfig {
  gravity: number;       // Gravity force in units per second squared
  maxVelocity: number;   // Maximum velocity in any direction
  jumpForce: number;     // Force applied when jumping
  friction: number;      // Ground friction (0-1)
  airResistance: number; // Air resistance (0-1)
  collisionBounce: number; // Elasticity of collisions (0-1)
  entityCollisionEnabled: boolean; // Whether entity-entity collision is enabled
  terrainCollisionEnabled: boolean; // Whether terrain collision is enabled
  qualityLevel: 'low' | 'medium' | 'high'; // Physics quality level
  maxEntities: number;                     // Maximum entities to process at once
  spatialOptimization: boolean;            // Whether to use spatial partitioning
}

/**
 * PhysicsSystem handles all physics-related calculations including:
 * - Gravity
 * - Velocity application
 * - Entity-Entity collision
 * - Entity-Terrain collision
 * - Movement and physics constraints
 */
export class PhysicsSystem {
  private static instance: PhysicsSystem | null = null;
  private level: Level | null = null; private frameCount: number = 0;
  private lastReportTime: number = 0;
  private debugEnabled: boolean = false;
  private collisionListeners: Map<Entity, CollisionCallback> = new Map();
  private globalCollisionListeners: CollisionCallback[] = [];
  // Optimized spatial grid with numeric keys and performance tracking
  private spatialGrid: Map<number, Entity[]> = new Map();
  private gridCellSize: number;
  private useGridOptimization: boolean = true;
  private gridLastUpdate: number = 0;

  // Performance tracking
  private performanceMetrics = {
    collisionChecks: 0,
    collisionHits: 0,
    raycastCount: 0,
    gridUpdateTime: 0,
    lastResetTime: Date.now()
  };
  // Collision pair cache to avoid redundant checks
  private collisionPairCache: Map<string, number> = new Map();
  private collisionCacheTimeout: number;
  private gridUpdateInterval: number;
  private config = getConfig();
  private constructor() {
    // Initialize configuration values
    const physicsConfig = this.config.getPhysicsConfig();
    this.collisionCacheTimeout = physicsConfig.collisionCacheTimeout;
    this.gridUpdateInterval = physicsConfig.gridUpdateInterval;
    this.gridCellSize = physicsConfig.gridCellSize;
  }

  static getInstance(): PhysicsSystem {
    if (!PhysicsSystem.instance) {
      PhysicsSystem.instance = new PhysicsSystem();
    }
    return PhysicsSystem.instance;
  }

  /**
   * Set the current level for terrain collision
   */
  setLevel(level: Level): void {
    this.level = level;
    // Initial transforms pass so worldPosition matches current localPosition
    for (const entity of Entity.all) {
      if (!entity.parent) {
        entity.dirty = true;
        entity.updateTransforms(null);
      }
    }
    // Snap only player entity to exact floor height at load time
    for (const entity of Entity.all) {
      const isPlayer = 'head' in entity;
      if (isPlayer && !(globalThis as any).godMode) {
        // Compute integer column X,Y
        const x = Math.floor(entity.localPosition[0]);
        const y = Math.floor(entity.localPosition[1]);
        // Find highest solid voxel in column
        let floorZ = -1;
        for (let z = this.level.volume.sizeZ - 1; z >= 0; z--) {
          // Use getVoxelFloor to respect voxel boundaries
          if (this.level.volume.getVoxelFloor(x, y, z)) {
            floorZ = z;
            break;
          }
        }
        // Position entity slightly above floor to prevent penetration
        if (floorZ >= 0) {
          const radius = entity.physics?.radius || 0.5;
          entity.localPosition[2] = floorZ + radius + 0.001;
        }
        entity.dirty = true;
        // Update worldPosition
        entity.updateTransforms(null);
        // Zero vertical velocity after snapping
        if (entity.physics) {
          entity.physics.velocity[2] = 0;
        }
      }
    }
    // Final transforms pass to apply snapped positions
    for (const entity of Entity.all) {
      if (!entity.parent) {
        entity.dirty = true;
        entity.updateTransforms(null);
      }
    }
  }
  /**
   * Update physics configuration
   */
  updateConfig(config: Partial<PhysicsConfig>): void {
    this.config.updatePhysicsConfig(config);
  }

  /**
   * Get current physics configuration
   */
  getConfig(): PhysicsConfig {
    return this.config.getPhysicsConfig();
  }  /**
   * Main physics update function, called each frame
   */
  update(elapsed: number): void {
    const dt = elapsed / 1000; // Convert ms to seconds

    // Update spatial grid for optimization (with throttling)
    const now = Date.now();
    if (now - this.gridLastUpdate > this.gridUpdateInterval) {
      const gridStartTime = performance.now();
      this.updateSpatialGrid();
      this.performanceMetrics.gridUpdateTime = performance.now() - gridStartTime;
      this.gridLastUpdate = now;
    }

    // Clean old collision cache entries
    this.cleanCollisionCache(now);

    for (const entity of Entity.all) {
      this.updateEntity(entity, dt);
    }

    this.logDebugInfo();
  }
  /**
   * Apply physics to a single entity
   */
  private updateEntity(entity: Entity, dt: number): void {
    // Skip entities without physics (e.g., weapons attached to players)
    if (entity.parent) return;

    // Apply gravity
    this.applyGravity(entity, dt);

    // Apply friction and air resistance
    this.applyFriction(entity, dt);    // Apply velocity constraints
    this.constrainVelocity(entity);

    // Apply velocity to position
    this.applyVelocity(entity, dt);

    // Handle collisions
    if (entity.physics?.hasCollision) {
      const physicsConfig = this.config.getPhysicsConfig();

      // Entity-entity collisions
      if (physicsConfig.entityCollisionEnabled) {
        this.handleEntityCollisions(entity);
      }

      // Terrain collisions
      if (physicsConfig.terrainCollisionEnabled) {
        this.handleTerrainCollisions(entity);
      }
    }
  }

  /**
   * Apply gravity to an entity
   */
  private applyGravity(entity: Entity, dt: number): void {
    const physicsConfig = this.config.getPhysicsConfig();
    // Skip gravity for godMode players - 'head' property identifies a player since we can't use instanceof
    const isPlayer = 'head' in entity;
    if (entity.physics?.hasGravity && !(isPlayer && (globalThis as any).godMode)) {
      // CRITICAL: Only apply gravity when level is fully loaded to prevent race condition      // During level loading, isEntityOnGround returns false, causing entities to accumulate downward velocity
      if (!this.level || !this.level.isFullyLoaded) {
        if (this.debugEnabled && isPlayer) {
          console.log('🛡️ Gravity skipped - level not fully loaded (preventing race condition)');
        }
        return; // Skip gravity application until terrain collision data is ready
      }

      const onGround = this.isEntityOnGround(entity);      if (!onGround && entity.physics) {
        const oldVel = entity.physics.velocity[2];
        entity.physics.velocity[2] -= physicsConfig.gravity * dt;
      } else if (entity.physics && entity.physics.velocity[2] < 0) {
        // Stop falling when on ground
        entity.physics.velocity[2] = 0;
      }
    }
  }
  /**
   * Apply friction and air resistance to an entity
   */
  private applyFriction(entity: Entity, dt: number): void {
    const physicsConfig = this.config.getPhysicsConfig();
    
    // Skip if no physics component or velocity
    if (!entity.physics) return;
    
    const speed = vec3.length(entity.physics.velocity);
    if (speed <= 0.001) {
      vec3.zero(entity.physics.velocity);
      return;
    }

    // Determine if entity is on ground
    const onGround = this.isEntityOnGround(entity);

    // Apply appropriate resistance based on ground contact
    const resistanceFactor = onGround ? physicsConfig.friction : physicsConfig.airResistance;

    // Calculate resistance force
    const resistanceStrength = resistanceFactor * dt;

    // Apply resistance (with limits to avoid oscillation)
    if (resistanceStrength >= 1) {
      // Full stop if resistance would reverse direction
      vec3.zero(entity.physics.velocity);
    } else {
      // Apply percentage-based velocity reduction
      vec3.scale(entity.physics.velocity, entity.physics.velocity, 1 - resistanceStrength);

      // Zero out very small velocities to avoid jittering
      if (vec3.length(entity.physics.velocity) < 0.01) {
        vec3.zero(entity.physics.velocity);
      }
    }
  }
  /**
   * Apply velocity constraints (max speed)
   */
  private constrainVelocity(entity: Entity): void {
    const physicsConfig = this.config.getPhysicsConfig();
    
    if (!entity.physics) return;
    
    const speed = vec3.length(entity.physics.velocity);
    if (speed > physicsConfig.maxVelocity) {
      vec3.normalize(entity.physics.velocity, entity.physics.velocity);
      vec3.scale(entity.physics.velocity, entity.physics.velocity, physicsConfig.maxVelocity);
    }
  }

  /**
   * Apply velocity to position
   */
  private applyVelocity(entity: Entity, dt: number): void {
    if (!entity.physics) return;
    
    const speed = vec3.length(entity.physics.velocity);
    if (speed > 0) {
      vec3.scaleAndAdd(entity.localPosition, entity.localPosition, entity.physics.velocity, dt);
      entity.dirty = true;
    }
  }  /**
   * Handle entity-entity collisions with optimized distance calculations and caching
   */
  private handleEntityCollisions(entity: Entity): void {
    // Skip entity collision for players in godMode - 'head' property identifies a player
    const isPlayer = 'head' in entity;
    if (isPlayer && (globalThis as any).godMode) return;

    const potentialColliders = this.getPotentialCollisionCandidates(entity);

    for (const otherEntity of potentialColliders) {
      // Skip self, non-collidable entities, and parent/children
      if (
        entity === otherEntity ||
        otherEntity.parent === entity ||
        entity.parent === otherEntity ||
        !otherEntity.physics?.hasCollision ||
        otherEntity.spawn ||
        !entity.canCollideWith(otherEntity) ||
        // Skip collision if other entity is a player in godMode
        ('head' in otherEntity && (globalThis as any).godMode)
      ) {
        continue;
      }

      // Check collision cache to avoid redundant calculations
      const pairKey = this.getEntityPairKey(entity, otherEntity);
      const now = Date.now();
      const lastCheck = this.collisionPairCache.get(pairKey);
      if (lastCheck && (now - lastCheck) < this.collisionCacheTimeout) {
        continue; // Skip if recently checked
      }

      // Update performance metrics
      this.performanceMetrics.collisionChecks++;

      const displacement = vec3.sub(vec3.create(), otherEntity.localPosition, entity.localPosition);

      // Use distance-squared comparison to avoid expensive sqrt operation
      const distanceSquared = vec3.squaredLength(displacement);
      const minDistance = (entity.physics?.radius || 0) + (otherEntity.physics?.radius || 0);
      const minDistanceSquared = minDistance * minDistance;

      // Check for collision using squared distance
      if (distanceSquared < minDistanceSquared) {
        // Only calculate actual distance when we know there's a collision
        const distance = Math.sqrt(distanceSquared);
        this.performanceMetrics.collisionHits++;
        this.resolveEntityCollision(entity, otherEntity, displacement, distance, minDistance);
      }

      // Cache this collision check
      this.collisionPairCache.set(pairKey, now);
    }
  }  /**
   * Resolve a collision between two entities
   */
  private resolveEntityCollision(
    entity: Entity,
    otherEntity: Entity,
    displacement: vec3,
    distance: number,
    minDistance: number
  ): void {
    const physicsConfig = this.config.getPhysicsConfig();
    // Calculate penetration depth
    const penetration = minDistance - distance;

    // Get the collision normal
    const normal = vec3.normalize(vec3.create(), displacement);

    // Resolve positions - if one entity is larger, it pushes the smaller one more
    if ((entity.physics?.radius || 0) >= (otherEntity.physics?.radius || 0)) {
      // Push the other entity away
      vec3.scaleAndAdd(otherEntity.localPosition, otherEntity.localPosition, normal, penetration);
      otherEntity.dirty = true;
    }

    // Always move the current entity away
    vec3.scaleAndAdd(entity.localPosition, entity.localPosition, normal, -penetration);
    entity.dirty = true;

    // Calculate relative velocity and impact force
    let relativeVelocity = 0;
    let impulse = 0;    // Apply bounce effect if configured
    if (physicsConfig.collisionBounce > 0) {
      // Only apply bounce if entities have velocity
      if (entity.physics?.velocity && otherEntity.physics?.velocity) {
        // Calculate relative velocity along normal
        const v1 = vec3.dot(entity.physics.velocity, normal);
        const v2 = vec3.dot(otherEntity.physics.velocity, normal);
        relativeVelocity = v1 - v2;

        // Skip bounce if objects are already moving away from each other
        if (v1 <= v2) return;

        // Calculate impulse with elasticity (bounce)
        const bounce = physicsConfig.collisionBounce;
        impulse = (1 + bounce) * relativeVelocity / 2; // Simplified for equal mass

        // Apply impulse in opposite directions
        vec3.scaleAndAdd(entity.physics.velocity, entity.physics.velocity, normal, -impulse);
        vec3.scaleAndAdd(otherEntity.physics.velocity, otherEntity.physics.velocity, normal, impulse);
      }
    }

    // Dispatch collision events for both entities
    const collisionPosition = vec3.create();
    vec3.scaleAndAdd(collisionPosition, entity.worldPosition, normal, -(entity.physics?.radius || 0));

    // Event for first entity
    this.dispatchCollisionEvent({
      type: 'entity',
      entity: entity,
      otherEntity: otherEntity,
      position: vec3.clone(collisionPosition),
      normal: vec3.clone(normal).map(v => -v) as vec3, // Flip normal for first entity
      velocity: vec3.clone(entity.physics?.velocity || vec3.create()),
      force: Math.abs(relativeVelocity)
    });

    // Event for second entity
    this.dispatchCollisionEvent({
      type: 'entity',
      entity: otherEntity,
      otherEntity: entity,
      position: vec3.clone(collisionPosition),
      normal: vec3.clone(normal),
      velocity: vec3.clone(otherEntity.physics?.velocity || vec3.create()),
      force: Math.abs(relativeVelocity)
    });
  }  /**
   * Handle entity-terrain collisions
   */  /**
   * Handle entity-terrain collisions with comprehensive axis-based collision detection
   * @param entity The entity to check for terrain collisions
   */
  private handleTerrainCollisions(entity: Entity): void {
    if (!this.validateTerrainCollisionPreconditions(entity)) {
      return;
    }

    // Handle collisions for each axis
    this.handleXAxisTerrainCollisions(entity);
    this.handleYAxisTerrainCollisions(entity);
    this.handleZAxisTerrainCollisions(entity);
  }

  /**
   * Validate preconditions for terrain collision processing
   * @param entity The entity to validate
   * @returns true if collision processing should continue, false otherwise
   */
  private validateTerrainCollisionPreconditions(entity: Entity): boolean {
    // Skip if level not loaded or missing
    if (!this.level || !this.level.isFullyLoaded) {
      return false;
    }

    // Skip terrain collision for players in godMode - 'head' property identifies a player
    const isPlayer = 'head' in entity;
    if (isPlayer && (globalThis as any).godMode) {
      return false;
    }

    return true;
  }

  /**
   * Handle X-axis (left/right) terrain collisions
   * @param entity The entity to check for X-axis collisions
   */
  private handleXAxisTerrainCollisions(entity: Entity): void {
    if (!entity.physics) return;
    
    const r = entity.physics.radius;
    const h = entity.physics.height;
    const pos = entity.localPosition;

    // X-axis collision (left)
    if (this.level!.volume.getVoxelFloor(pos[0] - r, pos[1], pos[2] + h / 2)) {
      this.handleAxisCollision(entity, 0, 'left', Math.ceil(pos[0] - r) + r);
    }

    // X-axis collision (right)
    if (this.level!.volume.getVoxelFloor(pos[0] + r, pos[1], pos[2] + h / 2)) {
      this.handleAxisCollision(entity, 0, 'right', Math.floor(pos[0] + r) - r);
    }
  }

  /**
   * Handle Y-axis (front/back) terrain collisions
   * @param entity The entity to check for Y-axis collisions
   */
  private handleYAxisTerrainCollisions(entity: Entity): void {
    if (!entity.physics) return;
    
    const r = entity.physics.radius;
    const h = entity.physics.height;
    const pos = entity.localPosition;

    // Y-axis collision (back)
    if (this.level!.volume.getVoxelFloor(pos[0], pos[1] - r, pos[2] + h / 2)) {
      this.handleAxisCollision(entity, 1, 'back', Math.ceil(pos[1] - r) + r);
    }

    // Y-axis collision (front)
    if (this.level!.volume.getVoxelFloor(pos[0], pos[1] + r, pos[2] + h / 2)) {
      this.handleAxisCollision(entity, 1, 'front', Math.floor(pos[1] + r) - r);
    }
  }

  /**
   * Handle Z-axis (top/bottom) terrain collisions
   * @param entity The entity to check for Z-axis collisions
   */
  private handleZAxisTerrainCollisions(entity: Entity): void {
    if (!entity.physics) return;
    
    const h = entity.physics.height;
    const pos = entity.localPosition;

    // Z-axis collision (bottom/floor)
    if (this.level!.volume.getVoxelFloor(pos[0], pos[1], pos[2])) {
      const oldVelocity = vec3.clone(entity.physics.velocity);
      const impactForce = Math.abs(entity.physics.velocity[2]);
      const collisionPoint = vec3.fromValues(pos[0], pos[1], Math.floor(pos[2]));

      pos[2] = Math.ceil(pos[2]);
      this.applyCollisionBounce(entity, 2, 'down');
      entity.dirty = true;

      // Dispatch collision event for floor impacts
      this.dispatchCollisionEvent({
        type: 'terrain',
        entity: entity,
        position: collisionPoint,
        normal: vec3.fromValues(0, 0, 1), // Bottom collision normal points up
        velocity: oldVelocity,
        force: impactForce
      });
    }

    // Z-axis collision (top/ceiling)
    if (this.level!.volume.getVoxelFloor(pos[0], pos[1], pos[2] + h)) {
      pos[2] = Math.floor(pos[2] + h) - h;
      this.applyCollisionBounce(entity, 2, 'up');
      entity.dirty = true;
    }
  }

  /**
   * Handle collision for a specific axis (generic handler to reduce code duplication)
   * @param entity The entity experiencing collision
   * @param axis The axis index (0=X, 1=Y, 2=Z)
   * @param direction The collision direction for bounce determination
   * @param newPosition The corrected position value for this axis
   */
  private handleAxisCollision(entity: Entity, axis: number, direction: 'left' | 'right' | 'back' | 'front', newPosition: number): void {
    entity.localPosition[axis] = newPosition;
    this.applyCollisionBounce(entity, axis, direction);
    entity.dirty = true;
  }

  /**
   * Apply collision bounce physics to entity velocity
   * @param entity The entity to apply bounce to
   * @param axis The axis index (0=X, 1=Y, 2=Z)
   * @param direction The collision direction for determining velocity direction
   */
  private applyCollisionBounce(entity: Entity, axis: number, direction: string): void {
    if (!entity.physics) return;
    
    const physicsConfig = this.config.getPhysicsConfig();
    const currentVelocity = entity.physics.velocity[axis];

    // Determine if we should apply bounce based on movement direction
    const shouldBounce = physicsConfig.collisionBounce > 0 && this.shouldApplyBounceForDirection(currentVelocity, direction);

    if (shouldBounce) {
      entity.physics.velocity[axis] = -currentVelocity * physicsConfig.collisionBounce;

      // Stop very small bounces (for Z-axis specifically)
      if (axis === 2 && Math.abs(entity.physics.velocity[axis]) < 0.1) {
        entity.physics.velocity[axis] = 0;
      }
    } else {
      entity.physics.velocity[axis] = 0;
    }
  }

  /**
   * Determine if bounce should be applied based on velocity direction and collision direction
   * @param velocity The current velocity on the axis
   * @param direction The collision direction
   * @returns true if bounce should be applied
   */
  private shouldApplyBounceForDirection(velocity: number, direction: string): boolean {
    switch (direction) {
      case 'left':
      case 'back':
      case 'down':
        return velocity < 0;
      case 'right':
      case 'front':
      case 'up':
        return velocity > 0;
      default:
        return false;
    }
  }/**
   * Check if an entity is on the ground
   */
  isEntityOnGround(entity: Entity): boolean {
    // Always return false for godMode players so they can fly - 'head' property identifies a player
    const isPlayer = 'head' in entity;
    if (isPlayer && (globalThis as any).godMode) {
      return false;
    }
    return this.level && this.level.isFullyLoaded ? entity.onGround(this.level) : false;
  }
  /**
   * Make entity jump if on ground
   */
  jump(entity: Entity): boolean {
    const physicsConfig = this.config.getPhysicsConfig();
    if (entity.physics?.hasGravity && this.isEntityOnGround(entity)) {
      if (entity.physics) {
        entity.physics.velocity[2] += physicsConfig.jumpForce;
      }
      return true;
    }
    return false;
  }

  /**
   * Apply movement input to entity velocity
   */
  applyMovement(entity: Entity, direction: vec3, speed: number): void {
    if (!entity.physics) return;
    vec3.scaleAndAdd(entity.physics.velocity, entity.physics.velocity, direction, speed);
  }
  /**
   * Enable or disable physics debugging
   */
  setDebug(enabled: boolean): void {
    this.debugEnabled = enabled;
    this.lastReportTime = performance.now();
    this.frameCount = 0;
  }

  /**
   * Check if debug mode is enabled
   */
  isDebugEnabled(): boolean {
    return this.debugEnabled;
  }

  /**
   * Get total count of entities using physics
   */
  getPhysicsEntityCount(): number {
    return Entity.all.filter(e => e.physics?.hasGravity || e.physics?.hasCollision).length;
  }

  /**
   * Get a debug status report of the physics system
   */
  getDebugStatus(): string {
    const physicsEntities = Entity.all.filter(e => e.physics?.hasGravity || e.physics?.hasCollision);
    const collisionEntities = Entity.all.filter(e => e.physics?.hasCollision);
    const gravityEntities = Entity.all.filter(e => e.physics?.hasGravity);

    return `Physics: ${physicsEntities.length} entities | ` +
      `Collision: ${collisionEntities.length} | ` +
      `Gravity: ${gravityEntities.length} | ` +
      `FPS: ${Math.round(this.frameCount / ((performance.now() - this.lastReportTime) / 1000))}`;
  }

  /**
   * Log debug information periodically
   */
  private logDebugInfo(): void {
    if (!this.debugEnabled) return;

    this.frameCount++;
    // Report stats every second
    if (performance.now() - this.lastReportTime > 1000) {
      this.frameCount = 0;
      this.lastReportTime = performance.now();
    }
  }
  /**
   * Configure an entity with physics properties
   */
  configureEntity(entity: Entity, options: {
    hasGravity?: boolean,
    hasCollision?: boolean,
    radius?: number,
    height?: number,
    layer?: PhysicsLayer,
    collidesWith?: PhysicsLayer
  }): void {
    if (!entity.physics) {
      entity.addPhysics({
        hasGravity: options.hasGravity || false,
        hasCollision: options.hasCollision || false,
        radius: options.radius || 0.5,
        height: options.height || 1.0,
        layer: options.layer || PhysicsLayer.Default,
        collidesWith: options.collidesWith || PhysicsLayer.All
      });
    } else {
      if (options.hasGravity !== undefined) {
        entity.physics.hasGravity = options.hasGravity;
      }

      if (options.hasCollision !== undefined) {
        entity.physics.hasCollision = options.hasCollision;
      }

      if (options.radius !== undefined) {
        entity.physics.radius = options.radius;
      }

      if (options.height !== undefined) {
        entity.physics.height = options.height;
      }

      if (options.layer !== undefined) {
        entity.physics.layer = options.layer;
      }

      if (options.collidesWith !== undefined) {
        entity.physics.collidesWith = options.collidesWith;
      }
    }

    entity.dirty = true;
  }

  /**
   * Set the velocity of an entity directly
   */
  setVelocity(entity: Entity, x: number, y: number, z: number): void {
    if (!entity.physics) return;
    vec3.set(entity.physics.velocity, x, y, z);
    this.constrainVelocity(entity);
  }

  /**
   * Add velocity to an entity (useful for impulses, explosions, etc.)
   */
  addVelocity(entity: Entity, x: number, y: number, z: number): void {
    if (!entity.physics) return;
    vec3.add(entity.physics.velocity, entity.physics.velocity, vec3.fromValues(x, y, z));
    this.constrainVelocity(entity);
  }

  /**
   * Find all entities within a radius of a position
   */
  findEntitiesInRadius(position: vec3, radius: number, excludeEntity?: Entity): Entity[] {
    const result: Entity[] = [];

    for (const entity of Entity.all) {
      if (entity === excludeEntity) continue;
      if (entity.parent) continue; // Skip child entities

      const distance = vec3.distance(position, entity.worldPosition);
      if (distance <= radius) {
        result.push(entity);
      }
    }

    return result;
  }

  /**
   * Apply a radial force from a point (explosion, shockwave, etc.)
   */
  applyRadialForce(origin: vec3, radius: number, force: number, falloff: boolean = true): void {
    const entities = this.findEntitiesInRadius(origin, radius);

    for (const entity of entities) {
      // Skip entities without physics
      if (!entity.physics) continue;

      // Calculate direction away from origin
      const direction = vec3.sub(vec3.create(), entity.worldPosition, origin);
      const distance = vec3.length(direction);

      // Normalize direction
      if (distance > 0) {
        vec3.normalize(direction, direction);
      } else {
        // Random direction if at exact same position
        vec3.set(direction,
          Math.random() * 2 - 1,
          Math.random() * 2 - 1,
          Math.random() * 2 - 1
        );
        vec3.normalize(direction, direction);
      }

      // Calculate force strength with optional falloff
      let strength = force;
      if (falloff && distance > 0) {
        // Linear falloff with distance
        strength = force * (1 - distance / radius);
      }

      // Apply force as velocity change
      vec3.scaleAndAdd(entity.physics.velocity, entity.physics.velocity, direction, strength);

      // Ensure velocity is within limits
      this.constrainVelocity(entity);
    }
  }

  /**
   * Add a collision listener for a specific entity
   */
  addCollisionListener(entity: Entity, callback: CollisionCallback): void {
    this.collisionListeners.set(entity, callback);
  }

  /**
   * Remove a collision listener for an entity
   */
  removeCollisionListener(entity: Entity): void {
    this.collisionListeners.delete(entity);
  }

  /**
   * Add a global collision listener that receives all collision events
   */
  addGlobalCollisionListener(callback: CollisionCallback): void {
    this.globalCollisionListeners.push(callback);
  }

  /**
   * Remove a global collision listener
   */
  removeGlobalCollisionListener(callback: CollisionCallback): void {
    const index = this.globalCollisionListeners.indexOf(callback);
    if (index >= 0) {
      this.globalCollisionListeners.splice(index, 1);
    }
  }

  /**
   * Dispatch a collision event to relevant listeners
   */
  private dispatchCollisionEvent(event: CollisionEvent): void {
    // Notify entity-specific listener
    const listener = this.collisionListeners.get(event.entity);
    if (listener) {
      listener(event);
    }

    // Notify global listeners
    for (const globalListener of this.globalCollisionListeners) {
      globalListener(event);
    }
  }  /**
   * Perform a raycast against terrain and entities with spatial optimization
   */
  raycast(origin: vec3, direction: vec3, maxDistance?: number,
    options: { ignoreTerrain?: boolean, ignoreEntities?: boolean, ignoreEntity?: Entity } = {}
  ): {
    hit: boolean,
    position: vec3,
    normal: vec3,
    distance: number,
    entity: Entity | undefined,
    voxelValue: number | undefined
  } {
    this.performanceMetrics.raycastCount++;

    const actualMaxDistance = maxDistance ?? this.config.getPhysicsConfig().defaultRaycastDistance;

    const normalizedDir = vec3.normalize(vec3.create(), direction); let closestHit = {
      hit: false,
      position: vec3.create(),
      normal: vec3.fromValues(0, 0, 1),
      distance: actualMaxDistance,
      entity: undefined as Entity | undefined,
      voxelValue: undefined as number | undefined
    };

    // Check entities first using spatial optimization
    if (!options.ignoreEntities) {
      const entityHit = this.raycastEntities(origin, normalizedDir, actualMaxDistance, options.ignoreEntity);
      if (entityHit.hit && entityHit.distance < closestHit.distance) {
        closestHit = entityHit;
      }
    }    // Check terrain intersection if we have a level and terrain checks are enabled
    if (!options.ignoreTerrain && this.level) {
      const terrainHit = this.raycastTerrain(origin, normalizedDir, actualMaxDistance);
      // If we hit terrain and it's closer than any entity hit, use the terrain hit
      if (terrainHit.hit && terrainHit.distance < closestHit.distance) {
        closestHit = {
          ...terrainHit,
          entity: terrainHit.entity, // This will be undefined for terrain hits
          voxelValue: terrainHit.voxelValue // Ensure voxelValue is included
        };
      }
    }

    return closestHit;
  }

  /**
   * Optimized raycast against entities using spatial grid
   */
  private raycastEntities(origin: vec3, direction: vec3, maxDistance: number, ignoreEntity?: Entity): {
    hit: boolean,
    position: vec3,
    normal: vec3,
    distance: number,
    entity: Entity | undefined,
    voxelValue: number | undefined
  } {
    let closestHit = {
      hit: false,
      position: vec3.create(),
      normal: vec3.fromValues(0, 0, 1),
      distance: maxDistance,
      entity: undefined as Entity | undefined,
      voxelValue: undefined as number | undefined
    };

    if (this.useGridOptimization && this.spatialGrid.size > 0) {
      // Use spatial grid to only check entities along the ray path
      const entitiesAlongRay = this.getEntitiesAlongRay(origin, direction, maxDistance);

      for (const entity of entitiesAlongRay) {
        if (!entity.physics?.hasCollision || entity.parent || entity === ignoreEntity) continue;
        if ('head' in entity && (globalThis as any).godMode) continue;

        const hit = this.raycastEntity(entity, origin, direction, maxDistance);
        if (hit.hit && hit.distance < closestHit.distance) {
          closestHit = hit;
        }
      }
    } else {
      // Fallback to checking all entities
      for (const entity of Entity.all) {
        if (!entity.physics?.hasCollision || entity.parent || entity === ignoreEntity) continue;
        if ('head' in entity && (globalThis as any).godMode) continue;

        const hit = this.raycastEntity(entity, origin, direction, maxDistance);
        if (hit.hit && hit.distance < closestHit.distance) {
          closestHit = hit;
        }
      }
    }

    return closestHit;
  }

  /**
   * Get entities along a ray path using spatial grid
   */
  private getEntitiesAlongRay(origin: vec3, direction: vec3, maxDistance: number): Set<Entity> {
    const entities = new Set<Entity>();
    const step = this.gridCellSize / 2; // Sample every half grid cell
    const steps = Math.ceil(maxDistance / step);

    for (let i = 0; i <= steps; i++) {
      const t = (i * step);
      if (t > maxDistance) break;

      const point = vec3.scaleAndAdd(vec3.create(), origin, direction, t);

      const cellX = Math.floor(point[0] / this.gridCellSize);
      const cellY = Math.floor(point[1] / this.gridCellSize);
      const cellZ = Math.floor(point[2] / this.gridCellSize);

      const cellKey = this.spatialHash(cellX, cellY, cellZ);
      const cellEntities = this.spatialGrid.get(cellKey);

      if (cellEntities) {
        for (const entity of cellEntities) {
          entities.add(entity);
        }
      }
    }

    return entities;
  }

  /**
   * Perform raycast against a single entity
   */
  private raycastEntity(entity: Entity, origin: vec3, direction: vec3, maxDistance: number): {
    hit: boolean,
    position: vec3,
    normal: vec3,
    distance: number,
    entity: Entity | undefined,
    voxelValue: number | undefined
  } {
    // Simple sphere intersection test
    const entityToOrigin = vec3.sub(vec3.create(), entity.worldPosition, origin);
    const projection = vec3.dot(entityToOrigin, direction);

    // Skip if entity is behind the ray
    if (projection < 0) {
      return {
        hit: false,
        position: vec3.create(),
        normal: vec3.fromValues(0, 0, 1),
        distance: maxDistance,
        entity: undefined,
        voxelValue: undefined
      };
    }

    // Calculate closest point on ray to entity center
    const projectionPoint = vec3.scaleAndAdd(vec3.create(), origin, direction, projection);
    const distance = vec3.distance(projectionPoint, entity.worldPosition);

    // If distance is less than entity radius, we have a hit
    if (distance <= (entity.physics?.radius || 0.5) && projection < maxDistance) {
      // Calculate intersection point
      const distanceToIntersection = projection - Math.sqrt((entity.physics?.radius || 0.5) * (entity.physics?.radius || 0.5) - distance * distance);

      // Skip if too far
      if (distanceToIntersection > maxDistance) {
        return {
          hit: false,
          position: vec3.create(),
          normal: vec3.fromValues(0, 0, 1),
          distance: maxDistance,
          entity: undefined,
          voxelValue: undefined
        };
      }

      // Calculate hit position and normal
      const hitPosition = vec3.scaleAndAdd(vec3.create(), origin, direction, distanceToIntersection);
      const normal = vec3.subtract(vec3.create(), hitPosition, entity.worldPosition);
      vec3.normalize(normal, normal);

      return {
        hit: true,
        position: hitPosition,
        normal,
        distance: distanceToIntersection,
        entity,
        voxelValue: undefined
      };
    } return {
      hit: false,
      position: vec3.create(),
      normal: vec3.fromValues(0, 0, 1),
      distance: maxDistance,
      entity: undefined,
      voxelValue: undefined
    };
  }

  /**
   * Perform a raycast against terrain only using Digital Differential Analyzer (DDA) algorithm
   * @private
   */
  private raycastTerrain(origin: vec3, direction: vec3, maxDistance: number = 100): {
    hit: boolean,
    position: vec3,
    normal: vec3,
    distance: number,
    entity: Entity | undefined,
    voxelValue: number | undefined
  } {
    if (!this.level) {
      return {
        hit: false,
        position: vec3.create(),
        normal: vec3.fromValues(0, 0, 1),
        distance: maxDistance,
        entity: undefined,
        voxelValue: undefined
      };
    }

    const volume = this.level.volume;

    // Starting voxel coordinates
    let x = Math.floor(origin[0]);
    let y = Math.floor(origin[1]);
    let z = Math.floor(origin[2]);

    // Ray direction components
    const dx = direction[0];
    const dy = direction[1];
    const dz = direction[2];

    // Step direction for each axis
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    const stepZ = Math.sign(dz);

    // Avoid division by zero
    const dirX = 1.0 / (Math.abs(dx) < 0.0001 ? 0.0001 : dx);
    const dirY = 1.0 / (Math.abs(dy) < 0.0001 ? 0.0001 : dy);
    const dirZ = 1.0 / (Math.abs(dz) < 0.0001 ? 0.0001 : dz);

    // Distance to next voxel boundary
    const nextX = stepX > 0 ?
      (Math.ceil(origin[0]) - origin[0]) * dirX :
      (origin[0] - Math.floor(origin[0])) * dirX;
    const nextY = stepY > 0 ?
      (Math.ceil(origin[1]) - origin[1]) * dirY :
      (origin[1] - Math.floor(origin[1])) * dirY;
    const nextZ = stepZ > 0 ?
      (Math.ceil(origin[2]) - origin[2]) * dirZ :
      (origin[2] - Math.floor(origin[2])) * dirZ;

    // Distance along the ray
    let tMaxX = nextX;
    let tMaxY = nextY;
    let tMaxZ = nextZ;

    // Distance between voxel boundaries
    const tDeltaX = Math.abs(dirX);
    const tDeltaY = Math.abs(dirY);
    const tDeltaZ = Math.abs(dirZ);

    // Normal vector for hit surface
    const normal = vec3.create();

    // Traverse the volume until we hit something or exceed max distance
    let distance = 0;
    while (distance < maxDistance) {      // Check if current voxel is solid
      const voxelValue = volume.getVoxel(x, y, z);
      if (voxelValue !== volume.emptyValue) {
        // Calculate exact hit position
        const hitPos = vec3.scaleAndAdd(vec3.create(), origin, direction, distance);

        return {
          hit: true,
          position: hitPos,
          normal,
          distance,
          entity: undefined,
          voxelValue
        };
      }

      // Find the nearest voxel boundary
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        // X-axis traversal
        distance = tMaxX;
        tMaxX += tDeltaX;
        x += stepX;
        vec3.set(normal, -stepX, 0, 0); // Normal points opposite to step direction
      } else if (tMaxY < tMaxZ) {
        // Y-axis traversal
        distance = tMaxY;
        tMaxY += tDeltaY;
        y += stepY;
        vec3.set(normal, 0, -stepY, 0);
      } else {
        // Z-axis traversal
        distance = tMaxZ;
        tMaxZ += tDeltaZ;
        z += stepZ;
        vec3.set(normal, 0, 0, -stepZ);
      }

      // Check bounds
      if (x < 0 || y < 0 || z < 0 ||
        x >= volume.sizeX ||
        y >= volume.sizeY ||
        z >= volume.sizeZ) {
        break;
      }
    }    // No hit found within max distance
    return {
      hit: false,
      position: vec3.create(),
      normal: vec3.fromValues(0, 0, 1),
      distance: maxDistance,
      entity: undefined,
      voxelValue: undefined
    };
  }

  /**
   * Move entity with collision detection (sliding along surfaces)
   */
  moveWithCollisions(entity: Entity, displacement: vec3): vec3 {
    // Skip all collision handling if collisions disabled or player in godMode 
    // This allows godMode players to pass through terrain and entities
    // 'head' property identifies a player since we can't use instanceof
    const isPlayer = 'head' in entity;
    if (!entity.physics?.hasCollision || (isPlayer && (globalThis as any).godMode)) {
      vec3.add(entity.localPosition, entity.localPosition, displacement);
      entity.dirty = true;
      return displacement;
    }

    const originalPos = vec3.clone(entity.localPosition);
    const remainingMove = vec3.clone(displacement);
    const actualMove = vec3.create();

    // Try the full movement
    vec3.add(entity.localPosition, entity.localPosition, displacement);
    entity.dirty = true;

    // Resolve any collisions that occurred
    this.handleEntityCollisions(entity);
    this.handleTerrainCollisions(entity);

    // Calculate how far we actually moved
    vec3.subtract(actualMove, entity.localPosition, originalPos);

    return actualMove;
  }
  /**
   * Update the spatial grid used for optimizing collision detection
   * Uses numeric hash keys and incremental updates for better performance
   */
  private updateSpatialGrid(): void {
    if (!this.useGridOptimization) return;

    // Clear existing grid (full rebuild for now, could be optimized to incremental)
    this.spatialGrid.clear();

    // Add entities to grid cells based on their position
    for (const entity of Entity.all) {
      if (!entity.physics?.hasCollision || entity.parent) continue;

      const cellX = Math.floor(entity.worldPosition[0] / this.gridCellSize);
      const cellY = Math.floor(entity.worldPosition[1] / this.gridCellSize);
      const cellZ = Math.floor(entity.worldPosition[2] / this.gridCellSize);

      // Use numeric hash key for better performance (avoid string creation)
      const cellKey = this.spatialHash(cellX, cellY, cellZ);

      // Add entity to this cell
      if (!this.spatialGrid.has(cellKey)) {
        this.spatialGrid.set(cellKey, []);
      }
      this.spatialGrid.get(cellKey)?.push(entity);

      // For large entities, only add to immediately adjacent cells
      // Optimized: reduce from 27 cells to 7 cells for large entities
      if ((entity.physics?.radius || 0.5) > this.gridCellSize / 2) {
        const adjacentCells = [
          this.spatialHash(cellX + 1, cellY, cellZ),
          this.spatialHash(cellX - 1, cellY, cellZ),
          this.spatialHash(cellX, cellY + 1, cellZ),
          this.spatialHash(cellX, cellY - 1, cellZ),
          this.spatialHash(cellX, cellY, cellZ + 1),
          this.spatialHash(cellX, cellY, cellZ - 1)
        ];

        for (const neighborKey of adjacentCells) {
          if (!this.spatialGrid.has(neighborKey)) {
            this.spatialGrid.set(neighborKey, []);
          }
          this.spatialGrid.get(neighborKey)?.push(entity);
        }
      }
    }
  }

  /**
   * Generate a numeric hash for spatial grid coordinates
   * Much faster than string concatenation and comparison
   */
  private spatialHash(x: number, y: number, z: number): number {
    // Simple but effective hash function for 3D coordinates
    // Uses prime numbers to reduce collisions
    return ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0;
  }
  /**
   * Get potential collision candidates for an entity using optimized spatial partitioning
   */
  private getPotentialCollisionCandidates(entity: Entity): Entity[] {
    if (!this.useGridOptimization) {
      return Entity.all.filter(e => e !== entity && !e.parent && e.physics?.hasCollision);
    }

    // Get cell coordinates for this entity
    const cellX = Math.floor(entity.worldPosition[0] / this.gridCellSize);
    const cellY = Math.floor(entity.worldPosition[1] / this.gridCellSize);
    const cellZ = Math.floor(entity.worldPosition[2] / this.gridCellSize);

    // Check this cell and neighboring cells using numeric hash
    const candidates = new Set<Entity>();

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const hashKey = this.spatialHash(cellX + dx, cellY + dy, cellZ + dz);
          const cellEntities = this.spatialGrid.get(hashKey) || [];

          for (const other of cellEntities) {
            if (other !== entity && other.physics?.hasCollision && !other.parent) {
              candidates.add(other);
            }
          }
        }
      }
    }

    return Array.from(candidates);
  }
  /**
   * Generate a consistent key for entity pairs in collision cache
   */
  private getEntityPairKey(entityA: Entity, entityB: Entity): string {
    // Ensure consistent ordering to avoid duplicate cache entries
    const idA = entityA.id;
    const idB = entityB.id;
    return idA < idB ? `${idA}-${idB}` : `${idB}-${idA}`;
  }

  /**
   * Clean old entries from collision cache to prevent memory leaks
   */
  private cleanCollisionCache(currentTime: number): void {
    for (const [key, timestamp] of this.collisionPairCache.entries()) {
      if (currentTime - timestamp > this.collisionCacheTimeout * 2) {
        this.collisionPairCache.delete(key);
      }
    }
  }
  /**
   * Get performance metrics for debugging and optimization
   */
  getPerformanceMetrics() {
    const now = Date.now();
    const elapsed = now - this.performanceMetrics.lastResetTime;

    return {
      ...this.performanceMetrics,
      collisionChecksPerSecond: elapsed > 0 ? (this.performanceMetrics.collisionChecks * 1000) / elapsed : 0,
      collisionHitRate: this.performanceMetrics.collisionChecks > 0 ?
        this.performanceMetrics.collisionHits / this.performanceMetrics.collisionChecks : 0
    };
  }
  /**
   * Reset performance metrics
   */
  resetPerformanceMetrics(): void {
    this.performanceMetrics = {
      collisionChecks: 0,
      collisionHits: 0,
      raycastCount: 0,
      gridUpdateTime: 0,
      lastResetTime: Date.now()
    };
  }  /**
   * Set physics quality level
   */
  setQualityLevel(level: 'low' | 'medium' | 'high'): void {
    // Adjust physics settings based on quality level
    switch (level) {
      case 'low':
        // Low quality physics - performance optimized
        const lowConfig = this.config.getPhysicsConfigForQuality('low');
        this.gridCellSize = 8; // Larger cells = fewer checks
        this.useGridOptimization = true;
        this.gridUpdateInterval = lowConfig.gridUpdateInterval!;
        this.collisionCacheTimeout = lowConfig.collisionCacheTimeout!;
        this.updateConfig({ qualityLevel: level });
        break;

      case 'medium':
        // Medium quality physics - balanced
        const mediumConfig = this.config.getPhysicsConfigForQuality('medium');
        this.gridCellSize = this.config.getPhysicsConfig().gridCellSize;
        this.useGridOptimization = true;
        this.gridUpdateInterval = mediumConfig.gridUpdateInterval!;
        this.collisionCacheTimeout = mediumConfig.collisionCacheTimeout!;
        this.updateConfig({ qualityLevel: level });
        break;

      case 'high':
        // High quality physics - focus on accuracy
        const highConfig = this.config.getPhysicsConfigForQuality('high');
        this.gridCellSize = 3; // Smaller cells = more checks but more accurate
        this.useGridOptimization = true;
        this.gridUpdateInterval = 16; // ~60fps updates
        this.collisionCacheTimeout = highConfig.collisionCacheTimeout!;
        this.updateConfig({ qualityLevel: level }); break;
    }
    console.log(`Physics quality set to ${level}, grid update interval: ${this.gridUpdateInterval}ms`);
  }
  /**
   * Limit the number of active physics entities when needed
   * This prioritizes entities closest to the player
   */
  limitActiveEntities(playerEntity?: Entity): void {
    const physicsConfig = this.config.getPhysicsConfig();
    const maxEntities = physicsConfig.maxEntities || 100;
    const physicsEntities = Entity.all.filter(e => (e.physics?.hasGravity || e.physics?.hasCollision) && !e.parent);

    if (physicsEntities.length <= maxEntities) {
      return; // No need to limit
    }

    // Sort entities by distance to player if available, otherwise use a different criteria
    if (playerEntity) {
      physicsEntities.sort((a, b) => {
        const distA = vec3.distance(a.worldPosition, playerEntity.worldPosition);
        const distB = vec3.distance(b.worldPosition, playerEntity.worldPosition);
        return distA - distB;
      });
    }

    // Temporarily disable physics for entities beyond the limit
    for (let i = maxEntities; i < physicsEntities.length; i++) {
      const entity = physicsEntities[i];
      if (entity.physics) {
        // Store original values and disable physics
        (entity as any)._tempGravity = entity.physics.hasGravity;
        (entity as any)._tempCollision = entity.physics.hasCollision;
        entity.physics.hasGravity = false;
        entity.physics.hasCollision = false;
      }
    }
    if (this.debugEnabled) {
      console.log(`Limited active physics entities to ${maxEntities}/${physicsEntities.length}`);
    }
  }

  /**
   * Reset temporary physics limitations
   */
  resetEntityLimits(): void {
    for (const entity of Entity.all) {
      if ('_tempGravity' in entity && (entity as any)._tempGravity !== undefined) {
        if (entity.physics) {
          entity.physics.hasGravity = (entity as any)._tempGravity;
        }
        delete (entity as any)._tempGravity;
      }

      if ('_tempCollision' in entity && (entity as any)._tempCollision !== undefined) {
        if (entity.physics) {
          entity.physics.hasCollision = (entity as any)._tempCollision;
        }
        delete (entity as any)._tempCollision;
      }
    }
  }
}

// Export singleton instance
export const physicsSystem = PhysicsSystem.getInstance();
