import { vec3, quat, mat4 } from 'gl-matrix';
import { Entity } from './Entity';
import type { WeaponData, WeaponSwing, WeaponType } from './types/index';
import { getConfig } from './Config';

export class Weapon extends Entity {
  weaponData: WeaponData;
  wielder: Entity | null = null;
  swing: WeaponSwing = {
    isSwinging: false,
    startTime: 0,
    duration: 0,
    progress: 0,
    hasHit: false,
    targetPosition: vec3.create()
  };

  // Weapon attachment offsets
  private restPosition: vec3 = vec3.fromValues(0.3, 0.1, -0.2);
  private restRotation: quat = quat.fromEuler(quat.create(), 0, 45, 0);
  private swingStartRotation: quat = quat.create();
  private swingEndRotation: quat = quat.create();
  constructor(weaponData: WeaponData) {
    super();
    this.weaponData = weaponData;
    this.modelId = globalThis.modelNames?.indexOf(weaponData.modelName) ?? -1;
    
    // Initialize swing rotations
    quat.fromEuler(this.swingStartRotation, -30, 45, 10);  // Ready position
    quat.fromEuler(this.swingEndRotation, 60, -15, -30);   // End swing position
  }

  attachToEntity(entity: Entity): void {
    this.wielder = entity;
    this.parent = entity;
    entity.children.push(this);
    
    // Set initial position and rotation
    vec3.copy(this.localPosition, this.restPosition);
    quat.copy(this.localRotation, this.restRotation);
    this.dirty = true;
  }

  detachFromEntity(): void {
    if (this.wielder && this.parent) {
      const index = this.parent.children.indexOf(this);
      if (index > -1) {
        this.parent.children.splice(index, 1);
      }
    }
    this.wielder = null;
    this.parent = null;
    this.dirty = true;
  }
  startSwing(targetPosition?: vec3): boolean {
    if (this.swing.isSwinging) return false;

    this.swing.isSwinging = true;
    this.swing.startTime = performance.now();
    this.swing.duration = this.weaponData.swingDuration;
    this.swing.progress = 0;
    this.swing.hasHit = false;

    if (targetPosition) {
      vec3.copy(this.swing.targetPosition, targetPosition);
    } else {
      // Default swing direction (forward from wielder)
      vec3.set(this.swing.targetPosition, 0, 1, 0);
      if (this.wielder) {
        vec3.transformQuat(this.swing.targetPosition, this.swing.targetPosition, this.wielder.worldRotation);
        vec3.add(this.swing.targetPosition, this.wielder.worldPosition, this.swing.targetPosition);
      }
    }

    // Enhanced feedback
    console.log(`⚔️ Starting ${this.weaponData.name} swing! Duration: ${this.weaponData.swingDuration}ms`);

    return true;
  }

  update(elapsed: number): void {
    super.update(elapsed);

    if (!this.swing.isSwinging) return;

    const now = performance.now();
    this.swing.progress = Math.min(1, (now - this.swing.startTime) / this.swing.duration);

    // Update weapon rotation during swing
    this.updateSwingAnimation();

    // Check for hit during swing peak (around 60% progress)
    if (!this.swing.hasHit && this.swing.progress >= 0.4 && this.swing.progress <= 0.8) {
      this.checkForHits();
    }

    // End swing
    if (this.swing.progress >= 1) {
      this.endSwing();
    }
  }

  private updateSwingAnimation(): void {
    if (!this.wielder) return;

    // Use easing function for more natural swing motion
    const easedProgress = this.easeInOutQuad(this.swing.progress);
    
    // Interpolate between rest, swing start, swing end, and back to rest
    let targetRotation = quat.create();
    
    if (easedProgress < 0.3) {
      // Move to swing start position
      const t = easedProgress / 0.3;
      quat.slerp(targetRotation, this.restRotation, this.swingStartRotation, t);
    } else if (easedProgress < 0.7) {
      // Main swing motion
      const t = (easedProgress - 0.3) / 0.4;
      quat.slerp(targetRotation, this.swingStartRotation, this.swingEndRotation, t);
    } else {
      // Return to rest position
      const t = (easedProgress - 0.7) / 0.3;
      quat.slerp(targetRotation, this.swingEndRotation, this.restRotation, t);
    }

    quat.copy(this.localRotation, targetRotation);
    this.dirty = true;
  }

