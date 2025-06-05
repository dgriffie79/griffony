// WebGPU and gl-matrix type extensions
import type { mat4, quat, vec3 } from 'gl-matrix';
import type { Entity } from '../Entity';

// Global types
export interface GameSettings {
  version: number;
  invertMouse: boolean;
  keybinds: {
    forward: string;
    backward: string;
    left: string;
    right: string;
    up: string;
    down: string;
    jump: string;
    respawn: string;
    godMode: string;
    attack: string;
    block: string;
    switchWeapon: string;
  };
}

export interface GameState {
  playerPos: [number, number, number];
  playerOrientation: [number, number, number, number];
  playerHeadRotation: [number, number, number, number];
  godMode: boolean;
  showingMenu: boolean;
}

// Tileset data structures
export interface TilesetData {
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  image?: string;
  tiles?: TileData[];
}

export interface TileData {
  id: number;
  image: string;
}

// Level data structures
export interface LevelData {
  width: number;
  height: number;
  layers: LayerData[];
}

export interface LayerData {
  type: 'tilelayer' | 'objectgroup';
  name: string;
  data?: number[];
  objects?: ObjectData[];
}

export interface ObjectData {
  type: string;
  x: number;
  y: number;
  properties?: PropertyData[];
}

export interface PropertyData {
  name: string;
  value: any;
}

// Volume options
export interface VolumeOptions {
  emptyValue?: number;
  arrayType?: Uint8ArrayConstructor | Uint16ArrayConstructor | Uint32ArrayConstructor;
}

// Model data
export interface ModelData {
  size: { x: number; y: number; z: number };
  voxels: Uint8Array;
  palette: number[][];
}

// Network message types
export const MessageType = {
  PLAYER_JOIN: 0,
  PLAYER_LEAVE: 1,
  CHAT: 2,
  ENTITY_UPDATE: 3,
} as const;

export type MessageTypeValue = typeof MessageType[keyof typeof MessageType];

// Network message interfaces
export interface NetworkMessage {
  type: MessageTypeValue;
  data: any;
}

export interface PlayerJoinMessage extends NetworkMessage {
  type: typeof MessageType.PLAYER_JOIN;
  data: {
    id: number;
    position: vec3;
    rotation: quat;
  };
}

export interface EntityUpdateMessage extends NetworkMessage {
  type: typeof MessageType.ENTITY_UPDATE;
  data: {
    id: number;
    position: vec3;
    rotation: quat;
    headRotation: quat;
  };
}

// Combat System Types
export interface WeaponData {
  id: string;
  name: string;
  damage: number;
  range: number;
  attackSpeed: number; // attacks per second
  swingDuration: number; // milliseconds for full swing
  modelName: string;
}

export interface CombatStats {
  health: number;
  maxHealth: number;
  defense: number;
  lastDamageTime: number;
  isDead: boolean;
}

export interface AttackInfo {
  damage: number;
  source: Entity;
  direction: vec3;
  position: vec3;
  weaponId?: string;
}

export interface WeaponSwing {
  isSwinging: boolean;
  startTime: number;
  duration: number;
  progress: number; // 0-1
  hasHit: boolean;
  targetPosition: vec3;
}

// Weapon Types
export enum WeaponType {
  SWORD = 'sword',
  AXE = 'axe',
  HAMMER = 'hammer',
  BOW = 'bow',
  STAFF = 'staff'
}

// Combat Events
export interface CombatEvent {
  type: 'attack' | 'hit' | 'death' | 'heal';
  source?: Entity;
  target?: Entity;
  damage?: number;
  position?: vec3;
  weaponId?: string;
}

// Physics System Types
export interface CollisionEvent {
  type: 'entity' | 'terrain';
  entity: Entity;
  otherEntity?: Entity;
  position: vec3;
  normal: vec3;
  velocity: vec3;
  force: number;
}

export type CollisionCallback = (event: CollisionEvent) => void;
