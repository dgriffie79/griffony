// Global type declarations for griffony game

import type { Camera } from './Camera';
import type { Level } from './Level';
import type { Tileset } from './Tileset';
import type { Renderer } from './Renderer';
import type { Model } from './Model';
import type { Entity } from './Entity';

declare global {
  var camera: Camera;
  var player: Entity;
  var level: Level;
  var tileset: Tileset;
  var renderer: Renderer;  var models: Model[];
  var modelNames: string[];
  var Entity: typeof Entity;
  
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
  
  // Game loop timing
  var lastTime: number;
  var deltaTime: number;
  var frameCount: number;
  var fps: number;
}

export {};
