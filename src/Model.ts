import { Volume } from './Volume';
import { getConfig } from './Config.js';
import { errorHandler, ResourceLoadError, ValidationError, Result } from './ErrorHandler.js';
import { resourceManager, ResourceType } from './ResourceManager.js';

export class Model {
  url: string;
  volume!: Volume;
  palette!: Uint8Array;
  originalFaceCount: number = 0;
  greedyFaceCount: number = 0;
  facesBuffer: GPUBuffer | null = null;
  private disposed: boolean = false;

  constructor(url: string = '') {
    this.url = url;
  }

  async load(): Promise<Result<void>> {
    return errorHandler.safeAsync(async () => {
      // Fetch the model file
      const fetchResult = await errorHandler.fetchResource(this.url, 'model');
      if (!fetchResult.success) {
        throw fetchResult.error;
      }

      const response = fetchResult.data;
      
      // Validate content type
      const contentType = response.headers.get('Content-Type');
      if (contentType === 'text/html') {
        throw new ResourceLoadError(
          `Invalid model file format: received HTML instead of binary data`,
          'model',
          this.url
        );
      }

      // Parse binary data
      const buffer = await response.arrayBuffer();
      await this.parseModelData(buffer);
    }, 'Model.load');
  }

  private async parseModelData(buffer: ArrayBuffer): Promise<void> {
    const dataView = new DataView(buffer);

    // Validate minimum file size
    if (buffer.byteLength < 12) {
      throw new ValidationError(
        `Model file too small: ${buffer.byteLength} bytes, expected at least 12 bytes for header`,
        'model file size'
      );
    }

    const sizeX = dataView.getInt32(0, true);
    const sizeY = dataView.getInt32(4, true);
    const sizeZ = dataView.getInt32(8, true);

    // Validate dimensions
    if (sizeX <= 0 || sizeY <= 0 || sizeZ <= 0) {
      throw new ValidationError(
        `Invalid model dimensions: ${sizeX}x${sizeY}x${sizeZ}`,
        'model dimensions'
      );
    }

    if (sizeX > 1024 || sizeY > 1024 || sizeZ > 1024) {
      throw new ValidationError(
        `Model dimensions too large: ${sizeX}x${sizeY}x${sizeZ} (max 1024x1024x1024)`,
        'model dimensions'
      );
    }

    this.volume = new Volume(sizeX, sizeY, sizeZ, { emptyValue: 255 });

    const numVoxels = sizeX * sizeY * sizeZ;
    const expectedSize = 12 + numVoxels; // Header + voxel data
    
    if (buffer.byteLength < expectedSize) {
      throw new ValidationError(
        `Model file incomplete: ${buffer.byteLength} bytes, expected ${expectedSize} bytes`,
        'model file size'
      );
    }    const sourceVoxels = new Uint8Array(dataView.buffer, 12, numVoxels);

    // Transform from [x][y][z] to [z][y][x] and collect statistics
    this.transformVoxelData(sourceVoxels, sizeX, sizeY, sizeZ);

    // Extract palette from the data
    this.extractPalette(dataView, numVoxels);

    // Register with renderer if available (after all data is processed)
    const renderer = (globalThis as any).renderer;
    if (renderer) {
      renderer.registerModel(this);
    }
  }

  private transformVoxelData(sourceVoxels: Uint8Array, sizeX: number, sizeY: number, sizeZ: number): void {
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
  }

  private extractPalette(dataView: DataView, numVoxels: number): void {
    const gpuConfig = getConfig().getGPUConfig();
    this.palette = new Uint8Array(gpuConfig.paletteBufferStride);

    try {
      // Try to extract palette from file data
      for (let i = 0; i < 256; i++) {
        this.palette[i * 4 + 0] = dataView.getUint8(12 + numVoxels + i * 3 + 0) << 2;
        this.palette[i * 4 + 1] = dataView.getUint8(12 + numVoxels + i * 3 + 1) << 2;
        this.palette[i * 4 + 2] = dataView.getUint8(12 + numVoxels + i * 3 + 2) << 2;
        this.palette[i * 4 + 3] = 255;
      }    } catch (error) {
      // Fall back to default palette if extraction fails
      console.warn(`Failed to extract palette from ${this.url}, using default palette:`, error);
      this.generateDefaultPalette();
    }
  }

  private generateDefaultPalette(): void {
    for (let i = 0; i < 256; i++) {
      const base = i * 4;
      this.palette[base + 0] = i;     // R
      this.palette[base + 1] = i;     // G  
      this.palette[base + 2] = i;     // B
      this.palette[base + 3] = 255;   // A
    }
  }

  /**
   * Dispose of model resources
   */
  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    
    if (this.facesBuffer) {
      // Note: facesBuffer disposal is handled by the resource manager
      this.facesBuffer = null;
    }    console.log(`Disposed model: ${this.url}`);
  }

  /**
   * Check if model is disposed
   */
  public get isDisposed(): boolean {
    return this.disposed;
  }
}
