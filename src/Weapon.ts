import type { WeaponData } from './types/index';
import { getConfig } from './Config';

// Predefined weapon configurations as WeaponData objects
export const WeaponConfigs: Record<string, WeaponData> = {
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
  },
  WAR_HAMMER: {
    id: 'war_hammer',
    name: 'War Hammer',
    damage: getConfig().getCombatConfig().defaultWeaponDamage,
    range: 2.5,
    attackSpeed: 0.8,
    swingDuration: 700,
    modelName: 'hammer'
  }
};
