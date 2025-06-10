import { vec3 } from 'gl-matrix';
import type { LevelData } from './types/index.js';
import { Volume } from './Volume.js';
import { Entity } from './Entity.js';
import { errorHandler, ResourceLoadError, ValidationError, Result } from './ErrorHandler.js';
import { resourceManager, ResourceType } from './ResourceManager.js';

export class Level {
  url: string;
  volume!: Volume;
  isFullyLoaded: boolean = false;
  private disposed: boolean = false;

  constructor(url: string = '') {
    this.url = url;
  }

  async load(): Promise<Result<void>> {
    return errorHandler.safeAsync(async () => {
      // Fetch the level file
      const fetchResult = await errorHandler.fetchResource(this.url, 'level');
      if (!fetchResult.success) {
        throw fetchResult.error;
      }

      const response = fetchResult.data;

      // Parse JSON data
      const parseResult = await errorHandler.parseJSON<LevelData>(response, 'level', this.url);
      if (!parseResult.success) {
        throw parseResult.error;
      }

      const data = parseResult.data;

      // Validate level data
      this.validateLevelData(data);

      // Process level data
      await this.processLevelData(data);

      // Register with renderer if available
      const renderer = (globalThis as any).renderer;
      if (renderer) {
        renderer.registerLevel(this);
      }
      this.isFullyLoaded = true;

    }, 'Level.load');
  }

  private validateLevelData(data: LevelData): void {
    if (!data.width || !data.height) {
      throw new ValidationError(
        `Level missing required dimensions: width=${data.width}, height=${data.height}`,
        'level dimensions'
      );
    }

    if (data.width <= 0 || data.height <= 0) {
      throw new ValidationError(
        `Invalid level dimensions: ${data.width}x${data.height}`,
        'level dimensions'
      );
    }

    if (data.width > 10000 || data.height > 10000) {
      throw new ValidationError(
        `Level dimensions too large: ${data.width}x${data.height} (max 10000x10000)`,
        'level dimensions'
      );
    }

    if (!data.layers || !Array.isArray(data.layers)) {
      throw new ValidationError(
        'Level missing required layers array',
        'level layers'
      );
    }

    if (data.layers.length === 0) {
      throw new ValidationError(
        'Level must have at least one layer',
        'level layers'
      );
    }
  }

  private async processLevelData(data: LevelData): Promise<void> {
    const sizeX = data.width;
    const sizeY = data.height;
    const sizeZ = 3;

    this.volume = new Volume(sizeX, sizeY, sizeZ, { emptyValue: 0, arrayType: Uint16Array });

    for (const layer of data.layers) {
      if (layer.type === 'tilelayer') {
        this.processTileLayer(layer, sizeX, sizeY);
      } else if (layer.type === 'objectgroup') {
        this.processObjectLayer(layer, sizeY);
      }
    }
  }

  private processTileLayer(layer: any, sizeX: number, sizeY: number): void {
    const layerIndex = ['Floor', 'Walls', 'Ceiling'].indexOf(layer.name);
    if (layerIndex === -1) {
      console.warn(`Unknown tilelayer name: ${layer.name}`);
      return;
    }

    if (!layer.data) {
      console.warn(`Tile layer ${layer.name} has no data`);
      return;
    }

    if (layer.data.length !== sizeX * sizeY) {
      console.warn(`Tile layer ${layer.name} data size mismatch: expected ${sizeX * sizeY}, got ${layer.data.length}`);
    }

    for (let i = 0; i < layer.data.length && i < sizeX * sizeY; i++) {
      const x = i % sizeX;
      const y = sizeY - Math.floor(i / sizeX) - 1;
      const z = layerIndex;
      this.volume.setVoxel(x, y, z, layer.data[i]);
    }
  }
  private processObjectLayer(layer: any, sizeY: number): void {
    if (!layer.objects) {
      console.warn(`Object layer has no objects`);
      return;
    }

    for (const object of layer.objects) {
      try {
        this.processLevelObject(object, sizeY);
      } catch (error) {
        console.warn(`Failed to process object:`, error);
        // Continue processing other objects
      }
    }
  }
  private processLevelObject(object: any, sizeY: number): void {
    for (let i = 0; i < 1; i++) {
      const entity = Entity.deserialize(object);
      if (entity) {
        entity.localPosition[1] = sizeY - entity.localPosition[1];
        entity.localPosition[0] += 0.5 + 2 * i;

        // Enable basic physics for non-spawn entities
        if (!entity.spawn) {
          // Enable collision for all entities except specific types
          entity.collision = true;

          // Enable gravity for movable entities
          if (object.type?.toLowerCase() !== 'static') {
            entity.gravity = true;
          }

          // Initialize combat stats for entities
          if ((globalThis as any).combatSystem) {
            (globalThis as any).combatSystem.initializeCombatStats(entity);
          }
          // Mark as network entity if multiplayer is active
          if ((globalThis as any).net && (globalThis as any).net.isConnectionActive()) {
            entity.isNetworkEntity = true;
            if ((globalThis as any).net.isHost()) {
              entity.ownerId = (globalThis as any).net.getPeerId();
            }
          }
        }
      }
    }
  }

  /**
   * Dispose of level resources
   */
  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.isFullyLoaded = false;
    // Volume cleanup is handled automatically by garbage collection
    // Any additional cleanup can be added here

    console.log(`Disposed level: ${this.url}`);
  }

  /**
   * Check if level is disposed
   */
  public get isDisposed(): boolean {
    return this.disposed;
  }
}
