import { vec3, quat } from 'gl-matrix';
import { Component } from './Component';
import type { Weapon } from '../Weapon';

/**
 * Component that handles player-specific functionality
 * Replaces the PlayerEntity inheritance with composition
 */
export class PlayerComponent extends Component {
  // Player identity
  playerName: string = '';
  isLocalPlayer: boolean = false;
  
  // Player-specific entities
  head: any = null; // Will be an Entity, using any to avoid circular imports
  
  // Controller reference
  private controller: any = null;

  constructor(entity: any, isLocal: boolean = false) {
    super(entity);
    this.isLocalPlayer = isLocal;
    this.playerName = isLocal ? 'Local Player' : 'Remote Player';
    
    this.setupHead();
  }

  /**
   * Set up the player's head entity (camera mount point)
   */
  private setupHead(): void {
    // Create head entity using globalThis to avoid circular imports
    const EntityClass = (globalThis as any).Entity;
    if (!EntityClass) {
      console.warn('Entity class not available for head creation');
      return;
    }
    
    this.head = new EntityClass();
    this.head.parent = this.entity;
    this.head.localPosition = vec3.fromValues(0, 0, 0.8 * (this.entity.physics?.height || 0.5));
    this.entity.children.push(this.head);
    
    // Remove head from Entity.all since it's managed by this component
    const entityIndex = EntityClass.all.indexOf(this.head);
    if (entityIndex !== -1) {
      EntityClass.all.splice(entityIndex, 1);
    }
  }

  update(deltaTime: number): void {
    if (!this.enabled) return;
    
    // Update controller if present
    if (this.controller) {
      this.controller.update(deltaTime);
    }
  }

  /**
   * Set the controller for this player
   */
  setController(controller: any): void {
    this.controller = controller;
  }

  /**
   * Get the controller for this player
   */
  getController(): any {
    return this.controller;
  }

  /**
   * Get the head entity (camera mount point)
   */
  getHead(): any {
    return this.head;
  }

  /**
   * Process input for this player
   */
  processInput(input: any): void {
    if (!this.entity.physics) return;
    
    // Input processing would be implemented here
    // For now, this is a placeholder
  }

  /**
   * Respawn the player at a spawn point
   */
  respawn(): void {
    vec3.zero(this.entity.localPosition);
    if (this.entity.physics) {
      vec3.zero(this.entity.physics.velocity);
    }
    quat.identity(this.entity.localRotation);
    if (this.head) {
      quat.identity(this.head.localRotation);
    }
    this.entity.dirty = true;

    // Find spawn point and move there
    const EntityClass = (globalThis as any).Entity;
    if (EntityClass && EntityClass.all) {
      for (const e of EntityClass.all) {
        if (e.spawn) {
          vec3.copy(this.entity.localPosition, e.worldPosition);
          quat.copy(this.entity.localRotation, e.worldRotation);
          break;
        }
      }
    }
    
    // Reset health if available
    if (this.entity.health && this.entity.health.isDead) {
      this.entity.health.revive();
    }
  }

  /**
   * Equip a weapon (delegates to weapon component)
   */
  equipWeapon(weapon: Weapon | null): void {
    if (this.entity.weapon) {
      this.entity.weapon.equipWeapon(weapon);
    }
  }

  /**
   * Get the currently equipped weapon
   */
  getEquippedWeapon(): Weapon | null {
    return this.entity.weapon?.getEquippedWeapon() ?? null;
  }

  /**
   * Start an attack with the equipped weapon
   */
  startAttack(): void {
    if (this.entity.weapon) {
      this.entity.weapon.startAttack();
    }
  }

  /**
   * Check if currently attacking
   */
  isAttacking(): boolean {
    return this.entity.weapon?.isCurrentlyAttacking() ?? false;
  }

  /**
   * Show/hide the first-person weapon
   */
  setWeaponVisible(visible: boolean): void {
    if (this.entity.weapon) {
      this.entity.weapon.setVisible(visible);
    }
  }

  /**
   * Clean up when component is destroyed
   */
  destroy(): void {
    if (this.head) {
      // Clean up head entity
      try {
        this.head.render?.destroy();
        this.head.render = null;
      } catch (error) {
        console.warn('Error destroying head render component:', error);
      }
      
      // Remove from parent's children
      if (this.head.parent) {
        const index = this.head.parent.children.indexOf(this.head);
        if (index !== -1) {
          this.head.parent.children.splice(index, 1);
        }
      }
      
      this.head = null;
    }
    
    super.destroy();
  }

  /**
   * Serialize player data
   */
  serialize(): any {
    return {
      playerName: this.playerName,
      isLocalPlayer: this.isLocalPlayer
    };
  }

  /**
   * Check if this is a local player
   */
  isLocal(): boolean {
    return this.isLocalPlayer;
  }

  /**
   * Check if this is a remote/network player
   */
  isRemote(): boolean {
    return !this.isLocalPlayer;
  }
}