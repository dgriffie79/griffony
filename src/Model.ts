import { Volume } from './Volume';
import { Logger } from './Logger.js';
import { getConfig } from './Config.js';

// Create logger instance for this module
const logger = Logger.getInstance();

export class Model {
  url: string;
  volume!: Volume;
  palette!: Uint8Array;
  originalFaceCount: number = 0;
  greedyFaceCount: number = 0;
  facesBuffer: GPUBuffer | null = null;

  constructor(url: string = '') {
    this.url = url;
  }

  async load(): Promise<void> {
    const response = await fetch(this.url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    if (response.headers.get('Content-Type') === 'text/html') {
      throw new Error('Invalid model: ' + this.url);
    }

    const buffer = await response.arrayBuffer();
    const dataView = new DataView(buffer);

    const sizeX = dataView.getInt32(0, true);
    const sizeY = dataView.getInt32(4, true);
    const sizeZ = dataView.getInt32(8, true);

    this.volume = new Volume(sizeX, sizeY, sizeZ, { emptyValue: 255 });

    const numVoxels = sizeX * sizeY * sizeZ;
    const sourceVoxels = new Uint8Array(dataView.buffer, 12, numVoxels);    // Transform from [x][y][z] to [z][y][x]
    let voxelValueCounts = new Map<number, number>();
    for (let x = 0; x < sizeX; x++) {
      for (let y = 0; y < sizeY; y++) {
        for (let z = 0; z < sizeZ; z++) {
          const srcIdx = x * sizeY * sizeZ + y * sizeZ + z;
          const voxelValue = sourceVoxels[srcIdx];
          this.volume.setVoxel(x, sizeY - y - 1, sizeZ - z - 1, voxelValue);
          
          // Count voxel values for debugging
          if (this.url.includes('fatta')) {
            voxelValueCounts.set(voxelValue, (voxelValueCounts.get(voxelValue) || 0) + 1);
          }
        }
      }
    }
      // Debug voxel value distribution for fatta model
    if (this.url.includes('fatta')) {
      logger.debug('MODEL', '🔍 FATTA MODEL VOXEL VALUES:');
      logger.debug('MODEL', `Empty value set to: ${this.volume.emptyValue}`);
      const sortedValues = Array.from(voxelValueCounts.entries()).sort((a, b) => a[0] - b[0]);
      for (const [value, count] of sortedValues) {
        logger.debug('MODEL', `  Voxel value ${value}: ${count} voxels ${value === this.volume.emptyValue ? '(EMPTY)' : ''}`);
      }
    }

    this.palette = new Uint8Array(getConfig().getGPUConfig().paletteBufferStride);

    for (let i = 0; i < 256; i++) {
      this.palette[i * 4 + 0] = dataView.getUint8(12 + numVoxels + i * 3 + 0) << 2;
      this.palette[i * 4 + 1] = dataView.getUint8(12 + numVoxels + i * 3 + 1) << 2;
      this.palette[i * 4 + 2] = dataView.getUint8(12 + numVoxels + i * 3 + 2) << 2;
      this.palette[i * 4 + 3] = 255;
    }

    // Note: renderer will be imported where needed
    const renderer = (globalThis as any).renderer;
    if (renderer) {
      renderer.registerModel(this);
    }
  }
}
