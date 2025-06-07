import { Logger } from './Logger.js';

// Create logger instance for this module
const logger = Logger.getInstance();

/**
 * Utility class for tracking mesh statistics
 */
export class MeshStats {
  private static instance: MeshStats | null = null;
  
  // Statistics
  private originalFaceCount: number = 0;
  private greedyFaceCount: number = 0;
  private maxMergedWidth: number = 0;
  private maxMergedHeight: number = 0;
  private totalMergedFaces: number = 0;
  private totalSavedFaces: number = 0;
  private largestSavedRegion: number = 0;
  private statsDisplay: HTMLElement | null = null;
  
  private constructor() {
    // No UI display initialization
  }
  
  /**
   * Get the singleton instance
   */
  public static getInstance(): MeshStats {
    if (!MeshStats.instance) {
      MeshStats.instance = new MeshStats();
    }
    return MeshStats.instance;
  }
    /**
   * Record statistics from a greedy meshing operation
   */
  public recordMeshStats(
    originalFaces: number,
    greedyMergedFaces: number,
    maxWidth: number, 
    maxHeight: number,
    newTotalMergedFaces: number,
    newSavedFaces: number,
    largestMerge: number
  ): void {
    this.originalFaceCount = originalFaces;
    this.greedyFaceCount = greedyMergedFaces;
    this.maxMergedWidth = Math.max(this.maxMergedWidth, maxWidth);
    this.maxMergedHeight = Math.max(this.maxMergedHeight, maxHeight);
    this.totalMergedFaces = newTotalMergedFaces;
    this.totalSavedFaces = newSavedFaces;
    this.largestSavedRegion = Math.max(this.largestSavedRegion, largestMerge);
      // Log statistics to console for debugging
    const savingsPercent = this.originalFaceCount > 0 
      ? ((this.totalSavedFaces / this.originalFaceCount) * 100).toFixed(2) 
      : '0.00';
    
    logger.debug('MESH', `Greedy Mesh Stats: 
      Original Faces: ${this.originalFaceCount.toLocaleString()} 
      Merged Faces: ${this.greedyFaceCount.toLocaleString()} 
      Saved: ${this.totalSavedFaces.toLocaleString()} (${savingsPercent}%)`);
  }
  
  /**
   * Get current statistics for display elsewhere
   */
  public getStats(): { 
    originalFaces: number, 
    greedyFaces: number, 
    facesSaved: number,
    savingsPercent: string 
  } {
    const savingsPercent = this.originalFaceCount > 0 
      ? ((this.totalSavedFaces / this.originalFaceCount) * 100).toFixed(2) 
      : '0.00';      return {
      originalFaces: this.originalFaceCount,
      greedyFaces: this.greedyFaceCount,
      facesSaved: this.totalSavedFaces,
      savingsPercent
    };
  }
    /**
   * Reset statistics
   */
  public reset(): void {
    this.originalFaceCount = 0;
    this.greedyFaceCount = 0;
    this.maxMergedWidth = 0;
    this.maxMergedHeight = 0;
    this.totalMergedFaces = 0;
    this.totalSavedFaces = 0;
    this.largestSavedRegion = 0;
    this.updateDisplay();
  }
  
  /**
   * Update the statistics display
   * Currently a no-op as UI is handled elsewhere
   */
  private updateDisplay(): void {
    // No-op - mesh stats are displayed through the timeLabel in main.ts
  }
  
  /**
   * Toggle visibility of the stats display
   */
  public toggleVisibility(): void {
    if (this.statsDisplay) {
      this.statsDisplay.style.display = 
        this.statsDisplay.style.display === 'none' ? 'block' : 'none';
    }
  }
}
