import type { Entity } from '../Entity';

/**
 * Base class for all entity components
 * Components encapsulate specific functionality and data for entities
 */
export abstract class Component {
  entity: Entity;
  enabled: boolean = true;

  constructor(entity: Entity) {
    this.entity = entity;
  }

  /**
   * Called every frame to update the component
   * @param deltaTime Time elapsed since last frame in seconds
   */
  abstract update(deltaTime: number): void;

  /**
   * Called when the component is destroyed
   * Override to clean up resources
   */
  destroy(): void {
    // Default implementation does nothing
  }
}