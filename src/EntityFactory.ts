import { vec3, quat } from 'gl-matrix';
import { Entity } from './Entity';
import { PhysicsLayer } from './components/PhysicsComponent';
import { gameResources } from './GameResources';

/**
 * Factory functions for creating common entity types
 * This provides a clean API for entity creation while hiding component complexity
 */

/**
 * Get model ID by name with error handling
 */
function getModelId(modelName: string): number {
  if (!gameResources.isModelNameAvailable()) {
    console.warn('Model names not loaded yet');
    return -1;
  }
  
  const modelId = gameResources.getModelId(modelName);
  if (modelId === -1) {
    console.warn(`Model "${modelName}" not found. Available models: ${gameResources.modelNames.join(', ')}`);
  }
  
  return modelId;
}

/**
 * Create a player entity with standard player components
 */
export function createPlayer(peerId?: string, networkId?: string): Entity {
  const player = new Entity();
  
  // Core components every player needs
  player.addRender(getModelId('player'));
  player.addPhysics({
    hasGravity: true,
    hasCollision: true,
    layer: PhysicsLayer.Player,
    radius: 0.25,
    height: 0.5,
    mass: 1.0
  });
  player.addHealth(100);
  
  // Weapon component for all players (must be before player component)
  player.addWeapon();
    // Player component with identity and player-specific functionality
  player.addPlayer(networkId || '', peerId);
  
  // Set god mode to true by default for local players
  if (player.player) {
    const net = (globalThis as any).net;
    const isLocal = !peerId || (net && net.getPeerId && peerId === net.getPeerId());
    if (isLocal) {
      player.player.setGodMode(true);
    }
  }
  
  // Now that both components are created, initialize the weapon
  if (player.player) {
    player.player.initializeWeapon();
  }
  
  // Network component for remote players only
  // Local players are determined by comparing peerId with Net.getPeerId()
  if (peerId && networkId) {
    const net = (globalThis as any).net;
    const isLocal = net && net.getPeerId && peerId === net.getPeerId();
    
    if (!isLocal) {
      const networkComp = player.addNetwork(networkId);
      networkComp.smoothingEnabled = true;
      networkComp.maxInterpolationDistance = 5.0;
    }
  }
  
  return player;
}

/**
 * Create an enemy entity
 */
export function createEnemy(enemyType: string, position?: vec3): Entity {
  const enemy = new Entity();
  
  // Determine enemy properties based on type
  let modelName = 'trooa'; // default
  let health = 50;
  let radius = 0.3;
  let height = 0.6;
  
  switch (enemyType.toLowerCase()) {
    case 'ogre':
      modelName = 'trooa';
      health = 100;
      radius = 0.4;
      height = 0.8;
      break;
    case 'imp':
      modelName = 'troob';
      health = 30;
      radius = 0.2;
      height = 0.4;
      break;
    case 'guard':
      modelName = 'trooc';
      health = 75;
      radius = 0.35;
      height = 0.7;
      break;
    default:
      console.warn(`Unknown enemy type: ${enemyType}, using default`);
      break;
  }
  
  enemy.addRender(getModelId(modelName));
  enemy.addPhysics({
    hasGravity: true,
    hasCollision: true,
    layer: PhysicsLayer.Enemy,
    collidesWith: PhysicsLayer.Player | PhysicsLayer.Enemy | PhysicsLayer.Static,
    radius,
    height,
    mass: 1.5
  });
  enemy.addHealth(health);
  
  if (position) {
    vec3.copy(enemy.localPosition, position);
  }
  
  return enemy;
}

/**
 * Create a pickup item entity
 */
export function createPickup(itemType: string, position?: vec3): Entity {
  const pickup = new Entity();
  
  let modelName = 'cone'; // default pickup model
  
  switch (itemType.toLowerCase()) {
    case 'health':
      modelName = 'cone';
      break;
    case 'weapon':
      modelName = 'sword';
      break;
    case 'ammo':
      modelName = 'box_frame';
      break;
    case 'powerup':
      modelName = 'portal';
      break;
    default:
      console.warn(`Unknown pickup type: ${itemType}, using default`);
      break;
  }
  
  pickup.addRender(getModelId(modelName));
  pickup.addPhysics({
    hasGravity: false, // Pickups typically float
    hasCollision: true,
    layer: PhysicsLayer.Pickup,
    collidesWith: PhysicsLayer.Player,
    radius: 0.15,
    height: 0.3,
    mass: 0.1
  });
  
  if (position) {
    vec3.copy(pickup.localPosition, position);
  }
  
  return pickup;
}

