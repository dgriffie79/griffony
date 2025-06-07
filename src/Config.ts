/**
 * Centralized configuration system for Griffony engine
 * Extracts all hardcoded magic numbers and values into organized configuration objects
 */

export interface GPUConfig {
  // Buffer sizes
  transferBufferSize: number;
  uniformBufferSize: number;
  paletteBufferStride: number;
  
  // Query buffer settings
  maxQueryResults: number;
  
  // Binding indices and offsets
  frameUniformsBinding: number;
  objectUniformsBinding: number;
  textureBinding: number;
  samplerBinding: number;
}

export interface RenderingConfig {
  // Animation and frame limits
  maxAnimationFrame: number;
  
  // Mesh calculation constants
  modelScale: number;
  
  // Face counting divisors for optimization
  faceCountDivisors: {
    quarter: number;
    eighth: number;
    sixteenth: number;
    thirtySecond: number;
  };
  
  // Timing intervals
  framePrintInterval: number;
  performanceUpdateInterval: number;
  
  // Attack animation timing
  defaultAttackDuration: number;
  attackAnimationPhases: {
    windupPhase: number;   // Progress point where windup ends (0.0-1.0)
    swingPhase: number;    // Progress point where swing ends (0.0-1.0)
  };
}

export interface PhysicsConfig {
  // Basic physics properties
  gravity: number;
  maxVelocity: number;
  jumpForce: number;
  friction: number;
  airResistance: number;
  collisionBounce: number;
  
  // Collision flags
  entityCollisionEnabled: boolean;
  terrainCollisionEnabled: boolean;
  
  // Quality settings
  qualityLevel: 'low' | 'medium' | 'high';
  spatialOptimization: boolean;
  
  // Spatial grid settings
  gridCellSize: number;
  gridUpdateInterval: number;
  
  // Cache timeouts
  collisionCacheTimeout: number;
  raycastCacheTimeout: number;
  
  // Performance limits
  maxEntities: number;
  
  // Raycast settings
  defaultRaycastDistance: number;
  
  // Quality level timeouts
  qualityTimeouts: {
    low: {
      gridUpdate: number;
      collisionCache: number;
      maxEntities: number;
    };
    medium: {
      gridUpdate: number;
      collisionCache: number;
      maxEntities: number;
    };
    high: {
      gridUpdate: number;
      collisionCache: number;
      maxEntities: number;
    };
  };
}

export interface AudioConfig {
  // Sound effect frequencies
  attackSoundFrequency: {
    start: number;
    end: number;
    duration: number;
  };
  
  hitSoundFrequency: {
    start: number;
    end: number;
    duration: number;
  };
}

export interface UIConfig {
  // Timing delays
  pointerLockDelay: number;
  attackFlashDuration: number;
  crosshairFlashDuration: number;
  
  // UI positioning (percentages)
  centerPosition: number;
  
  // Combat display
  healthBarUpdateInterval: number;
  
  // Weapon adjuster flash timing
  weaponAdjusterFlashDuration: number;
  weaponAdjusterFlashDelay: number;
}

export interface CombatConfig {
  // Default stats
  defaultMaxHealth: number;
  defaultDefense: number;
  defaultWeaponDamage: number;
  
  // Weapon positioning
  weaponAttackRotation: [number, number, number];
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  gpu: {
    transferBufferSize: 256 * 100000,
    uniformBufferSize: 256,
    paletteBufferStride: 256 * 4,
    maxQueryResults: 2,
    frameUniformsBinding: 0,
    objectUniformsBinding: 1,
    textureBinding: 2,
    samplerBinding: 3
  } as GPUConfig,
  rendering: {
    maxAnimationFrame: 16,
    modelScale: 1/32,
    faceCountDivisors: {
      quarter: 4,
      eighth: 8,
      sixteenth: 16,
      thirtySecond: 32
    },
    framePrintInterval: 1000,
    performanceUpdateInterval: 100,
    defaultAttackDuration: 400,
    attackAnimationPhases: {
      windupPhase: 0.25,
      swingPhase: 0.6
    }
  } as RenderingConfig,
  physics: {
    // Basic physics properties
    gravity: 9.8,
    maxVelocity: 100,
    jumpForce: 5,
    friction: 0.2,
    airResistance: 0.01,
    collisionBounce: 0.3,
    
    // Collision flags
    entityCollisionEnabled: true,
    terrainCollisionEnabled: true,
    
    // Quality settings
    qualityLevel: 'medium',
    spatialOptimization: true,
    
    // Spatial grid settings
    gridCellSize: 8,
    gridUpdateInterval: 50,
    
    // Cache timeouts
    collisionCacheTimeout: 100,
    raycastCacheTimeout: 50,
    
    // Performance limits
    maxEntities: 100,
    
    // Raycast settings
    defaultRaycastDistance: 100,
    qualityTimeouts: {
      low: {
        gridUpdate: 100,
        collisionCache: 200,
        maxEntities: 50
      },
      medium: {
        gridUpdate: 50,
        collisionCache: 100,
        maxEntities: 100
      },
      high: {
        gridUpdate: 25,
        collisionCache: 50,
        maxEntities: 200
      }
    }
  } as PhysicsConfig,

