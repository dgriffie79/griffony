import type { VolumeOptions } from './types';
import { greedyMesh } from './utils';

export class Volume {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  emptyValue: number;
  voxels: Uint8Array | Uint16Array | Uint32Array;
  dirty: boolean = true;

  constructor(sizeX: number, sizeY: number, sizeZ: number, config: VolumeOptions = {}) {
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.emptyValue = config.emptyValue ?? 255;
    const ArrayType = config.arrayType ?? Uint8Array;
    this.voxels = new ArrayType(sizeX * sizeY * sizeZ);
    this.dirty = true;
  }

  getVoxel(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 ||
      x >= this.sizeX || y >= this.sizeY || z >= this.sizeZ) {
      return this.emptyValue;
    }
    return this.voxels[z * this.sizeY * this.sizeX + y * this.sizeX + x];
  }

  getVoxelFloor(x: number, y: number, z: number): number {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);

    if (x < 0 || y < 0 || z < 0 ||
      x >= this.sizeX || y >= this.sizeY || z >= this.sizeZ) {
      return this.emptyValue;
    }
    return this.voxels[z * this.sizeY * this.sizeX + y * this.sizeX + x];
  }

  setVoxel(x: number, y: number, z: number, value: number): void {
    if (x < 0 || y < 0 || z < 0 ||
      x >= this.sizeX || y >= this.sizeY || z >= this.sizeZ) {
      return;
    }
    this.voxels[z * this.sizeY * this.sizeX + y * this.sizeX + x] = value;
    this.dirty = true;
  }

  isSurface(x: number, y: number, z: number): boolean {
    const sizeX = this.sizeX;
    const sizeY = this.sizeY;
    const sizeZ = this.sizeZ;

    const idx = z * sizeX * sizeY + y * sizeX + x;
    if (this.voxels[idx] === this.emptyValue) {
      return false;
    }

    const neighbors = [
      [x - 1, y, z], [x + 1, y, z],
      [x, y - 1, z], [x, y + 1, z],
      [x, y, z - 1], [x, y, z + 1],
    ];

    for (let i = 0; i < neighbors.length; i++) {
      const [nx, ny, nz] = neighbors[i];
      if (nx < 0 || nx >= sizeX || ny < 0 || ny >= sizeY || nz < 0 || nz >= sizeZ) {
        return true;
      }
      const nIdx = nz * sizeX * sizeY + ny * sizeX + nx;
      if (this.voxels[nIdx] === this.emptyValue) {
        return true;
      }
    }
    return false;
  }

  generateColumns(): { columnMap: Uint32Array; columnData: Uint8Array } {
    const sizeX = this.sizeX;
    const sizeY = this.sizeY;
    const sizeZ = this.sizeZ;

    const numColumns = sizeX * sizeY;
    const columnMap = new Uint32Array(numColumns);
    const columnData: number[] = [];
    let currentOffset = 0;
    let totalVisible = 0;

    for (let y = 0; y < sizeY; y++) {
      for (let x = 0; x < sizeX; x++) {
        const colIndex = y * sizeX + x;
        columnMap[colIndex] = currentOffset;

        let z = 0;
        while (z < sizeZ) {
          // Skip non-surface voxels
          while (z < sizeZ && !this.isSurface(x, y, z)) {
            z++;
          }
          if (z >= sizeZ) break;

          // Found surface voxel, start interval
          const start = z;
          const val = this.voxels[z * sizeX * sizeY + y * sizeX + x];

          while (z < sizeZ &&
            this.isSurface(x, y, z) &&
            this.voxels[z * sizeX * sizeY + y * sizeX + x] === val) {
            z++;
          }

          // Store interval
          columnData.push(start & 0xFF);        // start z
          columnData.push((z - start) & 0xFF);  // length
          totalVisible += z - start;
          currentOffset += 2;
        }
      }
    }

    console.log('Encoded', columnData.length + numColumns * 4, 'bytes for', numColumns, 'columns', (columnData.length + numColumns * 4) / numColumns, 'bytes per column', totalVisible, 'visible voxels');

    return {
      columnMap,
      columnData: new Uint8Array(columnData)
    };
  }

  generateFaces(): Uint8Array {
    const sizeX = this.sizeX;
    const sizeY = this.sizeY;
    const sizeZ = this.sizeZ;

    const maxFaces = 4 * (sizeX * sizeY * sizeZ);
    const faces = new Uint8Array(maxFaces * 6);
    let faceCount = 0;

    for (let x = 0; x < sizeX; x++) {
      for (let y = 0; y < sizeY; y++) {
        for (let z = 0; z < sizeZ; z++) {
          const idx = z * sizeY * sizeX + y * sizeX + x;

          if (this.voxels[idx] === this.emptyValue) continue;

          // Check -X face
          if (x === 0 || this.voxels[z * sizeY * sizeX + y * sizeX + (x - 1)] === this.emptyValue) {
            faces[faceCount * 4 + 0] = x;
            faces[faceCount * 4 + 1] = y;
            faces[faceCount * 4 + 2] = z;
            faces[faceCount * 4 + 3] = 0;
            faceCount++;
          }

          // Check +X face
          if (x === sizeX - 1 || this.voxels[z * sizeY * sizeX + y * sizeX + (x + 1)] === this.emptyValue) {
            faces[faceCount * 4 + 0] = x;
            faces[faceCount * 4 + 1] = y;
            faces[faceCount * 4 + 2] = z;
            faces[faceCount * 4 + 3] = 1;
            faceCount++;
          }

          // Check -Y face
          if (y === 0 || this.voxels[z * sizeY * sizeX + (y - 1) * sizeX + x] === this.emptyValue) {
            faces[faceCount * 4 + 0] = x;
            faces[faceCount * 4 + 1] = y;
            faces[faceCount * 4 + 2] = z;
            faces[faceCount * 4 + 3] = 2;
            faceCount++;
          }

          // Check +Y face
          if (y === sizeY - 1 || this.voxels[z * sizeY * sizeX + (y + 1) * sizeX + x] === this.emptyValue) {
            faces[faceCount * 4 + 0] = x;
            faces[faceCount * 4 + 1] = y;
            faces[faceCount * 4 + 2] = z;
            faces[faceCount * 4 + 3] = 3;
            faceCount++;
          }

          // Check -Z face
          if (z === 0 || this.voxels[(z - 1) * sizeY * sizeX + y * sizeX + x] === this.emptyValue) {
            faces[faceCount * 4 + 0] = x;
            faces[faceCount * 4 + 1] = y;
            faces[faceCount * 4 + 2] = z;
            faces[faceCount * 4 + 3] = 4;
            faceCount++;
          }

          // Check +Z face
          if (z === sizeZ - 1 || this.voxels[(z + 1) * sizeY * sizeX + y * sizeX + x] === this.emptyValue) {
            faces[faceCount * 4 + 0] = x;
            faces[faceCount * 4 + 1] = y;
            faces[faceCount * 4 + 2] = z;
            faces[faceCount * 4 + 3] = 5;
            faceCount++;
          }
        }
      }
    }

    return faces.subarray(0, faceCount * 4);
  } generateFacesGreedy(): Uint8Array {
    return greedyMesh(this.voxels, this.sizeX, this.sizeY, this.sizeZ, this.emptyValue);
  }
}
