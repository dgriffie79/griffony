export function greedyMesh(
  voxels: ArrayLike<number>,
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  emptyValue: number = 255
): Uint8Array {
  const faces: number[] = [];

  // Helper function to check if a voxel is solid
  const isSolid = (x: number, y: number, z: number): boolean => {
    if (x < 0 || y < 0 || z < 0 || x >= sizeX || y >= sizeY || z >= sizeZ) {
      return false;
    }
    return voxels[z * sizeY * sizeX + y * sizeX + x] !== emptyValue;
  };

  // Process each face direction
  for (let dim = 0; dim < 3; dim++) {
    for (let direction = 0; direction < 2; direction++) {
      const normal = dim * 2 + direction;

      // Get dimensions for current slice orientation
      const u = (dim + 1) % 3; // u axis
      const v = (dim + 2) % 3; // v axis
      const w = dim;           // w axis (normal direction)

      const sizeU = [sizeX, sizeY, sizeZ][u];
      const sizeV = [sizeX, sizeY, sizeZ][v];
      const sizeW = [sizeX, sizeY, sizeZ][w];

      // Create mask for current slice
      const mask = new Array(sizeU * sizeV);

      // Process each slice along the normal direction
      for (let wPos = 0; wPos < sizeW; wPos++) {
        // Clear mask
        mask.fill(false);

        // Fill mask for current slice
        for (let vPos = 0; vPos < sizeV; vPos++) {
          for (let uPos = 0; uPos < sizeU; uPos++) {
            const pos = [0, 0, 0];
            pos[u] = uPos;
            pos[v] = vPos;
            pos[w] = wPos;

            const x = pos[0], y = pos[1], z = pos[2];
            // Check if we need a face here
            const currentSolid = isSolid(x, y, z);

            // Calculate neighbor position based on face direction
            const neighborPos = [x, y, z];
            neighborPos[w] += direction === 0 ? -1 : 1;
            const neighborSolid = isSolid(neighborPos[0], neighborPos[1], neighborPos[2]);

            // Face needed if current is solid and neighbor is not (matches original algorithm)
            mask[vPos * sizeU + uPos] = currentSolid && !neighborSolid;
          }
        }

        // Greedy mesh the mask
        for (let vPos = 0; vPos < sizeV; vPos++) {
          for (let uPos = 0; uPos < sizeU; uPos++) {
            if (!mask[vPos * sizeU + uPos]) continue;

            // Find width (u direction)
            let width = 1;
            while (uPos + width < sizeU && mask[vPos * sizeU + (uPos + width)]) {
              width++;
            }

            // Find height (v direction)
            let height = 1;
            let canExtend = true;
            while (vPos + height < sizeV && canExtend) {
              for (let i = 0; i < width; i++) {
                if (!mask[(vPos + height) * sizeU + (uPos + i)]) {
                  canExtend = false;
                  break;
                }
              }
              if (canExtend) height++;
            }
            // Clear the processed area in mask
            for (let h = 0; h < height; h++) {
              for (let w = 0; w < width; w++) {
                mask[(vPos + h) * sizeU + (uPos + w)] = false;
              }
            }

            // Generate face data - create individual unit faces to match original format
            for (let h = 0; h < height; h++) {
              for (let wOffset = 0; wOffset < width; wOffset++) {
                const facePos = [0, 0, 0];
                facePos[u] = uPos + wOffset;
                facePos[v] = vPos + h;

                // For face positioning, we need the voxel position, not the face position
                // The face belongs to the voxel, so use the voxel coordinates
                facePos[w] = wPos;

                faces.push(facePos[0], facePos[1], facePos[2], normal);
              }
            }
          }
        }
      }
    }
  }

  return new Uint8Array(faces);
}
