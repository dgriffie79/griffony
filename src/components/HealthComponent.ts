import { Component } from './Component';
import type { Entity } from '../Entity';

export interface DamageInfo {
  amount: number;
  source?: Entity;
  damageType?: string;
  knockback?: number;
}

/**
 * Handles health, damage, and death for entities
 */
export class HealthComponent extends Component {
  maxHealth: number;
  currentHealth: number;
  isDead: boolean = false;
  isInvulnerable: boolean = false;
  
  // Damage over time
  poisonDamage: number = 0;
  poisonDuration: number = 0;
  
  // Regeneration
  regenRate: number = 0; // Health per second
  regenDelay: number = 0; // Seconds after damage before regen starts
  timeSinceLastDamage: number = 0;
  
  // Events
  onDamage?: (damage: DamageInfo) => void;
  onDeath?: () => void;
  onHeal?: (amount: number) => void;

  constructor(entity: Entity, maxHealth: number = 100) {
    super(entity);
    this.maxHealth = maxHealth;
    this.currentHealth = maxHealth;
  }

  update(deltaTime: number): void {
    if (!this.enabled || this.isDead) return;
    
    this.timeSinceLastDamage += deltaTime;
    
    // Handle poison damage
    if (this.poisonDuration > 0) {
      this.poisonDuration -= deltaTime;
      if (this.poisonDuration > 0) {
        this.takeDamage({ amount: this.poisonDamage * deltaTime, damageType: 'poison' });
      }
    }
    
    // Handle regeneration
    if (this.regenRate > 0 && this.timeSinceLastDamage >= this.regenDelay) {
      this.heal(this.regenRate * deltaTime);
    }
  }

  /**
   * Apply damage to this entity
   */
  takeDamage(damageInfo: DamageInfo): boolean {
    if (this.isDead || this.isInvulnerable || !this.enabled) {
      return false;
    }
    
    this.currentHealth -= damageInfo.amount;
    this.timeSinceLastDamage = 0;
    
    // Trigger damage event
    this.onDamage?.(damageInfo);
    
    // Check for death
    if (this.currentHealth <= 0) {
      this.currentHealth = 0;
      this.die();
    }
    
    return true;
  }

  /**
   * Heal this entity
   */
  heal(amount: number): void {
    if (this.isDead || !this.enabled) return;
    
    const oldHealth = this.currentHealth;
    this.currentHealth = Math.min(this.maxHealth, this.currentHealth + amount);
    
    const actualHealing = this.currentHealth - oldHealth;
    if (actualHealing > 0) {
      this.onHeal?.(actualHealing);
    }
  }

  /**
   * Kill this entity
   */
  die(): void {
    if (this.isDead) return;
    
    this.isDead = true;
    this.currentHealth = 0;
    this.onDeath?.();
  }

  /**
   * Revive this entity with full health
   */
  revive(): void {
    this.isDead = false;
    this.currentHealth = this.maxHealth;
    this.poisonDuration = 0;
    this.timeSinceLastDamage = 0;
  }

  /**
   * Set poison effect
   */
  setPoison(damagePerSecond: number, duration: number): void {
    this.poisonDamage = damagePerSecond;
    this.poisonDuration = duration;
  }

  /**
   * Set regeneration properties
   */
  setRegeneration(healthPerSecond: number, delayAfterDamage: number = 3): void {
    this.regenRate = healthPerSecond;
    this.regenDelay = delayAfterDamage;
  }

  /**
   * Get health as a percentage (0-1)
   */
  getHealthPercentage(): number {
    return this.currentHealth / this.maxHealth;
  }

  /**
   * Check if entity is at full health
   */
  isFullHealth(): boolean {
    return this.currentHealth >= this.maxHealth;
  }

  /**
   * Check if entity is critically wounded
   */
  isCriticalHealth(threshold: number = 0.25): boolean {
    return this.getHealthPercentage() <= threshold;
  }
}