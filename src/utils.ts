import { MeshStats } from './MeshStats.js';

export function greedyMesh(
  voxels: ArrayLike<number>,
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  emptyValue: number = 255,
  collectStats: boolean = true
): Uint8Array {
  const faces: number[] = [];
  
  // Statistics for mesh optimization
  let originalFaceCount = 0;
  let mergedFaceCount = 0;
  let maxWidth = 0;
  let maxHeight = 0;
  let totalSavedFaces = 0;
  let largestMerge = 0;

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
            }            // Clear the processed area in mask
            for (let h = 0; h < height; h++) {
              for (let w = 0; w < width; w++) {
                mask[(vPos + h) * sizeU + (uPos + w)] = false;
              }
            }
            
            // Track statistics
            if (collectStats) {
              // Count the number of unit faces in this merged region
              const unitFacesInRegion = width * height;
              originalFaceCount += unitFacesInRegion;
              
              // Count as one merged face
              mergedFaceCount++;
              
              // Track largest dimensions
              maxWidth = Math.max(maxWidth, width);
              maxHeight = Math.max(maxHeight, height);
              
              // Track faces saved by merging
              const savedFaces = unitFacesInRegion - 1; // One merged face instead of many
              totalSavedFaces += savedFaces;
              
              // Track largest merged region
              largestMerge = Math.max(largestMerge, unitFacesInRegion);
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
        }      }
    }
  }
    // Report statistics if requested
  if (collectStats && typeof globalThis !== 'undefined') {
    // Record mesh statistics
    MeshStats.getInstance().recordMeshStats(
      originalFaceCount,
      mergedFaceCount,
      maxWidth,
      maxHeight,
      mergedFaceCount,
      totalSavedFaces,
      largestMerge
    );
    
    // Log to console as well
    console.log(`Greedy Mesh Stats:
      Original faces: ${originalFaceCount}
      Merged regions: ${mergedFaceCount}
      Faces saved: ${totalSavedFaces} (${((totalSavedFaces/originalFaceCount)*100).toFixed(2)}%)
      Max dimensions: ${maxWidth}x${maxHeight}
      Largest merge: ${largestMerge} faces`);
  }

  return new Uint8Array(faces);
}

/**
 * Optimized greedy mesh algorithm that generates variable-sized quads
 * Each face contains: x, y, z, normal, width, height (6 values per face)
 * The voxel value is sampled in the shader using the face coordinates
 */
export function optimizedGreedyMesh(
  voxels: ArrayLike<number>,
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  emptyValue: number = 255,
  collectStats: boolean = true
): Uint32Array {
  const faces: number[] = [];
  
  // Statistics for mesh optimization
  let originalFaceCount = 0;
  let optimizedFaceCount = 0;
  let maxWidth = 0;
  let maxHeight = 0;
  let totalSavedFaces = 0;
  let largestMerge = 0;

  // DEBUG: Track voxel values being processed (for debugging fatta model)
  let debugVoxelCounts = new Map<number, number>();
  let debugProcessedVoxels = 0;
  let debugSkippedVoxels = 0;

  // Helper function to check if a voxel is solid
  const isSolid = (x: number, y: number, z: number): boolean => {
    if (x < 0 || y < 0 || z < 0 || x >= sizeX || y >= sizeY || z >= sizeZ) {
      return false;
    }
    const value = voxels[z * sizeY * sizeX + y * sizeX + x];
    
    // DEBUG: Count voxel values
    debugVoxelCounts.set(value, (debugVoxelCounts.get(value) || 0) + 1);
    
    const solid = value !== emptyValue;
    if (solid) {
      debugProcessedVoxels++;
    } else {
      debugSkippedVoxels++;
    }
    
    return solid;
  };

  // Helper function to get voxel value
  const getVoxelValue = (x: number, y: number, z: number): number => {
    if (x < 0 || y < 0 || z < 0 || x >= sizeX || y >= sizeY || z >= sizeZ) {
      return emptyValue;
    }
    return voxels[z * sizeY * sizeX + y * sizeX + x];
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
      const sizeW = [sizeX, sizeY, sizeZ][w];      // Create mask for current slice storing voxel values
      // Use -1 to represent "no face needed" since 0 is a valid voxel value
      const mask = new Array(sizeU * sizeV).fill(-1);

      // Process each slice along the normal direction
      for (let wPos = 0; wPos < sizeW; wPos++) {
        // Clear mask
        mask.fill(-1);

        // Fill mask for current slice
        for (let vPos = 0; vPos < sizeV; vPos++) {
          for (let uPos = 0; uPos < sizeU; uPos++) {
            const pos = [0, 0, 0];
            pos[u] = uPos;
            pos[v] = vPos;
            pos[w] = wPos;

            const x = pos[0], y = pos[1], z = pos[2];
            
            // Check if we need a face here
            const currentValue = getVoxelValue(x, y, z);
            const currentSolid = currentValue !== emptyValue;

            // Calculate neighbor position based on face direction
            const neighborPos = [x, y, z];
            neighborPos[w] += direction === 0 ? -1 : 1;
            const neighborSolid = isSolid(neighborPos[0], neighborPos[1], neighborPos[2]);

            // Face needed if current is solid and neighbor is not
            if (currentSolid && !neighborSolid) {
              mask[vPos * sizeU + uPos] = currentValue;
            }
          }
        }        // Greedy mesh the mask - create optimized quads
        for (let vPos = 0; vPos < sizeV; vPos++) {
          for (let uPos = 0; uPos < sizeU; uPos++) {
            const voxelValue = mask[vPos * sizeU + uPos];
            if (voxelValue === -1) continue; // Skip if no face needed

            // Find width (u direction) - ensure all voxels have same value
            let width = 1;
            while (uPos + width < sizeU && mask[vPos * sizeU + (uPos + width)] === voxelValue) {
              width++;
            }

            // Find height (v direction) - ensure all voxels in rectangle have same value
            let height = 1;
            let canExtend = true;
            while (vPos + height < sizeV && canExtend) {
              for (let i = 0; i < width; i++) {
                if (mask[(vPos + height) * sizeU + (uPos + i)] !== voxelValue) {
                  canExtend = false;
                  break;
                }
              }
              if (canExtend) height++;
            }

            // Clear the processed area in mask
            for (let h = 0; h < height; h++) {
              for (let w = 0; w < width; w++) {
                mask[(vPos + h) * sizeU + (uPos + w)] = -1;
              }
            }
            
            // Track statistics
            if (collectStats) {
              const unitFacesInRegion = width * height;
              originalFaceCount += unitFacesInRegion;
              optimizedFaceCount++;
              
              maxWidth = Math.max(maxWidth, width);
              maxHeight = Math.max(maxHeight, height);
              
              const savedFaces = unitFacesInRegion - 1;
              totalSavedFaces += savedFaces;
              largestMerge = Math.max(largestMerge, unitFacesInRegion);
            }

            // Generate optimized face data
            const facePos = [0, 0, 0];
            facePos[u] = uPos;
            facePos[v] = vPos;
            facePos[w] = wPos;

            // Store: x, y, z, normal, width, height, padding1, padding2 (8 values per face for proper alignment)
            // Now using 32-bit values, no need to clamp to uint8 range
            faces.push(
              facePos[0], 
              facePos[1], 
              facePos[2], 
              normal, 
              width, 
              height,
              0, // padding uint32 1
              0  // padding uint32 2
            );
          }
        }
      }
    }
  }
  
  // Convert to Uint32Array - each face has 8 uint32 values
  return new Uint32Array(faces);
}
