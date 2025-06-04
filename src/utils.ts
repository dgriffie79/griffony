export function greedyMesh(
  voxels: ArrayLike<number>,
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  emptyValue: number = 255
): BigUint64Array {
  const occupancyData = new BigUint64Array(sizeZ * sizeY * ((sizeX + 63) >> 6));

  const sizeMaskX = (sizeX + 63) >> 6;

  for (let z = 0; z < sizeZ; z++) {
    for (let y = 0; y < sizeY; y++) {
      for (let x = 0; x < sizeX; x++) {
        if (voxels[z * sizeY * sizeX + y * sizeX + x] !== emptyValue) {
          const maskIndex = z * sizeY * sizeMaskX + y * sizeMaskX + (x >> 6);
          const bitIndex = x & 63;
          occupancyData[maskIndex] |= 1n << BigInt(bitIndex);
        }
      }
    }
  }

  for (let z = 0; z < sizeZ; z++) {
    for (let y = 0; y < sizeY; y++) {
      for (let x = 0; x < sizeMaskX; x++) {
        const mask = occupancyData[z * sizeY * sizeMaskX + y * sizeMaskX + x];
        const left = ~(mask >> 1n) & mask;
        const right = ~(mask << 1n) & mask;
      }
    }
  }

  return occupancyData;
}