/**
 * Create a projectile entity (bullet, arrow, etc.)
 */
export function createProjectile(projectileType: string, position?: vec3, velocity?: vec3): Entity {
  const projectile = new Entity();
  
  let modelName = 'cone'; // Simple projectile model
  
  switch (projectileType.toLowerCase()) {
    case 'bullet':
      modelName = 'cone';
      break;
    case 'arrow':
      modelName = 'cone';
      break;
    case 'fireball':
      modelName = 'cone';
      break;
    default:
      console.warn(`Unknown projectile type: ${projectileType}, using default`);
      break;
  }
  
  projectile.addRender(getModelId(modelName));
  projectile.addPhysics({
    hasGravity: false, // Most projectiles ignore gravity initially
    hasCollision: true,
    layer: PhysicsLayer.Projectile,
    collidesWith: PhysicsLayer.Player | PhysicsLayer.Enemy | PhysicsLayer.Static,
    radius: 0.05,
    height: 0.1,
    mass: 0.01
  });
  
  if (position) {
    vec3.copy(projectile.localPosition, position);
  }
  
  if (velocity && projectile.physics) {
    vec3.copy(projectile.physics.velocity, velocity);
  }
  
  return projectile;
}

/**
 * Create a static environment object
 */
export function createStaticObject(modelName: string, position?: vec3, scale?: number): Entity {
  const staticObj = new Entity();
  
  staticObj.addRender(getModelId(modelName));
  staticObj.addPhysics({
    hasGravity: false,
    hasCollision: true,
    layer: PhysicsLayer.Static,
    collidesWith: PhysicsLayer.All,
    radius: scale || 0.5,
    height: scale || 1.0,
    mass: 1000 // Very heavy so it doesn't move
  });
  
  if (staticObj.physics) {
    staticObj.physics.setStatic(true);
  }
  
  if (position) {
    vec3.copy(staticObj.localPosition, position);
  }
  
  if (scale) {
    staticObj.localScale = vec3.fromValues(scale, scale, scale);
  }
  
  return staticObj;
}

/**
 * Create a spawn point entity
 */
export function createSpawnPoint(position?: vec3): Entity {
  const spawn = new Entity();
  spawn.spawn = true; // Legacy compatibility
  
  spawn.addRender(getModelId('portal'));
  // Spawn points don't need physics - they're just markers
  
  if (position) {
    vec3.copy(spawn.localPosition, position);
  }
  
  return spawn;
}

/**
 * Create a trigger volume (invisible collision area)
 */
export function createTrigger(position?: vec3, size: vec3 = vec3.fromValues(1, 1, 1)): Entity {
  const trigger = new Entity();
  
  // No render component - triggers are invisible
  trigger.addPhysics({
    hasGravity: false,
    hasCollision: true,
    layer: PhysicsLayer.Trigger,
    collidesWith: PhysicsLayer.Player,
    radius: size[0],
    height: size[2],
    mass: 0
  });
  
  if (trigger.physics) {
    trigger.physics.setStatic(true);
  }
  
  if (position) {
    vec3.copy(trigger.localPosition, position);
  }
  
  vec3.copy(trigger.localScale, size);
  
  return trigger;
}

/**
 * Create a destructible object
 */
export function createDestructible(modelName: string, position?: vec3, health: number = 25): Entity {
  const destructible = new Entity();
  
  destructible.addRender(getModelId(modelName));
  destructible.addPhysics({
    hasGravity: true,
    hasCollision: true,
    layer: PhysicsLayer.Default,
    collidesWith: PhysicsLayer.All,
    radius: 0.3,
    height: 0.6,
    mass: 2.0
  });
  destructible.addHealth(health);
  
  // Set up destruction behavior
  if (destructible.health) {
    destructible.health.onDeath = () => {
      // Hide the object when destroyed
      if (destructible.render) {
        destructible.render.setVisible(false);
      }
      // Disable collision
      if (destructible.physics) {
        destructible.physics.hasCollision = false;
      }
    };
  }
  
  if (position) {
    vec3.copy(destructible.localPosition, position);
  }
  
  return destructible;
}