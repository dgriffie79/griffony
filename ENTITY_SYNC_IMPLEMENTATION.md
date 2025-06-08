# Entity Synchronization Implementation

## What We've Implemented

### 1. Entity Serialization
- Added `serialize()` method to Entity class for network transfer
- Added `fromSnapshot()` static method to recreate entities from network data
- Added static methods for managing entity collections (`clearAllEntities`, `loadEntitiesFromSnapshots`, `getAllEntitiesAsSnapshots`)

### 2. Full Game State Synchronization
- New message type: `FULL_GAME_STATE` (MessageType 33)
- When a client joins, the host sends complete entity state
- Client clears local entities and loads server entities
- All loaded entities are marked as `isNetworkEntity = true`

### 3. Periodic Entity Updates
- Host sends `ENTITY_STATE_BATCH` messages at 20 FPS
- Clients receive and apply entity updates with interpolation
- Only entities marked as network entities or dirty entities are synchronized

### 4. Network Entity Management
- Entities created on host are automatically marked as network entities
- Network entities have `ownerId` set to the host's peer ID
- Client entities are cleared when receiving full game state (except local player)

## How to Test

### 1. Open two browser windows/tabs
- Window 1: Host
- Window 2: Client

### 2. In Host window:
1. Load the game
2. Open browser console
3. Create a host: Use the manual signaling UI or call `net.createOffer()`
4. Wait for entities to load from the level
5. Test with: `testEntitySync()` - should show entities marked as network entities

### 3. In Client window:
1. Load the game
2. Open browser console
3. Connect to host using the offer/answer signaling
4. Upon connection, client should receive full game state
5. Test with: `testEntitySync()` - should show received entities

### 4. Debug Functions Available:
- `testEntitySync()` - Shows current entity state and network status
- `sendFullGameState()` - (Host only) Manually sends full game state to all clients

### 5. What to Look For:
- Host console: "Sent full game state to [clientId] (X entities)"
- Client console: "Received full game state with X entities"
- Client console: "Loaded X entities from server"
- Entity positions should be synchronized between host and client
- Moving entities on host should update on client with interpolation

## Key Features

### Automatic Synchronization
- New clients automatically get full game state when joining
- Periodic updates keep entities in sync
- Smooth interpolation for entity movement

### Network Optimization
- Message batching system for efficient network usage
- Only dirty or network entities are synchronized
- Critical messages (full game state) sent immediately
- Regular updates sent at 20 FPS

### Entity Management
- Clear separation between local and network entities
- Proper cleanup when clients join/leave
- Entity ownership tracking

## Troubleshooting

### If entities aren't syncing:
1. Check if connection is active: `net.isConnectionActive()`
2. Check if entities are marked as network entities: Look for `isNetworkEntity: true`
3. Check console for any error messages
4. Verify entity serialization: `Entity.getAllEntitiesAsSnapshots()`

### If client doesn't receive full game state:
1. Ensure host has entities loaded before client connects
2. Check network connection status
3. Look for "Failed to send full game state" errors

## Next Steps

This implementation provides the foundation for entity synchronization. Additional features can be added:

1. **Player Entity Synchronization**: Synchronize player positions and actions
2. **Terrain Synchronization**: Sync terrain modifications
3. **Combat Synchronization**: Sync attacks, damage, and health
4. **Performance Optimization**: Add delta compression for entity updates
5. **Prediction**: Add client-side prediction for smoother gameplay
