import { vec3 } from 'gl-matrix';
import type { LevelData } from './types/index.js';
import { Volume } from './Volume.js';
import { Entity } from './Entity.js';
import { Logger } from './Logger.js';

// Create logger instance for this module
const logger = Logger.getInstance();

export class Level {
  url: string;
  volume!: Volume;
  isFullyLoaded: boolean = false;

  constructor(url: string = '') {
    this.url = url;
  }

  async load(): Promise<void> {
    const response = await fetch(this.url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    let data: LevelData;
    try {
      data = await response.json();
    } catch {
      throw new Error('Invalid level');
    }

    const sizeX = data.width;
    const sizeY = data.height;
    const sizeZ = 3;

    this.volume = new Volume(sizeX, sizeY, sizeZ, { emptyValue: 0, arrayType: Uint16Array });

    for (const layer of data.layers) {
      if (layer.type === 'tilelayer') {
        const layerIndex = ['Floor', 'Walls', 'Ceiling'].indexOf(layer.name);
        if (layerIndex === -1) {
          logger.warn('LEVEL', `Unknown tilelayer name: ${layer.name}`);
          continue;
        }
        
        if (layer.data) {
          for (let i = 0; i < layer.data.length; i++) {
            const x = i % sizeX;
            const y = sizeY - Math.floor(i / sizeX) - 1;
            const z = layerIndex;
            this.volume.setVoxel(x, y, z, layer.data[i]);
          }
        }
      } else if (layer.type === 'objectgroup') {
        if (layer.objects) {
          for (const object of layer.objects) {            for (let i = 0; i < 1; i++) {
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
                }
              }
            }
          }
        }
      }
    }    // Note: renderer will be imported where needed
    const renderer = (globalThis as any).renderer;
    if (renderer) {
      renderer.registerLevel(this);
    }
    
    this.isFullyLoaded = true;
    logger.info('LEVEL', 'Level fully loaded and registered with renderer');
  }
}
