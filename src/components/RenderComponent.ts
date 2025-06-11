import { Component } from './Component';
import type { Entity } from '../Entity';

/**
 * Handles visual rendering for entities
 * Replaces the old modelId system with more flexible rendering data
 */
export class RenderComponent extends Component {
  modelId: number;
  frame: number = 0;
  animationFrame: number = 0;
  frameTime: number = 0;
  animationSpeed: number = 1.0;
  visible: boolean = true;

  constructor(entity: Entity, modelId: number) {
    super(entity);
    this.modelId = modelId;
  }

  update(deltaTime: number): void {
    if (!this.enabled || !this.visible) return;

    // Update animation timing
    if (this.animationSpeed > 0) {
      this.frameTime += deltaTime;
      
      // Simple frame animation - could be enhanced with proper animation system
      if (this.frameTime >= 1.0 / this.animationSpeed) {
        this.frame++;
        this.animationFrame++;
        this.frameTime = 0;
      }
    }
  }

  /**
   * Set the model for this entity
   * @param modelId Index of the model in the global models array
   */
  setModel(modelId: number): void {
    this.modelId = modelId;
  }

  /**
   * Set the model by name
   * @param modelName Name of the model to use
   */
  setModelByName(modelName: string): void {
    if (globalThis.modelNames) {
      const modelId = globalThis.modelNames.indexOf(modelName);
      if (modelId !== -1) {
        this.modelId = modelId;
      } else {
        console.warn(`Model "${modelName}" not found. Available models: ${globalThis.modelNames.join(', ')}`);
      }
    }
  }

  /**
   * Hide/show the entity
   */
  setVisible(visible: boolean): void {
    this.visible = visible;
  }
}