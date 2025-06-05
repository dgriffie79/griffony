import { vec3 } from 'gl-matrix';
import { Entity } from './Entity';
import { Player } from './Player';
import { Weapon, WeaponConfigs } from './Weapon';
import type { CombatStats, AttackInfo, CombatEvent } from './types/index';

export class CombatSystem {
  private static instance: CombatSystem | null = null;
  private combatEntities = new Map<number, CombatStats>();
  private weapons = new Map<number, Weapon>(); // entity id -> weapon
  private lastAttackTime = new Map<number, number>(); // entity id -> timestamp

  private constructor() {}

  static getInstance(): CombatSystem {
    if (!CombatSystem.instance) {
      CombatSystem.instance = new CombatSystem();
    }
    return CombatSystem.instance;
  }

  // Initialize combat stats for an entity
  initializeCombatStats(entity: Entity, maxHealth: number = 100, defense: number = 0): CombatStats {
    const stats: CombatStats = {
      health: maxHealth,
      maxHealth: maxHealth,
      defense: defense,
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
    
    return weapon;
  }

  // Remove weapon from entity
  unequipWeapon(entity: Entity): void {
    const existingWeapon = this.weapons.get(entity.id);
    if (existingWeapon) {
      existingWeapon.detachFromEntity();
      this.weapons.delete(entity.id);
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
  }

  // Get equipped weapon for an entity
  getWeapon(entity: Entity): Weapon | null {
    return this.weapons.get(entity.id) || null;
  }

  // Update all combat-related systems
  update(elapsed: number): void {
    // Update all weapons
    for (const weapon of this.weapons.values()) {
      weapon.update(elapsed);
    }

    // Update combat stats (regeneration, status effects, etc.)
    for (const [entityId, stats] of this.combatEntities.entries()) {
      if (stats.isDead) continue;

      // Simple health regeneration (1 HP per 5 seconds when not recently damaged)
      const timeSinceLastDamage = performance.now() - stats.lastDamageTime;
      if (timeSinceLastDamage > 5000 && stats.health < stats.maxHealth) {
        const regenRate = elapsed / 5000; // 1 HP per 5 seconds
        stats.health = Math.min(stats.maxHealth, stats.health + regenRate);
      }
    }
  }

  // Handle entity death
  private onEntityDeath(entity: Entity, killer?: Entity): void {
    console.log(`Entity ${entity.id} has died!`);
    
    // Remove weapon on death
    this.unequipWeapon(entity);
    
    // For players, trigger respawn logic
    if (entity instanceof Player) {
      setTimeout(() => {
        this.respawnPlayer(entity);
      }, 3000); // 3 second respawn delay
    }
  }

  // Respawn a player
  private respawnPlayer(player: Player): void {
    const stats = this.combatEntities.get(player.id);
    if (stats) {
      stats.health = stats.maxHealth;
      stats.isDead = false;
      stats.lastDamageTime = 0;
    }

    player.respawn();
    
    // Re-equip default weapon
    this.equipWeapon(player, 'IRON_SWORD');
    
    console.log(`Player ${player.id} has respawned!`);
  }  // Dispatch combat events for UI/effects
  private dispatchCombatEvent(event: CombatEvent): void {
    // Enhanced logging for better feedback
    switch (event.type) {
      case 'attack':
        console.log(`🗡️ ${event.source?.constructor.name || 'Entity'} ${event.source?.id} starts attacking with ${event.weaponId}!`);
        // Play attack sound for player attacks
        if (event.source && 'head' in event.source) { // Player attack
          const playAttackSound = (globalThis as any).playAttackSound;
          if (playAttackSound) playAttackSound();
        }
        break;
      case 'hit':
        console.log(`💥 HIT! ${event.source?.constructor.name || 'Entity'} ${event.source?.id} deals ${event.damage} damage to ${event.target?.constructor.name || 'Entity'} ${event.target?.id}`);
        // Trigger visual and audio effects for player hits
        if (event.source && 'head' in event.source) { // Player hit something
          const triggerFlash = (globalThis as any).triggerAttackFlash;
          const playHitSound = (globalThis as any).playHitSound;
          if (triggerFlash) triggerFlash();
          if (playHitSound) playHitSound();
        }
        break;
      case 'death':
        console.log(`💀 ${event.target?.constructor.name || 'Entity'} ${event.target?.id} has been defeated by ${event.source?.constructor.name || 'Entity'} ${event.source?.id}!`);
        break;
      case 'heal':
        console.log(`💚 ${event.target?.constructor.name || 'Entity'} ${event.target?.id} has been healed!`);
        break;
    }
    
    // Could dispatch to event system if we had one
    // EventSystem.getInstance().dispatch('combat', event);
  }

  // Get all entities within attack range of a position
  getEntitiesInRange(position: vec3, range: number, excludeEntity?: Entity): Entity[] {
    const inRange: Entity[] = [];
    
    for (const entity of Entity.all) {
      if (entity === excludeEntity) continue;
      
      const distance = vec3.distance(position, entity.worldPosition);
      if (distance <= range) {
        inRange.push(entity);
      }
    }
    
    return inRange;
  }

  // Check if entity can be attacked (has combat stats and is alive)
  canBeAttacked(entity: Entity): boolean {
    const stats = this.getCombatStats(entity);
    return stats !== null && !stats.isDead;
  }

  // Get health percentage for UI display
  getHealthPercentage(entity: Entity): number {
    const stats = this.getCombatStats(entity);
    if (!stats) return 0;
    return stats.health / stats.maxHealth;
  }

  // Reset all combat data (useful for level changes, etc.)
  reset(): void {
    this.combatEntities.clear();
    this.weapons.clear();
    this.lastAttackTime.clear();
  }
}

// Export singleton instance
export const combatSystem = CombatSystem.getInstance();
