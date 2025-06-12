import { vec3, quat } from 'gl-matrix';
import { Component } from './Component';
import type { WeaponData } from '../types/index';
import type { PlayerUpdateData } from '../types/index';

/**
 * Component that handles player-specific functionality
 * Replaces both PlayerEntity inheritance and PlayerController classes with composition
 */
export class PlayerComponent extends Component {
  // Player identity
  playerName: string = '';
  peerId: string | null = null;
  
  // Player-specific entities
  head: import('../Entity').Entity | null = null; // Will be an Entity
  
  // Player state
  godMode: boolean = false;
  
  // Network update tracking (for remote players)
  private lastNetworkUpdate: number = 0;

  constructor(entity: import('../Entity').Entity, peerId?: string) {
    super(entity);
    this.peerId = peerId || null;
    this.playerName = peerId ? `Player (${peerId})` : 'Local Player';
      this.setupHead();
    
    console.log(`Created player component for ${this.peerId ? `peer ${this.peerId}` : 'unknown peer'}`);
  }

  /**
   * Set up the player's head entity (camera mount point)
   */
  private setupHead(): void {
    // Create head entity using globalThis to avoid circular imports
    const EntityClass = globalThis.Entity;
    if (!EntityClass) {
      console.warn('Entity class not available for head creation');
      return;
    }
    
    if (EntityClass) {
      this.head = new EntityClass();
      if (this.head) {
        this.head.parent = this.entity;
        this.head.localPosition = vec3.fromValues(0, 0, 0.8 * (this.entity.physics?.height || 0.5));
        this.entity.children.push(this.head);
      }
    }
    
    // Remove head from Entity.all since it's managed by this component
    if (EntityClass && this.head) {
      const entityIndex = EntityClass.all.indexOf(this.head);
        if (entityIndex !== -1) {
          EntityClass.all.splice(entityIndex, 1);
        }
      }
    
    // Weapon setup will be called manually after player component is fully initialized
  }

  /**
   * Initialize weapon after player component is fully set up
   */
  public initializeWeapon(): void {
    if (this.entity.weapon) {
      this.entity.weapon.setupFirstPersonWeapon();
    }
  }
  update(deltaTime: number): void {
    if (!this.enabled) return;
    
    if (this.isLocal()) {
      this.updateLocalPlayer(deltaTime);
    } else {
      this.updateRemotePlayer(deltaTime);
    }
  }

  /**
   * Update local player (handle input and camera)
   */
  private updateLocalPlayer(deltaTime: number): void {
    // Get input from InputManager
    const inputManager = (globalThis as any).inputManager;
    if (inputManager) {
      const input = inputManager.update(deltaTime);
      this.processInput(input);
    }
    
    // Update camera to follow this player
    this.updateCamera();
  }

  /**
   * Update remote player (network interpolation)
   */
  private updateRemotePlayer(deltaTime: number): void {
    // Remote players are updated via network, not local input
    // Just update network interpolation
    // this.entity.updateNetworkInterpolation(deltaTime); // TODO: Reimplement or replace this functionality
  }  /**
   * Update camera to follow this local player
   */
  private updateCamera(): void {
    if (!this.isLocal()) {
      console.log(`PlayerComponent.updateCamera: Skipping - not local player (entity ${this.entity.id}, player name: ${this.playerName})`);
      return;
    }
    
    console.log(`PlayerComponent.updateCamera: Updating camera for local player (entity ${this.entity.id}, player name: ${this.playerName})`);
    
    // Use global camera directly
    const globalCamera = (globalThis as any).camera;
    if (!globalCamera) {
      console.warn('PlayerComponent.updateCamera: Global camera not available yet');
      return; // Camera not available yet
    }
    
    // Set global camera to follow this player's head
    if (this.head) {
      console.log(`PlayerComponent.updateCamera: Setting camera to follow head entity ${this.head.id}`);
      globalCamera.entity = this.head;
    } else {
      console.warn(`PlayerComponent.updateCamera: No head entity for local player ${this.entity.id}`);
    }
  }
  /**
   * Apply network update (for remote players)
   */
  applyNetworkUpdate(updateData: PlayerUpdateData): void {
    if (this.isLocal()) return; // Local players don't receive network updates
    
    if (updateData.position && updateData.rotation) {
      // this.entity.applyNetworkUpdate({ // TODO: Reimplement or replace this functionality
      //   position: updateData.position,
      //   rotation: updateData.rotation,
      //   velocity: updateData.velocity,
      //   timestamp: updateData.timestamp,
      //   sequenceNumber: updateData.sequenceNumber || 0
      // });
    }
    
    this.lastNetworkUpdate = Date.now();
  }

