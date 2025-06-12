import { vec3, quat } from 'gl-matrix';
import { Component } from './Component';
import type { Model } from '../Model';
import type { WeaponData, WeaponSwing } from '../types/index';
import { getConfig } from '../Config.js';
import { gameResources } from '../GameResources.js';

/**
 * Default weapon positioning configurations for first-person view
 */
export const WeaponPositionConfigs: Record<string, {
  position: [number, number, number],
  restRotation: [number, number, number],
  attackStartRotation: [number, number, number],
  attackEndRotation: [number, number, number],
  scale?: number
}> = {
  DEFAULT: {
    position: [0.3, 0.3, -0.15],
    restRotation: [-20, 230, 0],
    attackStartRotation: [-30, 180, 20],
    attackEndRotation: [50, 270, -40],
    scale: 1.0
  },
  sword: {
    position: [0.16, 0.19, -0.20],
    restRotation: [-10, 0, 25],
    attackStartRotation: [-120, 0, 25],
    attackEndRotation: [-10, 0, 25],
    scale: 1.0
  },
  axe: {
    position: [0.16, 0.19, -0.20],
    restRotation: [-10, 0, 25],
    attackStartRotation: [-120, 0, 25],
    attackEndRotation: [-10, 0, 25],
    scale: 0.25
  },
  hammer: {
    position: [0.16, 0.19, -0.20],
    restRotation: [-10, 0, 25],
    attackStartRotation: [-120, 0, 25],
    attackEndRotation: [-10, 0, 25],
    scale: 0.75
  }
};

/**
 * Component that handles weapon functionality for entities
 * Manages first-person weapon display, animations, and weapon switching
 */
export class WeaponComponent extends Component {
  // Current equipped weapon data
  equippedWeapon: WeaponData | null = null;
  weaponModel: Model | null = null;
  
  // First-person weapon display entity (child of player's head)
  fpWeaponEntity: import('../Entity').Entity | null = null;
  
  // Weapon swing state
  swing: WeaponSwing = {
    isSwinging: false,
    startTime: 0,
    duration: 0,
    progress: 0,
    hasHit: false,
    targetPosition: vec3.create()
  };
  
  // First-person animation state
  isAttacking: boolean = false;
  attackStartTime: number = 0;
  attackDuration: number = getConfig().getRenderingConfig().defaultAttackDuration;
  currentWeaponType: string = 'DEFAULT';
  weaponScale: number = 1.0;
  
  // Weapon attachment offsets (for third-person view)
  private restPosition: vec3 = vec3.fromValues(0.3, 0.1, -0.2);
  private restRotation: quat = quat.fromEuler(quat.create(), 0, 45, 0);
  private swingStartRotation: quat = quat.create();
  private swingEndRotation: quat = quat.create();
  
  // First-person positioning
  private fpBasePosition = vec3.fromValues(0.3, 0.3, -0.15);
  private fpRestRotation = quat.create();
  private fpAttackStartRotation = quat.create();
  private fpAttackEndRotation = quat.create();
  
  // Third-person weapon entity (attached to wielder)
  tpWeaponEntity: import('../Entity').Entity | null = null;

  constructor(entity: import('../Entity').Entity) {
    super(entity);
    // Initialize swing rotations
    quat.fromEuler(this.swingStartRotation, -30, 45, 10);  // Ready position
    quat.fromEuler(this.swingEndRotation, 60, -15, -30);   // End swing position
    // First-person weapon setup will be called manually after player initialization
  }

