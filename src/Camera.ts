import { mat4 } from 'gl-matrix';
import type { Entity } from './Entity';
import type { Renderer } from './Renderer';

export class Camera {
  static main = new Camera();

  entity: Entity | null = null;

  fov: number = Math.PI / 3;
  aspect: number = 1;
  near: number = 0.001;
  far: number = 1000;
  projection: mat4 = mat4.create();
  view: mat4 = mat4.create();

  update(): void {
    // Note: renderer will be imported where needed
    const renderer = (globalThis as any).renderer as Renderer;
    this.aspect = renderer.viewport[0] / renderer.viewport[1];
    mat4.perspective(this.projection, this.fov, this.aspect, this.near, this.far);
    mat4.rotateX(this.projection, this.projection, -Math.PI / 2);
    
    if (this.entity) {
      mat4.invert(this.view, this.entity.localToWorldTransform);
    }
  }
}
