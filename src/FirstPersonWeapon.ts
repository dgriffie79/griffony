import { mat4, quat, vec3 } from 'gl-matrix';
import { Entity } from './Entity';
import type { Player } from './Player';
import type { Weapon } from './Weapon';
import type { Model } from './Model';

/**
 * Represents a weapon model displayed in first person view
 * This is separate from the actual Weapon entity used for combat mechanics
 */
export class FirstPersonWeapon extends Entity {
  player: Player;
  weaponModel: Model | null = null;
  isAttacking: boolean = false;
  attackStartTime: number = 0;
  attackDuration: number = 400; // Default, will be set from weapon config
  // First-person view positioning - adjusted for better visibility
  private fpRightHandPosition = vec3.fromValues(0.3, 0.3, -0.15); // Position on screen (right, forward, down)
  private fpRestRotation = quat.fromEuler(quat.create(), -20, 230, 0); // Resting rotation
  private fpAttackStartRotation = quat.fromEuler(quat.create(), -30, 180, 20); // Wind-up animation
  private fpAttackEndRotation = quat.fromEuler(quat.create(), 50, 270, -40); // Swing animation
    constructor(player: Player) {
    super();
    this.player = player;
    this.parent = player.head; // Attach to player's head for first person view
    
    // Set initial position and rotation
    vec3.copy(this.localPosition, this.fpRightHandPosition);
    quat.copy(this.localRotation, this.fpRestRotation);
    this.dirty = true;
      // Add to player's head as a child
    player.head.children.push(this);
    
    // Add this to Entity.all to ensure it gets rendered and updated
    Entity.all.push(this);
  }
  
  /**
   * Update the weapon model based on the player's equipped weapon
   */  updateWeaponModel(weapon: Weapon | null): void {
    if (!weapon) {
      this.weaponModel = null;
      this.model = null;
      return;
    }
    
    // Set the model based on weapon type
    this.model = globalThis.models?.[weapon.weaponData.modelName] || null;
    this.weaponModel = this.model;
    
    if (!this.model) {
      console.warn(`First-person weapon: Model "${weapon.weaponData.modelName}" not found for ${weapon.weaponData.name}`);
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
   */
  update(elapsed: number): void {
    super.update(elapsed);
    
    // Update attack animation if active
    if (this.isAttacking) {
      const now = performance.now();
      const progress = Math.min(1, (now - this.attackStartTime) / this.attackDuration);
      
      // Update rotation based on attack progress using easing function      // Use different easing for different phases of the animation
      let targetRotation = quat.create();
      
      if (progress < 0.25) {
        // Wind up phase - slower start for anticipation
        const t = this.easeIn(progress / 0.25);
        quat.slerp(targetRotation, this.fpRestRotation, this.fpAttackStartRotation, t);
      } else if (progress < 0.6) {
        // Swing phase - quick, snappy motion
        const t = this.easeOut((progress - 0.25) / 0.35);
        quat.slerp(targetRotation, this.fpAttackStartRotation, this.fpAttackEndRotation, t);
      } else {
        // Return to rest - more gradual
        const t = this.easeInOut((progress - 0.6) / 0.4);
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
