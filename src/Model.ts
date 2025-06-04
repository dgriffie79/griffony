import { Volume } from './Volume';

export class Model {
  url: string;
  volume!: Volume;
  palette!: Uint8Array;

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
    const sourceVoxels = new Uint8Array(dataView.buffer, 12, numVoxels);

    // Transform from [x][y][z] to [z][y][x]
    for (let x = 0; x < sizeX; x++) {
      for (let y = 0; y < sizeY; y++) {
        for (let z = 0; z < sizeZ; z++) {
          const srcIdx = x * sizeY * sizeZ + y * sizeZ + z;
          this.volume.setVoxel(x, sizeY - y - 1, sizeZ - z - 1, sourceVoxels[srcIdx]);
        }
      }
    }

    this.palette = new Uint8Array(256 * 4);

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
