import { vec3 } from 'gl-matrix';
import { Entity } from './Entity';
import { Weapon, WeaponConfigs } from './Weapon';
import type { CombatStats, AttackInfo, CombatEvent } from './types/index';
import { getConfig } from './Config.js';

export class CombatSystem {
  private static instance: CombatSystem | null = null;
  private combatEntities = new Map<number, CombatStats>();
  private weapons = new Map<number, Weapon>(); // entity id -> weapon
  private lastAttackTime = new Map<number, number>(); // entity id -> timestamp

  private constructor() { }

  static getInstance(): CombatSystem {
    if (!CombatSystem.instance) {
      CombatSystem.instance = new CombatSystem();
    }
    return CombatSystem.instance;
  }
  // Initialize combat stats for an entity
  initializeCombatStats(entity: Entity, maxHealth?: number, defense?: number): CombatStats {
    const combatConfig = getConfig().getCombatConfig();
    const actualMaxHealth = maxHealth ?? combatConfig.defaultMaxHealth;
    const actualDefense = defense ?? combatConfig.defaultDefense;
    
    const stats: CombatStats = {
      health: actualMaxHealth,
      maxHealth: actualMaxHealth,
      defense: actualDefense,
      lastDamageTime: 0,
      isDead: false
    };

    this.combatEntities.set(entity.id, stats);

    // Add combat stats to entity for easy access
    (entity as any).combatStats = stats;

    return stats;
  }

  // Equip a weapon to an entity
  equipWeapon(entity: Entity, weaponConfigName: keyof typeof WeaponConfigs): Weapon {
    const config = WeaponConfigs[weaponConfigName];
    const weapon = new Weapon(config);

    // Remove existing weapon if any
    this.unequipWeapon(entity);

    weapon.attachToEntity(entity);
    this.weapons.set(entity.id, weapon);
    
    // Update first person weapon model if this is the player
    if (entity.player) {
      entity.player.equipWeapon(weapon);
    }

    return weapon;
  }

  // Remove weapon from entity
  unequipWeapon(entity: Entity): void {
    const existingWeapon = this.weapons.get(entity.id);
    if (existingWeapon) {
      existingWeapon.detachFromEntity();
      this.weapons.delete(entity.id);
      
      // Update first person weapon if this is the player
      if (entity.player) {
        entity.player.equipWeapon(null);
      }
    }
  }

  // Attempt to attack with equipped weapon
  tryAttack(attacker: Entity, targetPosition?: vec3): boolean {
    const weapon = this.weapons.get(attacker.id);
    if (!weapon || !weapon.canAttack()) return false;

    const now = performance.now();
    const lastAttack = this.lastAttackTime.get(attacker.id) || 0;
    const cooldown = weapon.getAttackCooldown();

    if (now - lastAttack < cooldown) return false;

    // Start weapon swing
    const success = weapon.startSwing(targetPosition);
    if (success) {
      this.lastAttackTime.set(attacker.id, now);
      
      // Start first-person weapon animation if attacker is the player
      if (attacker.player) {
        attacker.player.startAttack();
      }

      // Dispatch attack event
      this.dispatchCombatEvent({
        type: 'attack',
        source: attacker,
        position: targetPosition ? vec3.clone(targetPosition) : vec3.clone(attacker.worldPosition),
        weaponId: weapon.weaponData.id
      });
    }

    return success;
  }

  // Apply damage to an entity
  damage(target: Entity, attackInfo: AttackInfo): boolean {
    const stats = this.combatEntities.get(target.id);
    if (!stats || stats.isDead) return false;

    const actualDamage = Math.max(1, attackInfo.damage - stats.defense);
    stats.health = Math.max(0, stats.health - actualDamage);
    stats.lastDamageTime = performance.now();

    // Apply knockback if target has velocity
    if ('vel' in target && target.vel && attackInfo.direction) {
      const knockback = vec3.create();
      vec3.scale(knockback, attackInfo.direction, actualDamage * 0.3);
      vec3.add(target.vel as vec3, target.vel as vec3, knockback);
      target.dirty = true;
    }

    // Check for death
    if (stats.health <= 0 && !stats.isDead) {
      stats.isDead = true;
      this.onEntityDeath(target, attackInfo.source);

      this.dispatchCombatEvent({
        type: 'death',
        source: attackInfo.source,
        target: target,
        position: vec3.clone(target.worldPosition)
      });
    } else {
      this.dispatchCombatEvent({
        type: 'hit',
        source: attackInfo.source,
        target: target,
        damage: actualDamage,
        position: vec3.clone(target.worldPosition),
        weaponId: attackInfo.weaponId
      });
    }

    return true;
  }

  // Heal an entity
  heal(target: Entity, amount: number): boolean {
    const stats = this.combatEntities.get(target.id);
    if (!stats || stats.isDead) return false;

    const oldHealth = stats.health;
    stats.health = Math.min(stats.maxHealth, stats.health + amount);

    if (stats.health > oldHealth) {
      this.dispatchCombatEvent({
        type: 'heal',
        target: target,
        position: vec3.clone(target.worldPosition)
      });
      return true;
    }

    return false;
  }

  // Get combat stats for an entity
  getCombatStats(entity: Entity): CombatStats | null {
    return this.combatEntities.get(entity.id) || null;
  }  // Get equipped weapon for an entity
  getWeapon(entity: Entity): Weapon | null {
    return this.weapons.get(entity.id) || null;
  }

  // Update combat system (called from main loop)
  update(elapsed: number): void {
    // Future: Update cooldowns, damage over time effects, etc.
    // Currently no frame-by-frame updates needed
  }
  // Dispatch combat events for logging/UI updates
  private dispatchCombatEvent(event: CombatEvent): void {
    // Future: Could dispatch to event system for UI updates
  }
  // Handle entity death
  private onEntityDeath(entity: Entity, killer?: Entity): void {
    // Future: Handle loot drops, experience, etc.
  }
}

// Export singleton instance
export const combatSystem = CombatSystem.getInstance();
