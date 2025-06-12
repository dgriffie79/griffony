import type { TilesetData } from './types';
import { errorHandler, ResourceLoadError, ValidationError, GPUError, Result } from './ErrorHandler.js';
import { resourceManager, ResourceType } from './ResourceManager.js';

export class Tileset {
  url: string;
  tileWidth: number = 0;
  tileHeight: number = 0;
  numTiles: number = 0;
  imageData: ImageData | null = null;
  texture: GPUTexture | null = null;
  private disposed: boolean = false;

  constructor(url: string = '') {
    this.url = url;
  }

  private async loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = url;
      img.onload = () => resolve(img);
      img.onerror = (error) => reject(new ResourceLoadError(
        `Failed to load image: ${url}`,
        'image',
        url
      ));
    });
  }

  async load(): Promise<Result<void>> {
    return errorHandler.safeAsync(async () => {
      // Fetch the tileset file
      const fetchResult = await errorHandler.fetchResource(this.url, 'tileset');
      if (!fetchResult.success) {
        throw fetchResult.error;
      }

      const response = fetchResult.data;
      
      // Parse JSON data
      const parseResult = await errorHandler.parseJSON<TilesetData>(response, 'tileset', this.url);
      if (!parseResult.success) {
        throw parseResult.error;
      }

      const data = parseResult.data;
      
      // Validate tileset data
      this.validateTilesetData(data);
      
      // Process tileset
      await this.processTilesetData(data);
    }, 'Tileset.load');
  }

  private validateTilesetData(data: TilesetData): void {
    if (!data.tilewidth || !data.tileheight) {
      throw new ValidationError(
        `Tileset missing required dimensions: tilewidth=${data.tilewidth}, tileheight=${data.tileheight}`,
        'tileset dimensions'
      );
    }

    if (data.tilewidth <= 0 || data.tileheight <= 0) {
      throw new ValidationError(
        `Invalid tileset dimensions: ${data.tilewidth}x${data.tileheight}`,
        'tileset dimensions'
      );
    }

    if (data.tilewidth > 1024 || data.tileheight > 1024) {
      throw new ValidationError(
        `Tileset tile dimensions too large: ${data.tilewidth}x${data.tileheight} (max 1024x1024)`,
        'tileset dimensions'
      );
    }

    if (!data.tilecount || data.tilecount <= 0) {
      throw new ValidationError(
        `Invalid tile count: ${data.tilecount}`,
        'tileset tile count'
      );
    }

    if (data.tilecount > 10000) {
      throw new ValidationError(
        `Too many tiles: ${data.tilecount} (max 10000)`,
        'tileset tile count'
      );
    }

    if (!data.image && !data.tiles) {
      throw new ValidationError(
        'Tileset must have either an image or tiles array',
        'tileset content'
      );
    }
  }

  private async processTilesetData(data: TilesetData): Promise<void> {
    const tileWidth = data.tilewidth;
    const tileHeight = data.tileheight;
    const numTiles = data.tilecount;

    const baseUrl = new URL(this.url, window.location.href).href;

    // Create canvas for rendering
    const canvas = resourceManager.register(
      document.createElement('canvas'),
      ResourceType.Canvas,
      `tileset-canvas-${this.url}`
    );

    canvas.resource.width = tileWidth;
    canvas.resource.height = tileHeight * numTiles;
    
    const ctx = canvas.resource.getContext('2d');
    if (!ctx) {
      throw new GPUError('Failed to create 2D rendering context', 'getContext');
    }

    try {
      if (data.image) {
        await this.loadSingleImage(data, baseUrl, ctx);
      } else if (data.tiles) {
        await this.loadMultipleImages(data, baseUrl, ctx, tileHeight);
      }

      this.imageData = ctx.getImageData(0, 0, tileWidth, tileHeight * numTiles);
      this.tileWidth = tileWidth;
      this.tileHeight = tileHeight;
      this.numTiles = numTiles;
      
    } catch (error) {
      // Clean up canvas on error
      canvas.dispose();
      throw error;
    }
  }

  private async loadSingleImage(data: TilesetData, baseUrl: string, ctx: CanvasRenderingContext2D): Promise<void> {
    try {
      const img = await this.loadImage(new URL(data.image!, baseUrl).href);
      ctx.drawImage(img, 0, 0);
    } catch (error) {
      throw new ResourceLoadError(
        `Failed to load tileset image: ${data.image}`,
        'tileset image',
        data.image!
      );
    }
  }

  private async loadMultipleImages(
    data: TilesetData, 
    baseUrl: string, 
    ctx: CanvasRenderingContext2D, 
    tileHeight: number
  ): Promise<void> {
    try {
      await Promise.all(data.tiles!.map(async (tile) => {
        const img = await this.loadImage(new URL(tile.image, baseUrl).href);
        ctx.drawImage(img, 0, tileHeight * tile.id, data.tilewidth, data.tileheight);
      }));
    } catch (error) {
      throw new ResourceLoadError(
        `Failed to load one or more tile images`,
        'tileset tiles',
        this.url
      );
    }
  }

  /**
   * Dispose of tileset resources
   */
  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    
    if (this.texture) {
      // Texture disposal is handled by the resource manager
      this.texture = null;
    }

    this.imageData = null;
  }

  /**
   * Check if tileset is disposed
   */
  public get isDisposed(): boolean {
    return this.disposed;
  }
}
