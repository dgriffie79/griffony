import { mat4, quat, vec3 } from 'gl-matrix';
import type { Model } from './Model';
import type { Level } from './Level';

export class Entity {
  static all: Entity[] = [];
  static nextId: number = 1;

  id: number = 0;
  parent: Entity | null = null;
  children: Entity[] = [];

  dirty: boolean = true;
  localPosition: vec3 = vec3.create();
  localRotation: quat = quat.create();
  localScale: vec3 = vec3.fromValues(1, 1, 1);
  localToWorldTransform: mat4 = mat4.create();

  worldPosition: vec3 = vec3.create();
  worldRotation: quat = quat.create();
  worldScale: vec3 = vec3.fromValues(1, 1, 1);
  worldToLocalTransform: mat4 = mat4.create();

  model: Model | null = null;
  modelId: number = -1;
  frame: number = 0;
  frameTime: number = 0;
  animationFrame: number = 0;

  height: number = 0;
  radius: number = 0;
  vel: vec3 = vec3.create();
  gravity: boolean = false;
  collision: boolean = false;
  spawn: boolean = false;

  constructor() {
    Entity.all.push(this);
  }

  updateTransforms(parentTransform: mat4 | null): void {
    if (this.dirty) {
      mat4.fromRotationTranslationScale(
        this.localToWorldTransform,
        this.localRotation,
        this.localPosition,
        this.localScale
      );

      if (parentTransform) {
        mat4.multiply(this.localToWorldTransform, parentTransform, this.localToWorldTransform);
      }

      mat4.getTranslation(this.worldPosition, this.localToWorldTransform);
      mat4.getRotation(this.worldRotation, this.localToWorldTransform);
      mat4.getScaling(this.worldScale, this.localToWorldTransform);
      this.dirty = false;
    }

    for (const child of this.children) {
      child.dirty = true;
      child.updateTransforms(this.localToWorldTransform);
    }
  }

  static deserialize(data: any): Entity | null {
    let entity: Entity;

    switch (data.type.toUpperCase()) {
      case 'PLAYER':
        return null;      case 'SPAWN':
        entity = new Entity();
        entity.spawn = true;
        entity.model = globalThis.models['spawn'];
        break;
      default:
        entity = new Entity();
        break;
    }

    entity.localPosition = vec3.fromValues(data.x / 32, data.y / 32, 1);

    for (const property of data.properties ?? []) {
      switch (property.name) {
        case 'rotation':
          quat.fromEuler(entity.localRotation, 0, 0, property.value);
          break;
        case 'scale':
          entity.localScale = vec3.fromValues(property.value, property.value, property.value);
          entity.radius = property.value;
          break;
        case 'model_id':
          entity.modelId = property.value;
          break;
      }    }
    
    entity.model = globalThis.models[entity.modelId];

    return entity;
  }

  onGround(terrain: Level): boolean {
    const r = 0.85 * this.radius;
    const x = this.worldPosition[0];
    const y = this.worldPosition[1];
    const z = this.worldPosition[2] - Number.EPSILON;

    return !!(
      terrain.volume.getVoxelFloor(x, y, z) ||
      terrain.volume.getVoxelFloor(x + r, y, z) ||
      terrain.volume.getVoxelFloor(x - r, y, z) ||
      terrain.volume.getVoxelFloor(x, y + r, z) ||
      terrain.volume.getVoxelFloor(x, y - r, z)
    );
  }

  update(elapsed: number): void {
    // Base implementation - can be overridden by subclasses
  }
}
