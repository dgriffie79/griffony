import { mat4, quat, vec3 } from 'gl-matrix';
import { Entity } from './Entity';
import type { Player } from './Player';
import type { Weapon } from './Weapon';
import type { Model } from './Model';
import type { WeaponType } from './types/index';
import { Logger } from './Logger.js';
import { getConfig } from './Config.js';

// Create logger instance for this module
const logger = Logger.getInstance();

/**
 * Default weapon positioning configurations for first-person view
 * Use this to adjust how each weapon appears from the first-person perspective
 */
export const WeaponPositionConfigs: Record<string, {
  position: [number, number, number],
  restRotation: [number, number, number],
  attackStartRotation: [number, number, number],
  attackEndRotation: [number, number, number],
  scale?: number
}> = {
  // Default configuration used when no weapon-specific one is available
  DEFAULT: {
    position: [0.3, 0.3, -0.15], // Position on screen (right, forward, down)
    restRotation: [-20, 230, 0], // Euler angles (pitch, yaw, roll)
    attackStartRotation: [-30, 180, 20], // Wind-up animation
    attackEndRotation: [50, 270, -40], // Swing animation
    scale: 1.0
  },
  // Sword-specific configuration
   sword: {
    position: [0.16, 0.19, -0.20],
    restRotation: [-10, 0, 25],
    attackStartRotation: [-120, 0, 25],
    attackEndRotation: [-10, 0, 25],
    scale: 1.00
  },
  // Axe-specific configuration
  axe: {
    position: [0.16, 0.19, -0.20],
    restRotation: [-10, 0, 25],
    attackStartRotation: [-120, 0, 25],
    attackEndRotation: [-10, 0, 25],
    scale: .25
  },
  // Hammer-specific configuration
  hammer: {
    position: [0.16, 0.19, -0.20],
    restRotation: [-10, 0, 25],
    attackStartRotation: [-120, 0, 25],
    attackEndRotation: [-10, 0, 25],
    scale: .75
  }
};

/**
 * Represents a weapon model displayed in first person view
 * This is separate from the actual Weapon entity used for combat mechanics
 */
export class FirstPersonWeapon extends Entity {
  player: Player;
  weaponModel: Model | null = null;
  isAttacking: boolean = false;
  attackStartTime: number = 0;
  attackDuration: number = getConfig().getRenderingConfig().defaultAttackDuration; // From config
  currentWeaponType: string = 'DEFAULT';
  weaponScale: number = 1.0;
  
  // First-person view positioning - set from WeaponPositionConfigs
  private fpRightHandPosition = vec3.fromValues(0.3, 0.3, -0.15); // Default position
  private fpRestRotation = quat.create();
  private fpAttackStartRotation = quat.create();
  private fpAttackEndRotation = quat.create();
  constructor(player: Player) {
    super();
    this.player = player;
    this.parent = player.head; // Attach to player's head for first person view
    
    // Apply default weapon position and rotation
    this.applyWeaponPositionConfig('DEFAULT');
    
    // Add to player's head as a child
    player.head.children.push(this);
    
    // Add this to Entity.all to ensure it gets rendered and updated
    Entity.all.push(this);
  }
    /**
   * Applies position and rotation configuration for a specific weapon type
   * This makes it easy to adjust weapons individually
   */
  public applyWeaponPositionConfig(weaponType: string): void {
    // Get the configuration for this weapon, fall back to DEFAULT if not found
    const config = WeaponPositionConfigs[weaponType] || WeaponPositionConfigs.DEFAULT;
    
    // Apply position
    vec3.set(this.fpRightHandPosition, ...config.position);
    vec3.copy(this.localPosition, this.fpRightHandPosition);
    
    // Apply rotations (convert from Euler angles)
    quat.fromEuler(this.fpRestRotation, ...config.restRotation);
    quat.fromEuler(this.fpAttackStartRotation, ...config.attackStartRotation);
    quat.fromEuler(this.fpAttackEndRotation, ...config.attackEndRotation);
    quat.copy(this.localRotation, this.fpRestRotation);
    
    // Store weapon scale
    this.weaponScale = config.scale || 1.0;
    
    // Mark as dirty to update transforms
    this.dirty = true;
    
    // Store current weapon type
    this.currentWeaponType = weaponType;
  }
  
  /**
   * Update the weapon model based on the player's equipped weapon
   */
  updateWeaponModel(weapon: Weapon | null): void {
    if (!weapon) {
      this.weaponModel = null;
      this.model = null;
      return;
    }
    
    // Set the model based on weapon type
    const modelName = weapon.weaponData.modelName;
    this.model = globalThis.models?.[modelName] || null;
    this.weaponModel = this.model;
    
    if (!this.model) {
      logger.warn('WEAPON', `First-person weapon: Model "${modelName}" not found for ${weapon.weaponData.name}`);
    } else {
      // Apply weapon-specific position configuration
      this.applyWeaponPositionConfig(modelName);
      logger.debug('WEAPON', `Applied ${modelName} first-person positioning configuration`);
    }
    
    // Update attack animation duration from weapon config
    this.attackDuration = weapon.weaponData.swingDuration;
  }
  
  /**
   * Start attack animation
   */
  startAttackAnimation(): void {
    if (this.isAttacking) return;
    
    this.isAttacking = true;
    this.attackStartTime = performance.now();
  }
  
  /**
   * Update the weapon animation
   */  update(elapsed: number): void {
    super.update(elapsed);
    
    // Update attack animation if active
    if (this.isAttacking) {
      const now = performance.now();
      const progress = Math.min(1, (now - this.attackStartTime) / this.attackDuration);
      
      // Get animation timing config
      const animConfig = getConfig().getRenderingConfig().attackAnimationPhases;
      
      // Update rotation based on attack progress using easing function
      let targetRotation = quat.create();
      
      if (progress < animConfig.windupPhase) {
        // Wind up phase - slower start for anticipation
        const t = this.easeIn(progress / animConfig.windupPhase);
        quat.slerp(targetRotation, this.fpRestRotation, this.fpAttackStartRotation, t);
      } else if (progress < animConfig.swingPhase) {
        // Swing phase - quick, snappy motion
        const t = this.easeOut((progress - animConfig.windupPhase) / (animConfig.swingPhase - animConfig.windupPhase));
        quat.slerp(targetRotation, this.fpAttackStartRotation, this.fpAttackEndRotation, t);
      } else {
        // Return to rest - more gradual
        const t = this.easeInOut((progress - animConfig.swingPhase) / (1.0 - animConfig.swingPhase));
        quat.slerp(targetRotation, this.fpAttackEndRotation, this.fpRestRotation, t);
      }
      
      quat.copy(this.localRotation, targetRotation);
      this.dirty = true;
      
      // End animation when complete
      if (progress >= 1) {
        this.isAttacking = false;
        quat.copy(this.localRotation, this.fpRestRotation);
        this.dirty = true;
      }
    }
  }
  
  /**
   * Gets the scale factor for this weapon
   * Used by the renderer to properly scale the weapon model
   */
  getWeaponScale(): number {
    return this.weaponScale;
  }
    /**
   * Easing functions for smooth animation
   */
  private easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }
  
  private easeIn(t: number): number {
    return t * t;
  }
  
  private easeOut(t: number): number {
    return t * (2 - t);
  }
}