  /**
   * Get the last network update time (for remote players)
   */
  getLastNetworkUpdate(): number {
    return this.lastNetworkUpdate;
  }


  /**
   * Get the head entity (camera mount point)
   */
  getHead(): import('../Entity').Entity | null {
    return this.head;
  }
  /**
   * Process input for this player
   */
  processInput(input: PlayerUpdateData): void {
    if (!this.entity.physics || !input.input) return;
    
    const playerInput = input.input;
    const deltaTime = input.timestamp; // Assuming timestamp is delta for now
    
    // Get direction vectors relative to player rotation
    const right = vec3.fromValues(1, 0, 0);
    vec3.transformQuat(right, right, this.entity.localRotation);

    const forward = vec3.fromValues(0, 1, 0);
    vec3.transformQuat(forward, forward, this.entity.localRotation);

    const up = vec3.fromValues(0, 0, 1);
    vec3.transformQuat(up, up, this.entity.localRotation);
    
    const speed = 10;    // Restrict movement to horizontal plane for non-god mode
    if (!this.godMode) {
      forward[2] = 0;
      vec3.normalize(forward, forward);
      right[2] = 0;
      vec3.normalize(right, right);
    } else {
      if (this.entity.physics?.velocity) {
        this.entity.physics.velocity[2] = 0; // Reset vertical velocity for god mode
      }
    }

    // Reset horizontal velocity for new input
    if (this.entity.physics?.velocity) {
      this.entity.physics.velocity[0] = 0;
      this.entity.physics.velocity[1] = 0;
    }

    // Apply movement input using the physics system
    const physicsSystem = (globalThis as any).physicsSystem;
    if (physicsSystem) {
      if (playerInput.keys.forward) {
        physicsSystem.applyMovement(this.entity, forward, speed);
      }
      if (playerInput.keys.backward) {
        physicsSystem.applyMovement(this.entity, forward, -speed);
      }
      if (playerInput.keys.left) {
        physicsSystem.applyMovement(this.entity, right, -speed);
      }
      if (playerInput.keys.right) {
        physicsSystem.applyMovement(this.entity, right, speed);
      }      if (this.godMode && playerInput.keys.up) {
        physicsSystem.applyMovement(this.entity, up, speed);
      }
      if (this.godMode && playerInput.keys.down) {
        physicsSystem.applyMovement(this.entity, up, -speed);
      }
      if (playerInput.keys.jump) {
        if (!this.godMode) {
          physicsSystem.jump(this.entity);
        }
      }
    }

    // Handle mouse rotation for remote players
    if (playerInput.mouse && (playerInput.mouse.deltaX || playerInput.mouse.deltaY)) {
      const sensitivity = 0.001; // Adjust as needed
      const dx = playerInput.mouse.deltaX * sensitivity;
      const dy = playerInput.mouse.deltaY * sensitivity;
      
      quat.rotateZ(this.entity.localRotation, this.entity.localRotation, -dx);
      if (this.head) {
        quat.rotateX(this.head.localRotation, this.head.localRotation, dy);
        
        // Clamp head rotation
        const tempAxis = vec3.create();
        const angle = quat.getAxisAngle(tempAxis, this.head.localRotation);
        
        if (Math.abs(tempAxis[0]) > 0.9) {
          const pitch = tempAxis[0] > 0 ? angle : -angle;
          const maxPitch = Math.PI / 2 - 0.01;
          
          if (Math.abs(pitch) > maxPitch) {
            const clampedPitch = Math.sign(pitch) * maxPitch;
            quat.setAxisAngle(this.head.localRotation, vec3.fromValues(1, 0, 0), clampedPitch);
          }
        }
      }
    }

    this.entity.dirty = true;
    if (this.head) {
      this.head.dirty = true;
    }
  }
  /**
   * Respawn the player at a spawn point with enhanced error handling
   */
  respawn(): void {
    console.log('🔄 Attempting to respawn player...');
    
    // Reset player state
    vec3.zero(this.entity.localPosition);
    if (this.entity.physics) {
      vec3.zero(this.entity.physics.velocity);
    }
    quat.identity(this.entity.localRotation);
    if (this.head) {
      quat.identity(this.head.localRotation);
    }
    this.entity.dirty = true;

    // Find spawn point with better error handling
    const EntityClass = (globalThis as any).Entity;
    let spawnFound = false;
    
    if (EntityClass && EntityClass.all) {
      const spawnPoints = EntityClass.all.filter((e: any) => e.spawn);
      console.log(`🔍 Found ${spawnPoints.length} spawn points`);
      
      if (spawnPoints.length > 0) {
        // Use first available spawn point
        const spawnPoint = spawnPoints[0];
        vec3.copy(this.entity.localPosition, spawnPoint.worldPosition);
        quat.copy(this.entity.localRotation, spawnPoint.worldRotation);
        spawnFound = true;
        console.log(`✅ Respawned at spawn point: ${spawnPoint.worldPosition}`);
      }
    }
    
    // Fallback spawn position if no spawn points found
    if (!spawnFound) {
      console.warn('⚠️ No spawn points found, using fallback position');
      
      // Try to find safe position using level geometry analysis
      if (this.findSafeSpawnPosition()) {
        console.log('✅ Found safe fallback spawn position');
      } else {
        // Ultimate fallback: spawn at origin slightly elevated
        vec3.set(this.entity.localPosition, 0, 0, 5);
        console.log('⚠️ Using emergency spawn at elevated origin');
      }
    }
    
    // Reset health if available
    if (this.entity.health && this.entity.health.isDead) {
      this.entity.health.revive();
      console.log('💖 Player health restored');
    }
    
    console.log('✅ Respawn completed');
  }