  private checkForHits(): void {
    if (!this.wielder || this.swing.hasHit) return;

    const attackOrigin = vec3.clone(this.wielder.worldPosition);
    attackOrigin[2] += this.wielder.height * 0.7; // Attack from chest height

    const attackDirection = vec3.create();
    vec3.subtract(attackDirection, this.swing.targetPosition, attackOrigin);
    vec3.normalize(attackDirection, attackDirection);

    // Check for entities within weapon range
    for (const entity of Entity.all) {
      if (entity === this.wielder || entity === this || entity.parent === this.wielder) continue;

      const distance = vec3.distance(attackOrigin, entity.worldPosition);
      if (distance > this.weaponData.range) continue;

      // Check if entity is in the swing arc
      const toEntity = vec3.create();
      vec3.subtract(toEntity, entity.worldPosition, attackOrigin);
      vec3.normalize(toEntity, toEntity);

      const dot = vec3.dot(attackDirection, toEntity);
      const angleThreshold = Math.cos(Math.PI / 6); // 30 degrees arc

      if (dot >= angleThreshold) {
        this.hitEntity(entity, attackOrigin, attackDirection);
        this.swing.hasHit = true;
        break; // Only hit one entity per swing
      }
    }
  }

  private hitEntity(target: Entity, attackOrigin: vec3, attackDirection: vec3): void {
    // Create combat event
    const combatEvent = {
      type: 'hit' as const,
      source: this.wielder,
      target: target,
      damage: this.weaponData.damage,
      position: vec3.clone(target.worldPosition),
      weaponId: this.weaponData.id
    };

    // Apply damage if target has combat stats
    if ('combatStats' in target && target.combatStats) {
      const stats = target.combatStats as any;
      const actualDamage = Math.max(1, this.weaponData.damage - (stats.defense || 0));
      stats.health = Math.max(0, stats.health - actualDamage);
      stats.lastDamageTime = performance.now();

      if (stats.health <= 0 && !stats.isDead) {
        stats.isDead = true;
        // Trigger death event
        this.onEntityDeath(target);
      }

      // Apply knockback
      const knockback = vec3.create();
      vec3.scale(knockback, attackDirection, actualDamage * 0.5);
      if ('vel' in target && target.vel) {
        vec3.add(target.vel as vec3, target.vel as vec3, knockback);
      }
    }

    // Dispatch combat event for UI/effects
    this.dispatchCombatEvent(combatEvent);
  }

  private onEntityDeath(entity: Entity): void {
    // Override in subclasses or add to combat system
    console.log(`Entity ${entity.id} was defeated!`);
  }

  private dispatchCombatEvent(event: any): void {
    // For now, just log. Later can be extended for UI feedback, sound effects, etc.
    console.log('Combat Event:', event);
  }

  private endSwing(): void {
    this.swing.isSwinging = false;
    this.swing.progress = 0;
    this.swing.hasHit = false;
    
    // Return to rest position
    quat.copy(this.localRotation, this.restRotation);
    this.dirty = true;
  }

  private easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  canAttack(): boolean {
    return !this.swing.isSwinging;
  }

  getAttackCooldown(): number {
    return 1000 / this.weaponData.attackSpeed;
  }
}

// Predefined weapon configurations
export const WeaponConfigs = {
  IRON_SWORD: {
    id: 'iron_sword',
    name: 'Iron Sword',
    damage: 25,
    range: 2.0,
    attackSpeed: 1.5,
    swingDuration: 400,
    modelName: 'sword'
  },
  BATTLE_AXE: {
    id: 'battle_axe',
    name: 'Battle Axe',
    damage: 40,
    range: 2.2,
    attackSpeed: 1.0,
    swingDuration: 600,
    modelName: 'axe'
  },  WAR_HAMMER: {
    id: 'war_hammer',
    name: 'War Hammer',
    damage: getConfig().getCombatConfig().defaultWeaponDamage,
    range: 2.5,
    attackSpeed: 0.8,
    swingDuration: 700,
    modelName: 'hammer'
  }
} as const;
