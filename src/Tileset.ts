import type { TilesetData } from './types';

export class Tileset {
  url: string;
  tileWidth: number = 0;
  tileHeight: number = 0;
  numTiles: number = 0;
  imageData: ImageData | null = null;
  texture: GPUTexture | null = null;

  constructor(url: string = '') {
    this.url = url;
  }

  private async loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = url;
      img.onload = () => resolve(img);
      img.onerror = reject;
    });
  }

  async load(): Promise<void> {
    const response = await fetch(this.url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    let data: TilesetData;
    try {
      data = await response.json();
    } catch (e) {
      console.error('Invalid tileset:', e);
      throw e;
    }

    const tileWidth = data.tilewidth;
    const tileHeight = data.tileheight;
    const numTiles = data.tilecount;

    const baseUrl = new URL(this.url, window.location.href).href;

    const canvas = document.createElement('canvas');
    canvas.width = tileWidth;
    canvas.height = tileHeight * numTiles;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Failed to create 2d context');
    }

    if (data.image) {
      const img = await this.loadImage(new URL(data.image, baseUrl).href);
      ctx.drawImage(img, 0, 0);
    } else if (data.tiles) {
      await Promise.all(data.tiles.map(async (tile) => {
        const img = await this.loadImage(new URL(tile.image, baseUrl).href);
        ctx.drawImage(img, 0, tileHeight * tile.id, tileWidth, tileHeight);
      }));
    } else {
      throw new Error('Invalid tileset');
    }

    this.imageData = ctx.getImageData(0, 0, tileWidth, tileHeight * numTiles);
    this.tileWidth = tileWidth;
    this.tileHeight = tileHeight;
    this.numTiles = numTiles;
    
    // Note: renderer will be imported where needed
    const renderer = (globalThis as any).renderer;
    if (renderer) {
      renderer.registerTileset(this);
    }
  }
}
