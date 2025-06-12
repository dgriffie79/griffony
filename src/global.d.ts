// Global type declarations for griffony game

import type { Camera } from './Camera';
import type { Level } from './Level';
import type { Tileset } from './Tileset';
import type { Renderer } from './Renderer';
import type { Model } from './Model';
import type { Entity } from './Entity';
import type { PhysicsSystem } from './PhysicsSystem';
import type { GameResources } from './GameResources';

declare global {
  var camera: Camera;
  var player: Entity | null;
  var level: Level;
  var tileset: Tileset;
  var renderer: Renderer;
  var models: Model[];
  var modelNames: string[];
  var Entity: typeof Entity;
  var physicsSystem: PhysicsSystem;
  var gameResources: GameResources;
  var gameManager: import('./GameManager').GameManager;
  var useGreedyMesh: boolean;
  var greedyMesh: typeof import('./utils').greedyMesh;
  var triggerAttackFlash: () => void;
  var playAttackSound: () => void;
  var playHitSound: () => void;
  var net: import('./Net').Net;
  var combatSystem: import('./CombatSystem').CombatSystem;
  
  // Game state variables
  var gameSettings: {
    renderDistance: number;
    fov: number;
    mouseSensitivity: number;
    debug: boolean;
  };
  
  var gameState: {
    isPaused: boolean;
    isLoading: boolean;
    currentLevel: string;
    playerCount: number;
  };
  
  // Input handling
  var keys: Record<string, boolean>;
  var mouse: {
    x: number;
    y: number;
    deltaX: number;
    deltaY: number;
    buttons: Record<number, boolean>;
  };
  
  // WebGPU context
  var canvas: HTMLCanvasElement;
  
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
  
  // Game loop timing
  var lastTime: number;
  var deltaTime: number;
  var frameCount: number;
  var fps: number;
}

export {};