  /**
   * Find a safe spawn position using level geometry analysis
   */
  private findSafeSpawnPosition(): boolean {
    const level = (globalThis as any).level;
    if (!level || !level.volume) {
      return false;
    }
    
    // Search for safe positions in a grid pattern
    const searchRadius = 20;
    const step = 2;
    
    for (let x = -searchRadius; x <= searchRadius; x += step) {
      for (let y = -searchRadius; y <= searchRadius; y += step) {
        // Find ground level at this position
        const groundZ = this.findGroundLevel(x, y, level);
        if (groundZ !== -1) {
          // Position player slightly above ground
          vec3.set(this.entity.localPosition, x, y, groundZ + 1);
          console.log(`🔍 Found safe spawn at: ${x}, ${y}, ${groundZ + 1}`);
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Find ground level at given x,y coordinates
   */
  private findGroundLevel(x: number, y: number, level: any): number {
    const volumeX = Math.floor(x);
    const volumeY = Math.floor(y);
    
    // Search from top down to find solid ground
    for (let z = level.volume.sizeZ - 1; z >= 0; z--) {
      if (level.volume.getVoxel(volumeX, volumeY, z) > 0) {
        return z;
      }
    }
    
    return -1; // No ground found
  }

  /**
   * Equip a weapon (delegates to weapon component)
   */
  equipWeapon(weapon: WeaponData | null): void {
    if (this.entity.weapon) {
      this.entity.weapon.equipWeapon(weapon);
    }
  }

  /**
   * Get the currently equipped weapon
   */
  getEquippedWeapon(): WeaponData | null {
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
  serialize(): PlayerUpdateData {
    return {
      timestamp: Date.now(),
      position: Array.from(this.entity.localPosition) as [number, number, number],
      rotation: Array.from(this.entity.localRotation) as [number, number, number, number]
    };
  }
  /**
   * Check if this is the local player (controlled by this client)
   */
  isLocal(): boolean {
    if (!this.peerId) return false;
    
    // Get Net instance from globalThis to check local peer ID
    const net = (globalThis as any).net;
    if (!net || !net.getPeerId) return false;
    
    // A null peerId indicates the local player when created without a peerId
    const netInstance = (globalThis as any).net;
    const localId = netInstance?.getPeerId?.() ?? null;
    return this.peerId === null || this.peerId === localId;
  }
  
  /**
   * Check if this is a remote/network player
   */
  isRemote(): boolean {
    return !this.isLocal();
  }

  /**
   * Set the peer ID for this player
   */
  setPeerId(peerId: string | null): void {
    console.log(`PlayerComponent.setPeerId: Setting peerId ${peerId} for entity ${this.entity.id}, player name: ${this.playerName}`);
    this.peerId = peerId;
    if (this.isLocal()) {
      console.log(`PlayerComponent.setPeerId: This is now the local player - will update camera next frame`);
    }
  }

  /**
   * Get the peer ID for this player
   */
  getPeerId(): string | null {
    return this.peerId;
  }

  /**
   * Toggle god mode for this player
   */
  toggleGodMode(): void {
    this.godMode = !this.godMode;
    console.log(`God mode ${this.godMode ? 'enabled' : 'disabled'} for player ${this.playerName}`);
  }

  /**
   * Set god mode state for this player
   */
  setGodMode(enabled: boolean): void {
    this.godMode = enabled;
    console.log(`God mode ${this.godMode ? 'enabled' : 'disabled'} for player ${this.playerName}`);
  }

  /**
   * Check if this player is in god mode
   */
  isInGodMode(): boolean {
    return this.godMode;
  }
}