  audio: {
    attackSoundFrequency: {
      start: 100,
      end: 200,
      duration: 0.1
    },
    hitSoundFrequency: {
      start: 150,
      end: 50,
      duration: 0.15
    }
  } as AudioConfig,
  ui: {
    pointerLockDelay: 150,
    attackFlashDuration: 100,
    crosshairFlashDuration: 200,
    centerPosition: 50,
    healthBarUpdateInterval: 100,
    weaponAdjusterFlashDuration: 500,
    weaponAdjusterFlashDelay: 100
  } as UIConfig,

  combat: {
    defaultMaxHealth: 100,
    defaultDefense: 5,
    defaultWeaponDamage: 50,
    weaponAttackRotation: [50, 270, -40]
  } as CombatConfig
};

/**
 * Configuration manager class
 */
export class ConfigManager {
  private static instance: ConfigManager;
  private config = { ...DEFAULT_CONFIG };

  private constructor() {}

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /**
   * Get GPU configuration
   */
  getGPUConfig(): GPUConfig {
    return this.config.gpu;
  }

  /**
   * Get rendering configuration
   */
  getRenderingConfig(): RenderingConfig {
    return this.config.rendering;
  }

  /**
   * Get physics configuration
   */
  getPhysicsConfig(): PhysicsConfig {
    return this.config.physics;
  }

  /**
   * Get audio configuration
   */
  getAudioConfig(): AudioConfig {
    return this.config.audio;
  }

  /**
   * Get UI configuration
   */
  getUIConfig(): UIConfig {
    return this.config.ui;
  }

  /**
   * Get combat configuration
   */
  getCombatConfig(): CombatConfig {
    return this.config.combat;
  }

  /**
   * Update configuration section
   */
  updateConfig<T extends keyof typeof DEFAULT_CONFIG>(
    section: T,
    updates: Partial<typeof DEFAULT_CONFIG[T]>
  ): void {
    this.config[section] = { ...this.config[section], ...updates };
  }

  /**
   * Update physics configuration
   */
  updatePhysicsConfig(updates: Partial<PhysicsConfig>): void {
    this.config.physics = { ...this.config.physics, ...updates };
  }

  /**
   * Update rendering configuration
   */
  updateRenderingConfig(updates: Partial<RenderingConfig>): void {
    this.config.rendering = { ...this.config.rendering, ...updates };
  }

  /**
   * Update GPU configuration
   */
  updateGPUConfig(updates: Partial<GPUConfig>): void {
    this.config.gpu = { ...this.config.gpu, ...updates };
  }

  /**
   * Reset configuration to defaults
   */
  resetToDefaults(): void {
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * Get performance-optimized physics config based on quality level
   */
  getPhysicsConfigForQuality(quality: 'low' | 'medium' | 'high'): Partial<PhysicsConfig> {
    const qualitySettings = this.config.physics.qualityTimeouts[quality];
    return {
      gridUpdateInterval: qualitySettings.gridUpdate,
      collisionCacheTimeout: qualitySettings.collisionCache,
      maxEntities: qualitySettings.maxEntities
    };
  }
}

/**
 * Convenience function to get config manager instance
 */
export function getConfig(): ConfigManager {
  return ConfigManager.getInstance();
}
