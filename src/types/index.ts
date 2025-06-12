// WebGPU and gl-matrix type extensions
import type { mat4, quat, vec3 } from 'gl-matrix';
import type { Entity } from '../Entity';

// ID Types for type safety
export type PeerId = string & { __brand: 'PeerId' };
export type NetworkId = number & { __brand: 'NetworkId' };
export type EntityId = number & { __brand: 'EntityId' };
export type PlayerNumber = number & { __brand: 'PlayerNumber' };

// Helper functions to create typed IDs
export function createPeerId(id: string): PeerId {
  return id as PeerId;
}

export function createNetworkId(id: number): NetworkId {
  return id as NetworkId;
}

export function createEntityId(id: number): EntityId {
  return id as EntityId;
}

export function createPlayerNumber(num: number): PlayerNumber {
  return num as PlayerNumber;
}

// Global types
export interface GameSettings {
  version: number;
  invertMouse: boolean;
  useGreedyMesh: boolean;
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
    toggleMesh: string;
    adjustWeapon: string;
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

export interface ObjectData extends Record<string, unknown> {
  type: string;
  x: number;
  y: number;
  properties?: PropertyData[];
}

export interface PropertyData {
  name: string;
  value: string | number | boolean | null;
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

// Network message types - Expanded for comprehensive multiplayer support
export const MessageType = {
  // Connection Management
  PLAYER_JOIN: 0,
  PLAYER_LEAVE: 1,
  GAME_STATE_REQUEST: 2,
  GAME_STATE_RESPONSE: 3,
  HOST_HANDOFF: 4,
  FULL_GAME_STATE: 33, // Send complete game state to new clients
  
  // Entity Synchronization
  ENTITY_UPDATE: 5,
  ENTITY_CREATE: 6,
  ENTITY_DESTROY: 7,
  ENTITY_STATE_BATCH: 8,
  
  // Player Input & Actions
  PLAYER_INPUT: 9,
  PLAYER_ACTION: 10,
  PLAYER_RESPAWN: 11,
  PLAYER_TELEPORT: 12,
  
  // Combat System
  COMBAT_ATTACK: 13,
  COMBAT_HIT: 14,
  COMBAT_DAMAGE: 15,
  COMBAT_HEAL: 16,
  COMBAT_DEATH: 17,
  WEAPON_SWITCH: 18,
  WEAPON_SWING: 19,
  
  // Terrain & World
  TERRAIN_MODIFY: 20,
  TERRAIN_BATCH: 21,
  CHUNK_REQUEST: 22,
  CHUNK_DATA: 23,
  
  // Game Events
  GAME_EVENT: 24,
  OBJECTIVE_UPDATE: 25,
  
  // Communication
  CHAT: 26,
  
  // WebRTC Signaling (for manual signaling)
  SIGNALING_OFFER: 27,
  SIGNALING_ANSWER: 28,
  SIGNALING_ICE_CANDIDATE: 29,
  
  // Utility & Debug
  PING: 30,
  PONG: 31,
  TIME_SYNC: 32,
} as const;

export type MessageTypeValue = typeof MessageType[keyof typeof MessageType];

// Message priority levels for batching and throttling
export enum MessagePriority {
  CRITICAL = 0,    // Combat hits, deaths, critical game events
  HIGH = 1,        // Player inputs, attacks, terrain modifications
  MEDIUM = 2,      // Entity updates, position sync
  LOW = 3,         // Chat, non-critical events
}

// Base network message interface
export interface NetworkMessage {
  type: MessageTypeValue;
  priority: MessagePriority;
  timestamp: number;
  sequenceNumber: number;
  data: Record<string, unknown>;
}

// Connection Management Messages
export interface PlayerJoinMessage extends NetworkMessage {
  type: typeof MessageType.PLAYER_JOIN;
  data: {
    playerId: string;
    playerName: string;
    position: vec3;
    rotation: quat;
    weaponId?: string;
  };
}

export interface PlayerLeaveMessage extends NetworkMessage {
  type: typeof MessageType.PLAYER_LEAVE;
  data: {
    networkId: string;
    reason?: string;
  };
}

export interface GameStateRequestMessage extends NetworkMessage {
  type: typeof MessageType.GAME_STATE_REQUEST;
  data: {
    networkId: string;
  };
}

export interface GameStateResponseMessage extends NetworkMessage {
  type: typeof MessageType.GAME_STATE_RESPONSE;
  data: {
    entities: EntitySnapshot[];
    terrainModifications: TerrainModification[];
    gameTime: number;
    hostId: string;
  };
}

export interface FullGameStateMessage extends NetworkMessage {
  type: typeof MessageType.FULL_GAME_STATE;
  data: {
    entities: EntitySnapshot[];
    playerPosition?: vec3;
    playerRotation?: quat;
    gameTime: number;
    hostId: string;
    peerMappings?: Array<{ peerId: string; networkId: string }>; // Peer to network ID mappings
  };
}

// Entity Synchronization Messages
export interface EntityUpdateMessage extends NetworkMessage {
  type: typeof MessageType.ENTITY_UPDATE;
  data: {
    entities: EntityUpdateData[];
  };
}

export interface EntityUpdateData {
  id: number;
  position: [number, number, number];
  rotation: [number, number, number, number];
  velocity?: [number, number, number];
  modelId?: number;
  frame?: number;
  entityType: 'player' | 'entity';
}

export interface EntityCreateMessage extends NetworkMessage {
  type: typeof MessageType.ENTITY_CREATE;
  data: {
    entityId: string;
    entityType: string;
    position: vec3;
    rotation: quat;
    ownerId?: string;
    properties?: Record<string, unknown>;
  };
}

export interface EntityDestroyMessage extends NetworkMessage {
  type: typeof MessageType.ENTITY_DESTROY;
  data: {
    entityId: string;
    reason?: string;
  };
}

export interface EntityStateBatchMessage extends NetworkMessage {
  type: typeof MessageType.ENTITY_STATE_BATCH;
  data: {
    entities: EntitySnapshot[];
    timestamp: number;
  };
}

// Player Input & Actions  
export interface PlayerInput {
  keys: {
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    jump: boolean;
    crouch: boolean;
    up: boolean;
    down: boolean;
  };
  mouse: {
    deltaX: number;
    deltaY: number;
  };
}

export interface PlayerUpdateData {
  input?: PlayerInput;
  timestamp: number;
  position?: vec3;
  rotation?: quat;
  velocity?: vec3;
  sequenceNumber?: number;
  playerName?: string;
}

export interface PlayerInputMessage extends NetworkMessage {
  type: typeof MessageType.PLAYER_INPUT;
  data: {
    networkId: string;
    inputSequence: number;
    timestamp: number;    keys: {
      forward: boolean;
      backward: boolean;
      left: boolean;
      right: boolean;
      jump: boolean;
      crouch: boolean;
      up: boolean;
      down: boolean;
    };
    mouse: {
      deltaX: number;
      deltaY: number;
    };
  };
}

export interface PlayerActionMessage extends NetworkMessage {
  type: typeof MessageType.PLAYER_ACTION;
  data: {
    networkId: string;
    action: 'attack' | 'block' | 'interact' | 'reload' | 'aim';
    timestamp: number;
    position?: vec3;
    direction?: vec3;
  };
}

// Combat Messages
export interface CombatAttackMessage extends NetworkMessage {
  type: typeof MessageType.COMBAT_ATTACK;
  data: {
    attackerId: string;
    weaponId: string;
    position: vec3;
    direction: vec3;
    timestamp: number;
    attackSequence: number;
  };
}

export interface CombatHitMessage extends NetworkMessage {
  type: typeof MessageType.COMBAT_HIT;
  data: {
    attackerId: string;
    targetId: string;
    damage: number;
    position: vec3;
    direction: vec3;
    weaponId: string;
    timestamp: number;
    attackSequence: number;
  };
}

export interface CombatDamageMessage extends NetworkMessage {
  type: typeof MessageType.COMBAT_DAMAGE;
  data: {
    targetId: string;
    damage: number;
    sourceId?: string;
    damageType: 'melee' | 'ranged' | 'environmental';
    timestamp: number;
  };
}

export interface WeaponSwitchMessage extends NetworkMessage {
  type: typeof MessageType.WEAPON_SWITCH;
  data: {
    networkId: string;
    weaponId: string;
    timestamp: number;
  };
}

export interface WeaponSwingMessage extends NetworkMessage {
  type: typeof MessageType.WEAPON_SWING;
  data: {
    networkId: string;
    weaponId: string;
    startPosition: vec3;
    endPosition: vec3;
    swingDuration: number;
    timestamp: number;
  };
}

// Terrain Messages
export interface TerrainModifyMessage extends NetworkMessage {
  type: typeof MessageType.TERRAIN_MODIFY;
  data: {
    modifications: TerrainModification[];
    timestamp: number;
  };
}

export interface TerrainBatchMessage extends NetworkMessage {
  type: typeof MessageType.TERRAIN_BATCH;
  data: {
    modifications: TerrainModification[];
    timestamp: number;
  };
}

// Chat Message
export interface ChatMessage extends NetworkMessage {
  type: typeof MessageType.CHAT;
  data: {
    playerId: string;
    playerName: string;
    message: string;
    timestamp: number;
  };
}

// Utility Messages
export interface PingMessage extends NetworkMessage {
  type: typeof MessageType.PING;
  data: {
    timestamp: number;
    senderId: string;
  };
}

export interface PongMessage extends NetworkMessage {
  type: typeof MessageType.PONG;
  data: {
    originalTimestamp: number;
    responseTimestamp: number;
    senderId: string;
  };
}

// Supporting Data Structures
export interface EntitySnapshot {
  entityId: string;
  entityType?: string;
  position: vec3;
  rotation: quat;
  scale?: vec3;
  velocity?: vec3;
  health?: number;
  modelId?: number;
  frame?: number;
  animationFrame?: number;
  ownerId?: string;
  isNetworkEntity?: boolean;
  physicsLayer?: number;
  gravity?: boolean;
  collision?: boolean;
  spawn?: boolean;
  properties?: Record<string, unknown>;
  networkId?: string;
  // Component data
  render?: {
    modelId?: number;
    frame?: number;
    visible?: boolean;
    scale?: vec3;
    animationFrame?: number;
  };
  physics?: {
    hasGravity?: boolean;
    hasCollision?: boolean;
    layer?: number;
    velocity?: vec3;
    radius?: number;
    height?: number;
  };
  network?: {
    ownerId?: string;
    isAuthoritative?: boolean;
  };
  maxHealth?: number;
  currentHealth?: number;
  isDead?: boolean;  player?: {
    playerName?: string;
    peerId?: string | null;
    head?: EntitySnapshot;
  };
}

export interface TerrainModification {
  x: number;
  y: number;
  z: number;
  oldValue: number;
  newValue: number;
  timestamp: number;
  playerId: string;
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
  source?: Entity | null;
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

// Game Manager Types
export interface GameStateData {
  entities: EntitySnapshot[];
  gameTime: number;
  hostId: string;
  peerMappings?: Array<{ peerId: string; networkId: string }>;
}

export interface GameDebugInfo {
  gameMode: 'single-player' | 'multiplayer';
  isHost: boolean;
  gameId: string;
  isConnected: boolean;
  entityCount: number;
  localPlayerNetworkId: string | null;
  playerEntities: Array<{
    id: number;
    name?: string;
    isLocal?: boolean;
    networkId?: string;
  }>;
}