  /**
   * Initialize the first-person weapon display
   */
  public setupFirstPersonWeapon(): void {
    console.log('=== FP Weapon Setup Debug ===');
    console.log('Entity has player component:', !!this.entity.player);
    console.log('Entity type:', this.entity.constructor.name);
    
    // Only create FP weapon for entities with player components that have heads
    if (!this.entity.player) {
      console.log('❌ Entity does not have player component');
      return;
    }
    
    const playerHead = this.entity.player.head;
    console.log('Player head exists:', !!playerHead);
    if (!playerHead) {
      console.log('❌ Player head is null');
      return;
    }

    // Create a child entity for the first-person weapon display
    // Use globalThis to avoid circular dependency
    const EntityClass = (globalThis as any).Entity;
    console.log('Entity class available:', !!EntityClass);
    if (!EntityClass) {
      console.warn('❌ Entity class not available on globalThis yet');
      return;
    }
    
    if (EntityClass && playerHead) {
      this.fpWeaponEntity = new EntityClass();
      console.log('✅ Created fpWeaponEntity:', !!this.fpWeaponEntity);
      if (this.fpWeaponEntity) {
        this.fpWeaponEntity.parent = playerHead;
        this.fpWeaponEntity.addRender(-1); // Start with no model
        console.log('✅ FP weapon entity configured with render component');
      } else {
        console.log('❌ Failed to create fpWeaponEntity');
      }
    }
    
    // Set initial position and rotation
    this.applyWeaponPositionConfig('DEFAULT');
      // Add as child to player's head
    if (this.fpWeaponEntity) {
      playerHead.children.push(this.fpWeaponEntity);
      
      // Remove from Entity.all since this is managed by the WeaponComponent
      // and shouldn't be cleaned up by the global entity cleanup
      const entityIndex = EntityClass.all.indexOf(this.fpWeaponEntity);
      if (entityIndex !== -1) {
        EntityClass.all.splice(entityIndex, 1);
      }
    }
  }

  update(deltaTime: number): void {
    if (!this.enabled) return;
    
    this.updateSwing(deltaTime);
    this.updateAttackAnimation(deltaTime);
  }

  /**
   * Equip a weapon
   */
  equipWeapon(weapon: WeaponData | null): void {
    this.equippedWeapon = weapon;
    this.updateWeaponModel();
    
    if (weapon) {
      this.createThirdPersonWeapon();
    } else {
      this.destroyThirdPersonWeapon();
    }
  }

  /**
   * Get the currently equipped weapon
   */
  getEquippedWeapon(): WeaponData | null {
    return this.equippedWeapon;
  }

  /**
   * Start an attack (both swing mechanics and animation)
   */
  startAttack(targetPosition?: vec3): boolean {
    if (this.swing.isSwinging || !this.equippedWeapon) return false;
    
    // Start weapon swing mechanics
    this.swing.isSwinging = true;
    this.swing.startTime = performance.now();
    this.swing.duration = this.equippedWeapon.swingDuration;
    this.swing.progress = 0;
    this.swing.hasHit = false;
    
    if (targetPosition) {
      vec3.copy(this.swing.targetPosition, targetPosition);
    } else {
      // Default swing direction (forward from wielder)
      vec3.set(this.swing.targetPosition, 0, 1, 0);
      vec3.transformQuat(this.swing.targetPosition, this.swing.targetPosition, this.entity.worldRotation);
      vec3.add(this.swing.targetPosition, this.entity.worldPosition, this.swing.targetPosition);
    }
    
    // Start first-person animation
    this.isAttacking = true;
    this.attackStartTime = Date.now();
    this.attackDuration = this.equippedWeapon.swingDuration;
    
    return true;
  }

  /**
   * Check if currently attacking
   */
  isCurrentlyAttacking(): boolean {
    return this.isAttacking;
  }

  /**
   * Update weapon model based on equipped weapon
   */
  private updateWeaponModel(): void {
    if (!this.fpWeaponEntity?.render) return;

    if (!this.equippedWeapon) {
      this.weaponModel = null;
      this.fpWeaponEntity.render.modelId = -1;
      return;
    }

    // Set the modelId based on weapon type
    const modelName = this.equippedWeapon.modelName;
    const modelId = gameResources.getModelId(modelName);
    
    this.fpWeaponEntity.render.modelId = modelId;
    this.weaponModel = gameResources.getModel(modelId);
    
    if (!this.weaponModel) {
      console.warn(`Weapon: Model "${modelName}" not found for ${this.equippedWeapon.name}`);
    } else {
      // Apply weapon-specific position configuration
      this.applyWeaponPositionConfig(modelName);
    }
  }

