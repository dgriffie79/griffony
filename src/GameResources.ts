import type { Model } from './Model.js';
import type { Player } from './Player.js';
import type { Camera } from './Camera.js';
import type { Renderer } from './Renderer.js';
import type { Level } from './Level.js';
import type { Tileset } from './Tileset.js';

/**
 * Centralized resource manager that replaces globalThis usage
 * Provides type-safe access to game resources with proper initialization tracking
 */
export class GameResources {
  private static instance: GameResources | null = null;
  
  // Core game objects
  private _models: Model[] = [];
  private _modelNames: string[] = [];
  private _player: Player | null = null;
  private _camera: Camera | null = null;
  private _renderer: Renderer | null = null;
  private _level: Level | null = null;
  private _tileset: Tileset | null = null;
  
  // Initialization state
  private _modelsLoaded: boolean = false;
  private _ready: boolean = false;

  private constructor() {}

  static getInstance(): GameResources {
    if (!GameResources.instance) {
      GameResources.instance = new GameResources();
    }
    return GameResources.instance;
  }
  // Model management
  initializeModelNames(modelNames: string[]): void {
    this._modelNames = [...modelNames];
  }

  setModels(models: Model[]): void {
    this._models = models;
    this._modelsLoaded = true;
  }

  getModel(modelId: number): Model | null {
    if (modelId < 0 || modelId >= this._models.length) {
      return null;
    }
    return this._models[modelId];
  }

  getModelId(modelName: string): number {
    return this._modelNames.indexOf(modelName);
  }

  getModelName(modelId: number): string | null {
    if (modelId < 0 || modelId >= this._modelNames.length) {
      return null;
    }
    return this._modelNames[modelId];
  }

  get models(): readonly Model[] {
    return this._models;
  }

  get modelNames(): readonly string[] {
    return this._modelNames;
  }

  get modelsLoaded(): boolean {
    return this._modelsLoaded;
  }
  // Core game objects
  setPlayer(player: Player): void {
    this._player = player;
  }

  get player(): Player {
    if (!this._player) {
      throw new Error('Player not initialized - call setPlayer() first');
    }
    return this._player;
  }

  setCamera(camera: Camera): void {
    this._camera = camera;
  }

  get camera(): Camera {
    if (!this._camera) {
      throw new Error('Camera not initialized - call setCamera() first');
    }
    return this._camera;
  }

  setRenderer(renderer: Renderer): void {
    this._renderer = renderer;
  }

  get renderer(): Renderer {
    if (!this._renderer) {
      throw new Error('Renderer not initialized - call setRenderer() first');
    }
    return this._renderer;
  }

  setLevel(level: Level): void {
    this._level = level;
  }

  get level(): Level {
    if (!this._level) {
      throw new Error('Level not initialized - call setLevel() first');
    }
    return this._level;
  }

  setTileset(tileset: Tileset): void {
    this._tileset = tileset;
  }

  get tileset(): Tileset {
    if (!this._tileset) {
      throw new Error('Tileset not initialized - call setTileset() first');
    }
    return this._tileset;
  }

  // Convenience methods
  isModelNameAvailable(): boolean {
    return this._modelNames.length > 0;
  }

  areModelsReady(): boolean {
    return this._modelsLoaded && this._models.length > 0;
  }
  // Ready state
  markReady(): void {
    this._ready = true;
    console.log('🎉 All game resources are ready!');
  }

  get isReady(): boolean {
    return this._ready;
  }

  // Debug information
  getStatus(): any {
    return {
      modelNames: this._modelNames.length,
      modelsLoaded: this._modelsLoaded,
      hasPlayer: !!this._player,
      hasCamera: !!this._camera,
      hasRenderer: !!this._renderer,
      hasLevel: !!this._level,
      hasTileset: !!this._tileset,
      ready: this._ready
    };
  }
}

// Export singleton instance for convenience
export const gameResources = GameResources.getInstance();
