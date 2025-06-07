import { vec3 } from 'gl-matrix';
import { Entity, PhysicsLayer } from './Entity';
import { Player } from './Player';
import { Level } from './Level';
import type { CollisionEvent, CollisionCallback } from './types/index';

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
  private level: Level | null = null;
  // Default physics configuration
  private config: PhysicsConfig = {
    gravity: 9.8,
    maxVelocity: 100,
    jumpForce: 5,
    friction: 0.2,
    airResistance: 0.01,
    collisionBounce: 0.3,
    entityCollisionEnabled: true,
    terrainCollisionEnabled: true,
    qualityLevel: 'medium',
    maxEntities: 100,
    spatialOptimization: true
  };

  private frameCount: number = 0;
  private lastReportTime: number = 0;
  private debugEnabled: boolean = false;

  private collisionListeners: Map<Entity, CollisionCallback> = new Map();
  private globalCollisionListeners: CollisionCallback[] = [];

  private spatialGrid: Map<string, Entity[]> = new Map();
  private gridCellSize: number = 5;
  private useGridOptimization: boolean = true;

  private constructor() { }

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
          entity.localPosition[2] = floorZ + entity.radius + 0.001;
        }
        entity.dirty = true;
        // Update worldPosition
        entity.updateTransforms(null);
        // Zero vertical velocity after snapping
        entity.vel[2] = 0;
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
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current physics configuration
   */
  getConfig(): PhysicsConfig {
    return { ...this.config };
  }

  /**
   * Main physics update function, called each frame
   */
  update(elapsed: number): void {
    const dt = elapsed / 1000; // Convert ms to seconds

    // Update spatial grid for optimization
    this.updateSpatialGrid();

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
    this.applyFriction(entity, dt);

    // Apply velocity constraints
    this.constrainVelocity(entity);

    // Apply velocity to position
    this.applyVelocity(entity, dt);
    // Handle collisions
    if (entity.collision) {
      // Entity-entity collisions
      if (this.config.entityCollisionEnabled) {
        this.handleEntityCollisions(entity);
      }

      // Terrain collisions
      if (this.config.terrainCollisionEnabled) {
        this.handleTerrainCollisions(entity);
      }
    }
  }  /**
   * Apply gravity to an entity
   */
  private applyGravity(entity: Entity, dt: number): void {
    // Skip gravity for godMode players - 'head' property identifies a player since we can't use instanceof
    const isPlayer = 'head' in entity;
    if (entity.gravity && !(isPlayer && (globalThis as any).godMode)) {
      // CRITICAL: Only apply gravity when level is fully loaded to prevent race condition
      // During level loading, isEntityOnGround returns false, causing entities to accumulate downward velocity
      if (!this.level || !this.level.isFullyLoaded) {
        if (this.debugEnabled && isPlayer) {
          console.log('🛡️ Gravity skipped - level not fully loaded (preventing race condition)');
        }
        return; // Skip gravity application until terrain collision data is ready
      }

      const onGround = this.isEntityOnGround(entity);      if (!onGround) {
        const oldVel = entity.vel[2];
        entity.vel[2] -= this.config.gravity * dt;
      } else if (entity.vel[2] < 0) {
        // Stop falling when on ground
        if (this.debugEnabled && isPlayer && entity.vel[2] < -0.1) {
          console.log(`🛑 Landing - velocity stopped: ${entity.vel[2].toFixed(3)} → 0`);
        }
        entity.vel[2] = 0;
      }
    }
  }

  /**
   * Apply friction and air resistance to an entity
   */
  private applyFriction(entity: Entity, dt: number): void {
    // Skip if no velocity
    const speed = vec3.length(entity.vel);
    if (speed <= 0.001) {
      vec3.zero(entity.vel);
      return;
    }

    // Determine if entity is on ground
    const onGround = this.isEntityOnGround(entity);

    // Apply appropriate resistance based on ground contact
    const resistanceFactor = onGround ? this.config.friction : this.config.airResistance;

    // Calculate resistance force
    const resistanceStrength = resistanceFactor * dt;

    // Apply resistance (with limits to avoid oscillation)
    if (resistanceStrength >= 1) {
      // Full stop if resistance would reverse direction
      vec3.zero(entity.vel);
    } else {
      // Apply percentage-based velocity reduction
      vec3.scale(entity.vel, entity.vel, 1 - resistanceStrength);

      // Zero out very small velocities to avoid jittering
      if (vec3.length(entity.vel) < 0.01) {
        vec3.zero(entity.vel);
      }
    }
  }

  /**
   * Apply velocity constraints (max speed)
   */
  private constrainVelocity(entity: Entity): void {
    const speed = vec3.length(entity.vel);
    if (speed > this.config.maxVelocity) {
      vec3.normalize(entity.vel, entity.vel);
      vec3.scale(entity.vel, entity.vel, this.config.maxVelocity);
    }
  }

  /**
   * Apply velocity to position
   */
  private applyVelocity(entity: Entity, dt: number): void {
    const speed = vec3.length(entity.vel);
    if (speed > 0) {
      vec3.scaleAndAdd(entity.localPosition, entity.localPosition, entity.vel, dt);
      entity.dirty = true;
    }
  }
  /**
   * Handle entity-entity collisions
   */  private handleEntityCollisions(entity: Entity): void {
    // Skip entity collision for players in godMode - 'head' property identifies a player
    const isPlayer = 'head' in entity;
    if (isPlayer && (globalThis as any).godMode) return;

    const potentialColliders = this.getPotentialCollisionCandidates(entity);

    for (const otherEntity of potentialColliders) {      // Skip self, non-collidable entities, and parent/children
      if (
        entity === otherEntity ||
        otherEntity.parent === entity ||
        entity.parent === otherEntity ||
        !otherEntity.collision ||
        otherEntity.spawn ||
        !entity.canCollideWith(otherEntity) ||
        // Skip collision if other entity is a player in godMode
        ('head' in otherEntity && (globalThis as any).godMode)
      ) {
        continue;
      }

      const displacement = vec3.sub(vec3.create(), otherEntity.localPosition, entity.localPosition);
      const distance = vec3.length(displacement);
      const minDistance = entity.radius + otherEntity.radius;

      // Check for collision
      if (distance < minDistance) {
        this.resolveEntityCollision(entity, otherEntity, displacement, distance, minDistance);
      }
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
    // Calculate penetration depth
    const penetration = minDistance - distance;

    // Get the collision normal
    const normal = vec3.normalize(vec3.create(), displacement);

    // Resolve positions - if one entity is larger, it pushes the smaller one more
    if (entity.radius >= otherEntity.radius) {
      // Push the other entity away
      vec3.scaleAndAdd(otherEntity.localPosition, otherEntity.localPosition, normal, penetration);
      otherEntity.dirty = true;
    }

    // Always move the current entity away
    vec3.scaleAndAdd(entity.localPosition, entity.localPosition, normal, -penetration);
    entity.dirty = true;

    // Calculate relative velocity and impact force
    let relativeVelocity = 0;
    let impulse = 0;

    // Apply bounce effect if configured
    if (this.config.collisionBounce > 0) {
      // Only apply bounce if entities have velocity
      if (entity.vel && otherEntity.vel) {
        // Calculate relative velocity along normal
        const v1 = vec3.dot(entity.vel, normal);
        const v2 = vec3.dot(otherEntity.vel, normal);
        relativeVelocity = v1 - v2;

        // Skip bounce if objects are already moving away from each other
        if (v1 <= v2) return;

        // Calculate impulse with elasticity (bounce)
        const bounce = this.config.collisionBounce;
        impulse = (1 + bounce) * relativeVelocity / 2; // Simplified for equal mass

        // Apply impulse in opposite directions
        vec3.scaleAndAdd(entity.vel, entity.vel, normal, -impulse);
        vec3.scaleAndAdd(otherEntity.vel, otherEntity.vel, normal, impulse);
      }
    }

    // Dispatch collision events for both entities
    const collisionPosition = vec3.create();
    vec3.scaleAndAdd(collisionPosition, entity.worldPosition, normal, -entity.radius);

    // Event for first entity
    this.dispatchCollisionEvent({
      type: 'entity',
      entity: entity,
      otherEntity: otherEntity,
      position: vec3.clone(collisionPosition),
      normal: vec3.clone(normal).map(v => -v) as vec3, // Flip normal for first entity
      velocity: vec3.clone(entity.vel),
      force: Math.abs(relativeVelocity)
    });

    // Event for second entity
    this.dispatchCollisionEvent({
      type: 'entity',
      entity: otherEntity,
      otherEntity: entity,
      position: vec3.clone(collisionPosition),
      normal: vec3.clone(normal),
      velocity: vec3.clone(otherEntity.vel),
      force: Math.abs(relativeVelocity)
    });
  }  /**
   * Handle entity-terrain collisions
   */  private handleTerrainCollisions(entity: Entity): void {
    if (!this.level || !this.level.isFullyLoaded) return;

    // Skip terrain collision for players in godMode - 'head' property identifies a player
    const isPlayer = 'head' in entity;
    if (isPlayer && (globalThis as any).godMode) return;

    const r = entity.radius;
    const h = entity.height;
    const pos = entity.localPosition;
    // X-axis collision (left)
    if (this.level.volume.getVoxelFloor(pos[0] - r, pos[1], pos[2] + h / 2)) {
      pos[0] = Math.ceil(pos[0] - r) + r;

      // Apply bounce if configured and moving leftward
      if (this.config.collisionBounce > 0 && entity.vel[0] < 0) {
        entity.vel[0] = -entity.vel[0] * this.config.collisionBounce;
      } else {
        entity.vel[0] = 0;
      }

      entity.dirty = true;
    }

    // X-axis collision (right)
    if (this.level.volume.getVoxelFloor(pos[0] + r, pos[1], pos[2] + h / 2)) {
      pos[0] = Math.floor(pos[0] + r) - r;

      // Apply bounce if configured and moving rightward
      if (this.config.collisionBounce > 0 && entity.vel[0] > 0) {
        entity.vel[0] = -entity.vel[0] * this.config.collisionBounce;
      } else {
        entity.vel[0] = 0;
      }

      entity.dirty = true;
    }

    // Y-axis collision (back)
    if (this.level.volume.getVoxelFloor(pos[0], pos[1] - r, pos[2] + h / 2)) {
      pos[1] = Math.ceil(pos[1] - r) + r;

      // Apply bounce if configured and moving backward
      if (this.config.collisionBounce > 0 && entity.vel[1] < 0) {
        entity.vel[1] = -entity.vel[1] * this.config.collisionBounce;
      } else {
        entity.vel[1] = 0;
      }

      entity.dirty = true;
    }

    // Y-axis collision (front)
    if (this.level.volume.getVoxelFloor(pos[0], pos[1] + r, pos[2] + h / 2)) {
      pos[1] = Math.floor(pos[1] + r) - r;

      // Apply bounce if configured and moving forward
      if (this.config.collisionBounce > 0 && entity.vel[1] > 0) {
        entity.vel[1] = -entity.vel[1] * this.config.collisionBounce;
      } else {
        entity.vel[1] = 0;
      }

      entity.dirty = true;
    }    // Z-axis collision (bottom)
    if (this.level.volume.getVoxelFloor(pos[0], pos[1], pos[2])) {
      const oldVelocity = vec3.clone(entity.vel);
      const impactForce = Math.abs(entity.vel[2]);
      const collisionPoint = vec3.fromValues(pos[0], pos[1], Math.floor(pos[2]));

      pos[2] = Math.ceil(pos[2]);

      // Apply bounce if configured and moving downward
      if (this.config.collisionBounce > 0 && entity.vel[2] < 0) {
        entity.vel[2] = -entity.vel[2] * this.config.collisionBounce;

        // Stop if bounce is very small
        if (Math.abs(entity.vel[2]) < 0.1) {
          entity.vel[2] = 0;
        }
      } else {
        entity.vel[2] = 0;
      }

      entity.dirty = true;

      // Dispatch collision event
      this.dispatchCollisionEvent({
        type: 'terrain',
        entity: entity,
        position: collisionPoint,
        normal: vec3.fromValues(0, 0, 1), // Bottom collision normal points up
        velocity: oldVelocity,
        force: impactForce
      });
    }

    // Z-axis collision (top)
    if (this.level.volume.getVoxelFloor(pos[0], pos[1], pos[2] + h)) {
      pos[2] = Math.floor(pos[2] + h) - h;

      // Apply bounce if configured and moving upward
      if (this.config.collisionBounce > 0 && entity.vel[2] > 0) {
        entity.vel[2] = -entity.vel[2] * this.config.collisionBounce;
      } else {
        entity.vel[2] = 0;
      }

      entity.dirty = true;
    }
  }  /**
   * Check if an entity is on the ground
   */  isEntityOnGround(entity: Entity): boolean {
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
    if (entity.gravity && this.isEntityOnGround(entity)) {
      entity.vel[2] += this.config.jumpForce;
      return true;
    }
    return false;
  }

  /**
   * Apply movement input to entity velocity
   */
  applyMovement(entity: Entity, direction: vec3, speed: number): void {
    vec3.scaleAndAdd(entity.vel, entity.vel, direction, speed);
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
    return Entity.all.filter(e => e.gravity || e.collision).length;
  }

  /**
   * Get a debug status report of the physics system
   */
  getDebugStatus(): string {
    const physicsEntities = Entity.all.filter(e => e.gravity || e.collision);
    const collisionEntities = Entity.all.filter(e => e.collision);
    const gravityEntities = Entity.all.filter(e => e.gravity);

    return `Physics: ${physicsEntities.length} entities | ` +
      `Collision: ${collisionEntities.length} | ` +
      `Gravity: ${gravityEntities.length} | ` +
      `FPS: ${Math.round(this.frameCount / ((performance.now() - this.lastReportTime) / 1000))}`;
  }

  /**
   * Log debug information periodically
   */  private logDebugInfo(): void {
    if (!this.debugEnabled) return;

    this.frameCount++;

    // Report stats every second
    if (performance.now() - this.lastReportTime > 1000) {
      console.debug(this.getDebugStatus());
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
    if (options.hasGravity !== undefined) {
      entity.gravity = options.hasGravity;
    }

    if (options.hasCollision !== undefined) {
      entity.collision = options.hasCollision;
    }

    if (options.radius !== undefined) {
      entity.radius = options.radius;
    }

    if (options.height !== undefined) {
      entity.height = options.height;
    }

    if (options.layer !== undefined) {
      entity.physicsLayer = options.layer;
    }

    if (options.collidesWith !== undefined) {
      entity.collidesWith = options.collidesWith;
    }

    entity.dirty = true;
  }

  /**
   * Set the velocity of an entity directly
   */
  setVelocity(entity: Entity, x: number, y: number, z: number): void {
    vec3.set(entity.vel, x, y, z);
    this.constrainVelocity(entity);
  }

  /**
   * Add velocity to an entity (useful for impulses, explosions, etc.)
   */
  addVelocity(entity: Entity, x: number, y: number, z: number): void {
    vec3.add(entity.vel, entity.vel, vec3.fromValues(x, y, z));
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
      // Skip entities without velocity
      if (!('vel' in entity)) continue;

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
      vec3.scaleAndAdd(entity.vel, entity.vel, direction, strength);

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
  }

  /**
   * Perform a raycast against terrain and entities
   */  raycast(origin: vec3, direction: vec3, maxDistance: number = 100,
    options: { ignoreTerrain?: boolean, ignoreEntities?: boolean, ignoreEntity?: Entity } = {}
  ): {
    hit: boolean,
    position: vec3,
    normal: vec3,
    distance: number,
    entity: Entity | undefined,
    voxelValue: number | undefined
  } {
    const normalizedDir = vec3.normalize(vec3.create(), direction);
    let closestHit = {
      hit: false,
      position: vec3.create(),
      normal: vec3.fromValues(0, 0, 1),
      distance: maxDistance,
      entity: undefined as Entity | undefined,
      voxelValue: undefined as number | undefined
    };

    // Check entities first
    if (!options.ignoreEntities) {
      for (const entity of Entity.all) {
        // Skip entities without collision, parent entities, or the ignored entity
        if (!entity.collision || entity.parent || entity === options.ignoreEntity) continue;

        // Simple sphere intersection test
        const entityToOrigin = vec3.sub(vec3.create(), entity.worldPosition, origin);
        const projection = vec3.dot(entityToOrigin, normalizedDir);

        // Skip if entity is behind the ray
        if (projection < 0) continue;

        // Calculate closest point on ray to entity center
        const projectionPoint = vec3.scaleAndAdd(vec3.create(), origin, normalizedDir, projection);
        const distance = vec3.distance(projectionPoint, entity.worldPosition);

        // If distance is less than entity radius, we have a hit
        if (distance <= entity.radius && projection < closestHit.distance) {
          // Calculate intersection point
          const distanceToIntersection = projection - Math.sqrt(entity.radius * entity.radius - distance * distance);

          // Skip if too far
          if (distanceToIntersection > maxDistance) continue;

          // Update closest hit
          closestHit.hit = true;
          closestHit.distance = distanceToIntersection;

          // Calculate hit position and normal
          vec3.scaleAndAdd(closestHit.position, origin, normalizedDir, distanceToIntersection);

          // Calculate normal from the hit position to the entity center
          vec3.subtract(closestHit.normal, closestHit.position, entity.worldPosition);
          vec3.normalize(closestHit.normal, closestHit.normal);

          closestHit.entity = entity;
        }
      }
    }

    // Check terrain intersection if we have a level and terrain checks are enabled
    if (!options.ignoreTerrain && this.level) {
      const terrainHit = this.raycastTerrain(origin, normalizedDir, maxDistance);      // If we hit terrain and it's closer than any entity hit, use the terrain hit
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
   * Perform a raycast against terrain only using Digital Differential Analyzer (DDA) algorithm
   * @private
   */  private raycastTerrain(origin: vec3, direction: vec3, maxDistance: number = 100): {
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
   */  moveWithCollisions(entity: Entity, displacement: vec3): vec3 {
    // Skip all collision handling if collisions disabled or player in godMode 
    // This allows godMode players to pass through terrain and entities
    // 'head' property identifies a player since we can't use instanceof
    const isPlayer = 'head' in entity;
    if (!entity.collision || (isPlayer && (globalThis as any).godMode)) {
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
   */
  private updateSpatialGrid(): void {
    if (!this.useGridOptimization) return;

    // Clear existing grid
    this.spatialGrid.clear();

    // Add entities to grid cells based on their position
    for (const entity of Entity.all) {
      if (!entity.collision || entity.parent) continue;

      const cellX = Math.floor(entity.worldPosition[0] / this.gridCellSize);
      const cellY = Math.floor(entity.worldPosition[1] / this.gridCellSize);
      const cellZ = Math.floor(entity.worldPosition[2] / this.gridCellSize);

      // Create hash key for this cell
      const cellKey = `${cellX},${cellY},${cellZ}`;

      // Add entity to this cell
      if (!this.spatialGrid.has(cellKey)) {
        this.spatialGrid.set(cellKey, []);
      }
      this.spatialGrid.get(cellKey)?.push(entity);

      // Also add to neighboring cells if the entity is large 
      if (entity.radius > this.gridCellSize / 2) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              if (dx === 0 && dy === 0 && dz === 0) continue;

              const neighborKey = `${cellX + dx},${cellY + dy},${cellZ + dz}`;
              if (!this.spatialGrid.has(neighborKey)) {
                this.spatialGrid.set(neighborKey, []);
              }
              this.spatialGrid.get(neighborKey)?.push(entity);
            }
          }
        }
      }
    }
  }

  /**
   * Get potential collision candidates for an entity using spatial partitioning
   */
  private getPotentialCollisionCandidates(entity: Entity): Entity[] {
    if (!this.useGridOptimization) {
      return Entity.all.filter(e => e !== entity && !e.parent && e.collision);
    }

    // Get cell coordinates for this entity
    const cellX = Math.floor(entity.worldPosition[0] / this.gridCellSize);
    const cellY = Math.floor(entity.worldPosition[1] / this.gridCellSize);
    const cellZ = Math.floor(entity.worldPosition[2] / this.gridCellSize);

    // Check this cell and neighboring cells
    const candidates = new Set<Entity>();

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${cellX + dx},${cellY + dy},${cellZ + dz}`;
          const cellEntities = this.spatialGrid.get(key) || [];

          for (const other of cellEntities) {
            if (other !== entity && other.collision && !other.parent) {
              candidates.add(other);
            }
          }
        }
      }
    }

    return Array.from(candidates);
  }

  /**
   * Set physics quality level
   */
  setQualityLevel(level: 'low' | 'medium' | 'high'): void {
    const config = { ...this.config, qualityLevel: level };

    // Adjust physics settings based on quality level
    switch (level) {
      case 'low':
        // Low quality physics - focus on performance
        config.maxEntities = 50;
        config.spatialOptimization = true;
        this.gridCellSize = 10; // Larger cells = fewer checks but less accurate
        this.useGridOptimization = true;
        break;

      case 'medium':
        // Medium quality physics - balanced
        config.maxEntities = 100;
        config.spatialOptimization = true;
        this.gridCellSize = 5;
        this.useGridOptimization = true;
        break;

      case 'high':
        // High quality physics - focus on accuracy
        config.maxEntities = 200;
        config.spatialOptimization = true;
        this.gridCellSize = 3; // Smaller cells = more checks but more accurate
        this.useGridOptimization = true;
        break;
    }
    this.updateConfig(config);
    console.log(`Physics quality set to ${level}`);
  }

  /**
   * Limit the number of active physics entities when needed
   * This prioritizes entities closest to the player
   */
  limitActiveEntities(playerEntity?: Entity): void {
    const maxEntities = this.config.maxEntities || 100;
    const physicsEntities = Entity.all.filter(e => (e.gravity || e.collision) && !e.parent);

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
      entity._tempGravity = entity.gravity;
      entity._tempCollision = entity.collision;
      entity.gravity = false;
      entity.collision = false;
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
      if ('_tempGravity' in entity && entity._tempGravity !== undefined) {
        entity.gravity = entity._tempGravity;
        delete entity._tempGravity;
      }

      if ('_tempCollision' in entity && entity._tempCollision !== undefined) {
        entity.collision = entity._tempCollision;
        delete entity._tempCollision;
      }
    }
  }
}

// Export singleton instance
export const physicsSystem = PhysicsSystem.getInstance();
