# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Start dev server**: `npm start` (runs on port 5173)
- **Build**: `npm run build`
- **Preview build**: `npm preview`
- **Lint code**: `npm run lint`
- **Type check**: `npm run type-check`
- **Type check with watch**: `npm run type-check:watch`

## Core Architecture

This is a multiplayer 3D voxel-based game built with TypeScript and WebGPU. The architecture follows a modular entity-component pattern with these core systems:

### Entity System (`Entity.ts`)
- Central foundation for all game objects with transform hierarchy
- Built-in physics properties and network synchronization
- Global entity management via `Entity.all` static array
- Network state includes interpolation, extrapolation, and client-side prediction

### Rendering System (`Renderer.ts`)
- **WebGPU-based** with comprehensive resource management and device loss recovery
- **Dual mesh algorithms**: Original quad-based and optimized greedy mesh (toggle with 'M' key)
- Voxel rendering with palette textures and instanced rendering
- Performance monitoring with GPU timing queries

### Physics System (`PhysicsSystem.ts`)
- Singleton with multi-layer collision detection and spatial partitioning
- Supports entity-entity and entity-terrain collision
- Advanced features: raycast system, radial forces, trigger volumes
- Configurable quality levels for performance scaling

### Combat System (`CombatSystem.ts`)
- Singleton managing weapon-based combat with configurable weapon stats
- Health/defense/damage calculation with knockback effects
- First-person weapon animations and attack timing

### Multiplayer System (`MultiplayerManager.ts`)
- WebRTC peer-to-peer networking with manual signaling
- Separate local/remote player controllers with real-time state sync
- Priority-based message queuing and entity state batching

### Configuration System (`Config.ts`)
- Centralized modular configs (GPU, Physics, Rendering, Audio, UI, Combat)
- Performance-based quality scaling with runtime updates

## Key Global Objects

The main game objects are available globally:
- `globalThis.models`: Array of loaded 3D models
- `globalThis.player`: Local player entity
- `globalThis.renderer`: WebGPU renderer instance
- `globalThis.physicsSystem`: Physics system singleton
- `globalThis.camera`: Main camera
- `globalThis.level`: Current level/map

## Development Patterns

### Entity Creation
```typescript
// Entities auto-register to Entity.all
const entity = new Entity(modelId);
entity.localPosition = vec3.fromValues(x, y, z);
```

### Physics Configuration
```typescript
physicsSystem.configureEntity(entity, {
    hasGravity: true,
    hasCollision: true,
    layer: PhysicsLayer.Player
});
```

### Network Messages
```typescript
net.sendMessage({
    type: MessageType.PLAYER_UPDATE,
    data: { position, rotation },
    priority: MessagePriority.HIGH
});
```

## File Organization

- `/src/` - Main TypeScript source code
- `/src/shaders/` - WebGPU shaders (.wgsl files)
- `/src/types/` - TypeScript type definitions
- `/public/models/` - 3D models (.vox files)
- `/public/maps/` - Level maps (.tmj Tiled JSON)
- `/public/tilesets/` - Tile definitions (.tsj Tiled JSON)

## Build System

- **Vite-based** with custom plugin for hot reloading on asset changes
- Auto-reloads on `.tmj`, `.tsj`, `.vox`, `.png` file changes
- WebGPU types included via `@webgpu/types`

## Performance Considerations

- The greedy mesh algorithm significantly reduces face count but takes longer to generate
- Physics system uses spatial partitioning and has configurable entity limits
- GPU resource cleanup is automatic with device loss recovery
- Network messages are batched and prioritized for optimal performance

## Testing Multiplayer

See `/CHAT_TESTING.md` for detailed multiplayer setup and testing instructions. Basic flow:
1. Host creates game and generates offer
2. Client joins with offer/answer exchange
3. WebRTC connection established for real-time sync