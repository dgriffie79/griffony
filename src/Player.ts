import { vec3, quat } from 'gl-matrix';
import { Entity } from './Entity';
import { FirstPersonWeapon } from './FirstPersonWeapon';

export class Player extends Entity {
  gravity: boolean = true;
  collision: boolean = true;
  height: number = 0.5;
  radius: number = 0.25;
  head: Entity = new Entity();
  fpWeapon: FirstPersonWeapon;

  constructor(id: number = Entity.nextId++) {
    super();
    this.id = id;
    this.model = globalThis.models?.['player'] || null;
    this.head.id = Entity.nextId++;
    this.head.parent = this;
    this.head.localPosition = vec3.fromValues(0, 0, 0.8 * this.height);
    this.children.push(this.head);
    
    // Create first-person weapon view
    this.fpWeapon = new FirstPersonWeapon(this);
  }

  respawn(): void {
    vec3.zero(this.localPosition);
    vec3.zero(this.vel);
    quat.identity(this.localRotation);
    quat.identity(this.head.localRotation);
    this.dirty = true;

    for (const e of Entity.all) {
      if (e.spawn) {
        vec3.copy(this.localPosition, e.worldPosition);
        quat.copy(this.localRotation, e.worldRotation);
        break;
      }
    }
  }
}
