// WebGPU and gl-matrix type extensions
import type { mat4, quat, vec3 } from 'gl-matrix';

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

// Renderer constants
export const RENDERMODE = 1; // Only quads rendering is used

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
