import { vec3, quat } from 'gl-matrix';
import { Component } from './Component';
import type { Weapon } from '../Weapon';
import type { Model } from '../Model';
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
  // Current equipped weapon
  equippedWeapon: Weapon | null = null;
  weaponModel: Model | null = null;
  
  // First-person weapon display entity (child of player's head)
  fpWeaponEntity: any | null = null;
  
  // Animation state
  isAttacking: boolean = false;
  attackStartTime: number = 0;
  attackDuration: number = getConfig().getRenderingConfig().defaultAttackDuration;
  currentWeaponType: string = 'DEFAULT';
  weaponScale: number = 1.0;
  
  // First-person positioning
  private fpBasePosition = vec3.fromValues(0.3, 0.3, -0.15);
  private fpRestRotation = quat.create();
  private fpAttackStartRotation = quat.create();
  private fpAttackEndRotation = quat.create();

  constructor(entity: any) {
    super(entity);
    // Defer weapon setup to avoid circular dependency issues
    setTimeout(() => this.setupFirstPersonWeapon(), 0);
  }

  /**
   * Initialize the first-person weapon display
   */
  private setupFirstPersonWeapon(): void {
    // Only create FP weapon for local players with heads
    if (!('head' in this.entity)) return;
    
    const playerHead = (this.entity as any).head;
    if (!playerHead) return;

    // Create a child entity for the first-person weapon display
    // Use globalThis to avoid circular dependency
    const EntityClass = (globalThis as any).Entity;
    if (!EntityClass) {
      console.warn('Entity class not available on globalThis yet');
      return;
    }
    
    this.fpWeaponEntity = new EntityClass();
    this.fpWeaponEntity.parent = playerHead;
    this.fpWeaponEntity.addRender(-1); // Start with no model
    
    // Set initial position and rotation
    this.applyWeaponPositionConfig('DEFAULT');
    
    // Add as child to player's head
    playerHead.children.push(this.fpWeaponEntity);
  }

  update(deltaTime: number): void {
    if (!this.enabled) return;
    
    this.updateAttackAnimation(deltaTime);
  }

  /**
   * Equip a weapon
   */
  equipWeapon(weapon: Weapon | null): void {
    this.equippedWeapon = weapon;
    this.updateWeaponModel();
  }

  /**
   * Get the currently equipped weapon
   */
  getEquippedWeapon(): Weapon | null {
    return this.equippedWeapon;
  }

  /**
   * Start an attack animation
   */
  startAttack(): void {
    if (this.isAttacking) return;
    
    this.isAttacking = true;
    this.attackStartTime = Date.now();
    
    // Use weapon-specific attack duration if available
    if (this.equippedWeapon) {
      this.attackDuration = this.equippedWeapon.weaponData.swingDuration;
    }
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
    const modelName = this.equippedWeapon.weaponData.modelName;
    const modelId = gameResources.getModelId(modelName);
    
    this.fpWeaponEntity.render.modelId = modelId;
    this.weaponModel = gameResources.getModel(modelId);
    
    if (!this.weaponModel) {
      console.warn(`Weapon: Model "${modelName}" not found for ${this.equippedWeapon.weaponData.name}`);
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
   * Clean up weapon entity when component is destroyed
   */
  destroy(): void {
    if (this.fpWeaponEntity) {
      // Remove from parent's children
      if (this.fpWeaponEntity.parent) {
        const index = this.fpWeaponEntity.parent.children.indexOf(this.fpWeaponEntity);
        if (index !== -1) {
          this.fpWeaponEntity.parent.children.splice(index, 1);
        }
      }
      
      // Remove from Entity.all
      const EntityClass = (globalThis as any).Entity;
      if (EntityClass && EntityClass.all) {
        const entityIndex = EntityClass.all.indexOf(this.fpWeaponEntity);
        if (entityIndex !== -1) {
          EntityClass.all.splice(entityIndex, 1);
        }
      }
      
      this.fpWeaponEntity = null;
    }
    
    super.destroy();
  }
}