  /**
   * Apply weapon-specific positioning configuration
   */
  applyWeaponPositionConfig(weaponType: string): void {
    if (!this.fpWeaponEntity) return;
    
    const config = WeaponPositionConfigs[weaponType] || WeaponPositionConfigs.DEFAULT;
    
    // Apply position
    vec3.set(this.fpBasePosition, ...config.position);
    vec3.copy(this.fpWeaponEntity.localPosition, this.fpBasePosition);
    
    // Apply rotations (convert from Euler angles)
    quat.fromEuler(this.fpRestRotation, ...config.restRotation);
    quat.fromEuler(this.fpAttackStartRotation, ...config.attackStartRotation);
    quat.fromEuler(this.fpAttackEndRotation, ...config.attackEndRotation);
    quat.copy(this.fpWeaponEntity.localRotation, this.fpRestRotation);
    
    // Store weapon scale
    this.weaponScale = config.scale || 1.0;
    if (this.fpWeaponEntity) {
      this.fpWeaponEntity.localScale = vec3.fromValues(this.weaponScale, this.weaponScale, this.weaponScale);
    }
    
    // Mark as dirty to update transforms
    this.fpWeaponEntity.dirty = true;
    
    // Store current weapon type
    this.currentWeaponType = weaponType;
  }

  /**
   * Update attack animation
   */
  private updateAttackAnimation(deltaTime: number): void {
    if (!this.isAttacking || !this.fpWeaponEntity) return;
    
    const elapsed = Date.now() - this.attackStartTime;
    const progress = Math.min(1.0, elapsed / this.attackDuration);
    
    if (progress >= 1.0) {
      // Attack finished
      this.isAttacking = false;
      quat.copy(this.fpWeaponEntity.localRotation, this.fpRestRotation);
    } else {
      // Interpolate between attack start and end rotations
      const attackProgress = this.easeInOutQuad(progress);
      
      if (progress < 0.3) {
        // Wind-up phase
        const windupProgress = progress / 0.3;
        quat.slerp(
          this.fpWeaponEntity.localRotation,
          this.fpRestRotation,
          this.fpAttackStartRotation,
          windupProgress
        );
      } else {
        // Swing phase
        const swingProgress = (progress - 0.3) / 0.7;
        quat.slerp(
          this.fpWeaponEntity.localRotation,
          this.fpAttackStartRotation,
          this.fpAttackEndRotation,
          swingProgress
        );
      }
    }
    
    this.fpWeaponEntity.dirty = true;
  }

  /**
   * Easing function for smooth animation
   */
  private easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  /**
   * Show/hide the first-person weapon
   */
  setVisible(visible: boolean): void {
    if (this.fpWeaponEntity?.render) {
      this.fpWeaponEntity.render.setVisible(visible);
    }
  }

  /**
   * Check if weapon is visible
   */
  isVisible(): boolean {
    return this.fpWeaponEntity?.render?.visible ?? false;
  }

  /**
   * Update weapon swing mechanics
   */
  private updateSwing(deltaTime: number): void {
    if (!this.swing.isSwinging || !this.equippedWeapon) return;

    const now = performance.now();
    this.swing.progress = Math.min(1, (now - this.swing.startTime) / this.swing.duration);

    // Update third-person weapon animation during swing
    this.updateThirdPersonSwingAnimation();

    // Check for hit during swing peak (around 60% progress)
    if (!this.swing.hasHit && this.swing.progress >= 0.4 && this.swing.progress <= 0.8) {
      this.checkForHits();
    }

    // End swing
    if (this.swing.progress >= 1) {
      this.endSwing();
    }
  }

  /**
   * Update third-person weapon swing animation
   */
  private updateThirdPersonSwingAnimation(): void {
    if (!this.tpWeaponEntity) return;

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

    quat.copy(this.tpWeaponEntity.localRotation, targetRotation);
    this.tpWeaponEntity.dirty = true;
  }

  /**
   * Check for entities hit by weapon swing
   */
  private checkForHits(): void {
    if (!this.equippedWeapon || this.swing.hasHit) return;

    const attackOrigin = vec3.clone(this.entity.worldPosition);
    attackOrigin[2] += (this.entity.physics?.height || 0) * 0.7; // Attack from chest height

    const attackDirection = vec3.create();
    vec3.subtract(attackDirection, this.swing.targetPosition, attackOrigin);
    vec3.normalize(attackDirection, attackDirection);

    // Check for entities within weapon range
    const EntityClass = (globalThis as any).Entity;
    if (!EntityClass) return;
    
    for (const entity of EntityClass.all) {
      if (entity === this.entity || entity === this.tpWeaponEntity || entity.parent === this.entity) continue;

      const distance = vec3.distance(attackOrigin, entity.worldPosition);
      if (distance > this.equippedWeapon.range) continue;

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

  /**
   * Handle hitting an entity
   */
  private hitEntity(target: import('../Entity').Entity, attackOrigin: vec3, attackDirection: vec3): void {
    if (!this.equippedWeapon) return;

    // Apply damage if target has health component
    if (target.health) {
      const damageInfo = {
        amount: this.equippedWeapon.damage,
        source: this.entity,
        type: 'weapon' as const
      };
      target.health.takeDamage(damageInfo);

      // Apply knockback
      const knockback = vec3.create();
      vec3.scale(knockback, attackDirection, this.equippedWeapon.damage * 0.5);
      if (target.physics && target.physics.velocity) {
        vec3.add(target.physics.velocity, target.physics.velocity, knockback);
      }
    }

    // Create combat event for logging/effects
    console.log(`${this.entity.id} hit ${target.id} with ${this.equippedWeapon.name} for ${this.equippedWeapon.damage} damage`);
  }

  /**
   * End weapon swing
   */
  private endSwing(): void {
    this.swing.isSwinging = false;
    this.swing.progress = 0;
    this.swing.hasHit = false;

    // Return third-person weapon to rest position
    if (this.tpWeaponEntity) {
      quat.copy(this.tpWeaponEntity.localRotation, this.restRotation);
      this.tpWeaponEntity.dirty = true;
    }
  }

  /**
   * Create third-person weapon entity
   */
  private createThirdPersonWeapon(): void {
    if (!this.equippedWeapon || this.tpWeaponEntity) return;

    const EntityClass = (globalThis as any).Entity;
    if (!EntityClass) return;

    this.tpWeaponEntity = new EntityClass();
    if (this.tpWeaponEntity && this.equippedWeapon) {
      this.tpWeaponEntity.parent = this.entity;
      this.entity.children.push(this.tpWeaponEntity);

      // Add render component with weapon model
      const modelId = gameResources.getModelId(this.equippedWeapon.modelName);
      this.tpWeaponEntity.addRender(modelId);

      // Set initial position and rotation
      vec3.copy(this.tpWeaponEntity.localPosition, this.restPosition);
      quat.copy(this.tpWeaponEntity.localRotation, this.restRotation);
      this.tpWeaponEntity.dirty = true;

      // Remove from Entity.all since it's managed by this component
      const entityIndex = EntityClass.all.indexOf(this.tpWeaponEntity);
      if (entityIndex !== -1) {
        EntityClass.all.splice(entityIndex, 1);
      }
    }
  }

  /**
   * Destroy third-person weapon entity
   */
  private destroyThirdPersonWeapon(): void {
    if (this.tpWeaponEntity) {
      // Clean up components
      try {
        this.tpWeaponEntity.render?.destroy();
        this.tpWeaponEntity.render = null;
      } catch (error) {
        console.warn('Error destroying tp weapon render component:', error);
      }
      
      // Remove from parent's children
      if (this.tpWeaponEntity.parent) {
        const index = this.tpWeaponEntity.parent.children.indexOf(this.tpWeaponEntity);
        if (index !== -1) {
          this.tpWeaponEntity.parent.children.splice(index, 1);
        }
      }
      
      this.tpWeaponEntity = null;
    }
  }

  /**
   * Check if weapon can attack
   */
  canAttack(): boolean {
    return !this.swing.isSwinging && this.equippedWeapon !== null;
  }

  /**
   * Get attack cooldown in milliseconds
   */
  getAttackCooldown(): number {
    if (!this.equippedWeapon) return 1000;
    return 1000 / this.equippedWeapon.attackSpeed;
  }

  /**
   * Clean up weapon entity when component is destroyed
   */
  destroy(): void {
    if (this.fpWeaponEntity) {
      // Clean up the fpWeaponEntity's components
      try {
        this.fpWeaponEntity.render?.destroy();
        this.fpWeaponEntity.render = null;
      } catch (error) {
        console.warn('Error destroying fpWeapon render component:', error);
      }
      
      // Remove from parent's children
      if (this.fpWeaponEntity.parent) {
        const index = this.fpWeaponEntity.parent.children.indexOf(this.fpWeaponEntity);
        if (index !== -1) {
          this.fpWeaponEntity.parent.children.splice(index, 1);
        }
      }
      
      this.fpWeaponEntity = null;
    }
    
    this.destroyThirdPersonWeapon();
    super.destroy();
  }
}