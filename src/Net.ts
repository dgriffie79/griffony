import { Entity } from './Entity';
import { 
  MessageType, 
  MessagePriority,
  type MessageTypeValue,
  type NetworkMessage, 
  type EntityUpdateMessage,
  type PlayerJoinMessage,
  type PlayerLeaveMessage,
  type ChatMessage,
  type EntitySnapshot,
  type TerrainModification,
  type FullGameStateMessage
} from './types';
import { Logger } from './Logger.js';

// Create logger instance for this module
const logger = Logger.getInstance();

interface PeerConnection {
  id: string;
  connection: RTCPeerConnection;
  dataChannel?: RTCDataChannel;
  isHost: boolean;
  lastSeen: number;
  latency: number;
}

interface MessageBatch {
  messages: NetworkMessage[];
  priority: MessagePriority;
  scheduledTime: number;
}

export class Net {
  private peerId: string = '';
  private connections: Map<string, PeerConnection> = new Map();
  private pendingConnection: PeerConnection | undefined; // For manual signaling
  private isHost: boolean = false;
  private isConnected: boolean = false;
  
  // Message handling
  private sequenceNumber: number = 0;
  private messageBatches: MessageBatch[] = [];
  private lastBatchTime: number = 0;
  private readonly BATCH_INTERVAL = 16; // ~60 FPS batching
  
  // Performance tracking
  private messagesSent: number = 0;
  private messagesReceived: number = 0;
  private lastPingTime: number = 0;
    // Event callbacks
  private onPlayerJoinCallback?: (playerId: string, playerName: string) => void;
  private onPlayerLeaveCallback?: (playerId: string) => void;
  private onMessageCallback?: (message: NetworkMessage, senderId: string) => void;
  private onConnectionStateChangeCallback?: (isConnected: boolean) => void;  private onChatMessageCallback?: (playerName: string, message: string, timestamp: number) => void;
  
  constructor() {
    this.startMessageBatchingLoop();
  }
  // Manual Signaling Methods for WebRTC
  async createOffer(): Promise<string> {
    // Generate a unique peer ID for this host
    this.peerId = 'host_' + Math.random().toString(36).substr(2, 9);
    this.isHost = true;
    
    // Create a peer connection for the offer
    const connection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    // Create data channel
    const dataChannel = connection.createDataChannel('gameData', {
      ordered: false,
      maxRetransmits: 0
    });

    // Create and return the offer
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    
    // Wait for ICE gathering to complete
    await this.waitForIceGathering(connection);
    
    // Store the connection for later use
    const peerConnection: PeerConnection = {
      id: 'pending_client',
      connection,
      dataChannel,
      isHost: true,
      lastSeen: Date.now(),
      latency: 0
    };
    
    // We'll set up connection state handlers in processAnswer() when we have the final peerId
    this.pendingConnection = peerConnection;
    
    logger.info('NET', 'Created WebRTC offer for host with ICE candidates, waiting for answer...');
    return JSON.stringify(connection.localDescription);
  }  async createAnswer(offerString: string): Promise<string> {
    // Generate a unique peer ID for this client
    this.peerId = 'client_' + Math.random().toString(36).substr(2, 9);
    this.isHost = false;
    
    try {
      const offer = JSON.parse(offerString);
      
      // Create a peer connection for the answer
      const connection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      // Store the connection for later use (without data channel initially)
      const peerConnection: PeerConnection = {
        id: 'host',
        connection,
        dataChannel: undefined, // Will be set when ondatachannel fires
        isHost: false,
        lastSeen: Date.now(),
        latency: 0
      };
      
      this.connections.set('host', peerConnection);      // Data channel handler will be set up in setupConnectionStateHandlers()
      // No need to set it here as it creates conflicts

      // Set remote description and create answer
      await connection.setRemoteDescription(offer);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      
      // Wait for ICE gathering to complete
      await this.waitForIceGathering(connection);
      
      // Set up connection state handlers AFTER storing the connection
      this.setupConnectionStateHandlers(connection, 'host');
      logger.info('NET', 'Created WebRTC answer for client with ICE candidates, waiting for connection...');
      return JSON.stringify(connection.localDescription);
    } catch (error) {
      logger.error('NET', 'Failed to create answer:', error);
      throw new Error('Invalid offer format');
    }
  }
  async processAnswer(answerString: string): Promise<void> {
    if (!this.pendingConnection || !this.isHost) {
      throw new Error('No pending connection or not a host');
    }
    
    try {
      const answer = JSON.parse(answerString);
      
      // Set the remote description
      await this.pendingConnection.connection.setRemoteDescription(answer);
      
      // Update the connection ID and add to active connections
      this.pendingConnection.id = 'client';
      this.connections.set('client', this.pendingConnection);
      
      // Now set up connection state handlers with the correct peerId
      this.setupConnectionStateHandlers(this.pendingConnection.connection, 'client');
      
      // Clear pending connection
      this.pendingConnection = undefined;
      
      logger.info('NET', 'WebRTC answer processed, waiting for connection establishment...');
    } catch (error) {
      logger.error('NET', 'Failed to process answer:', error);
      throw new Error('Invalid answer format');
    }
  }

  // Helper method to wait for ICE gathering to complete
  private async waitForIceGathering(connection: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
      if (connection.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      
      const handleStateChange = () => {
        if (connection.iceGatheringState === 'complete') {
          connection.onicegatheringstatechange = null;
          resolve();
        }
      };
      
      connection.onicegatheringstatechange = handleStateChange;
      
      // Fallback timeout after 10 seconds
      setTimeout(() => {
        connection.onicegatheringstatechange = null;
        logger.warn('NET', 'ICE gathering timeout, proceeding anyway');
        resolve();
      }, 10000);
    });
  }

  // Connection Management
  async createHost(hostId: string): Promise<void> {
    this.peerId = hostId;
    this.isHost = true;
    this.isConnected = true;
    
    logger.info('NET', `Host created with ID: ${hostId}`);
    
    this.onConnectionStateChangeCallback?.(true);
  }

  async connectToHost(clientId: string, hostId: string): Promise<void> {
    this.peerId = clientId;
    this.isHost = false;
    
    logger.info('NET', `Attempting to connect to host: ${hostId}`);
    
    // In a real implementation, this would establish WebRTC connection
    // For now, we'll simulate the connection process
    await this.establishConnection(hostId, false);
  }

  private async establishConnection(peerId: string, isHost: boolean): Promise<void> {
    const connection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    const peerConnection: PeerConnection = {
      id: peerId,
      connection,
      isHost,
      lastSeen: Date.now(),
      latency: 0
    };

    // Set up data channel
    if (isHost) {
      const dataChannel = connection.createDataChannel('gameData', {
        ordered: false,
        maxRetransmits: 0
      });
      peerConnection.dataChannel = dataChannel;
      this.setupDataChannelHandlers(dataChannel, peerId);
    } else {
      connection.ondatachannel = (event) => {
        peerConnection.dataChannel = event.channel;
        this.setupDataChannelHandlers(event.channel, peerId);
      };
    }

    // Handle connection state changes
    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      logger.info('NET', `Connection state changed for ${peerId}: ${state}`);
      
      if (state === 'connected') {
        this.isConnected = true;
        this.onConnectionStateChangeCallback?.(true);
      } else if (state === 'disconnected' || state === 'failed') {
        this.handlePeerDisconnection(peerId);
      }
    };

    // Handle ICE candidates
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        // In manual signaling, this would be copied to the other peer        logger.debug('NET', `ICE candidate for ${peerId}:`, event.candidate);
      }
    };    
    this.connections.set(peerId, peerConnection);
  }
    private setupConnectionStateHandlers(connection: RTCPeerConnection, peerId: string): void {    // Handle connection state changes
    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      logger.info('NET', `Connection state changed for ${peerId}: ${state}`);
        if (state === 'connected') {
        this.isConnected = true;
        logger.info('NET', `WebRTC connection established with ${peerId}`);
        
        // Now that connection is established, set up data channel handlers
        const peerConnection = this.connections.get(peerId);
        if (peerConnection?.dataChannel) {
          logger.info('NET', `Setting up data channel handlers for connected peer ${peerId}`);
          this.setupDataChannelHandlers(peerConnection.dataChannel, peerId);
        } else if (this.isHost) {
          // For host, data channel should already be created in createOffer()
          logger.warn('NET', `Host missing data channel for connected peer ${peerId}`);
        } else {
          // For client, data channel might not have arrived yet - handler will set it up when it arrives
          logger.info('NET', `Client waiting for data channel from host ${peerId}`);
        }
        
        this.onConnectionStateChangeCallback?.(true);
      } else if (state === 'failed') {
        logger.error('NET', `WebRTC connection failed for ${peerId}`);
        this.handlePeerDisconnection(peerId);
      } else if (state === 'disconnected') {
        logger.warn('NET', `WebRTC connection disconnected for ${peerId}`);
        this.handlePeerDisconnection(peerId);
      }
    };

    // Handle ICE connection state changes (additional monitoring)
    connection.oniceconnectionstatechange = () => {
      const iceState = connection.iceConnectionState;
      logger.info('NET', `ICE connection state for ${peerId}: ${iceState}`);
      
      if (iceState === 'failed') {
        logger.error('NET', `ICE connection failed for ${peerId}`);
      } else if (iceState === 'disconnected') {
        logger.warn('NET', `ICE connection disconnected for ${peerId}`);
      } else if (iceState === 'connected') {
        logger.info('NET', `ICE connection established for ${peerId}`);
      }
    };

    // Handle ICE candidate gathering
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        logger.debug('NET', `ICE candidate for ${peerId}:`, {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex
        });
      } else {
        logger.debug('NET', `ICE gathering complete for ${peerId}`);
      }
    };    // For clients, set up the data channel handler when it arrives
    if (!this.isHost) {
      connection.ondatachannel = (event) => {
        logger.info('NET', `Data channel received from host for ${peerId}`);
        const peerConnection = this.connections.get(peerId);
        if (peerConnection) {
          peerConnection.dataChannel = event.channel;
          // Set up handlers immediately if connection is already established
          if (connection.connectionState === 'connected') {
            logger.info('NET', `Setting up data channel handlers immediately for ${peerId}`);
            this.setupDataChannelHandlers(peerConnection.dataChannel, peerId);
          }
        } else {
          logger.error('NET', `No peer connection found for ${peerId} when setting up data channel`);
        }
      };
    }
    
    // Set a connection timeout
    setTimeout(() => {
      if (connection.connectionState !== 'connected') {
        logger.warn('NET', `Connection timeout for ${peerId}, current state: ${connection.connectionState}`);
        // Don't automatically fail - let user try again
      }
    }, 30000); // 30 second timeout
  }
  private setupDataChannelHandlers(dataChannel: RTCDataChannel, peerId: string): void {
    logger.info('NET', `Setting up data channel handlers for ${peerId}, current state: ${dataChannel.readyState}`);
    
    dataChannel.onopen = () => {
      logger.info('NET', `Data channel opened with ${peerId}`);
      
      // Send player join message if this is a client connecting to host
      if (!this.isHost) {
        // Add a small delay to ensure the connection is fully stable
        setTimeout(() => {
          this.sendMessage({
            type: MessageType.PLAYER_JOIN,
            priority: MessagePriority.HIGH,
            timestamp: Date.now(),
            sequenceNumber: this.getNextSequenceNumber(),
            data: {
              playerId: this.peerId,
              playerName: `Player_${this.peerId}`,
              position: [0, 0, 0] as any,
              rotation: [0, 0, 0, 1] as any
            }
          } as PlayerJoinMessage);
        }, 100);
      }
    };

    dataChannel.onmessage = (event) => {
      try {
        const message: NetworkMessage = JSON.parse(event.data);
        this.handleMessage(message, peerId);
      } catch (error) {
        logger.error('NET', `Failed to parse message from ${peerId}:`, error);
      }
    };

    dataChannel.onerror = (error) => {
      logger.error('NET', `Data channel error with ${peerId}:`, error);
    };

    dataChannel.onclose = () => {
      logger.info('NET', `Data channel closed with ${peerId}`);
      this.handlePeerDisconnection(peerId);
    };
    
    // If the data channel is already open, trigger the open handler
    if (dataChannel.readyState === 'open') {
      logger.info('NET', `Data channel already open for ${peerId}, triggering open handler`);
      dataChannel.onopen?.(new Event('open'));
    }
  }
  private handleMessage(message: NetworkMessage, senderId: string): void {
    this.messagesReceived++;
    
    // Update last seen time for the sender
    const peerConnection = this.connections.get(senderId);
    if (peerConnection) {
      peerConnection.lastSeen = Date.now();
    }

    // Handle specific message types
    switch (message.type) {
      case MessageType.PLAYER_JOIN:
        this.handlePlayerJoin(message as PlayerJoinMessage, senderId);
        break;
      case MessageType.PLAYER_LEAVE:
        this.handlePlayerLeave(message as PlayerLeaveMessage);
        break;
      case MessageType.ENTITY_UPDATE:
        this.handleEntityUpdate(message as EntityUpdateMessage);
        break;
      case MessageType.ENTITY_STATE_BATCH:
        this.handleEntityStateBatch(message);
        break;
      case MessageType.FULL_GAME_STATE:
        this.handleFullGameState(message as FullGameStateMessage);
        break;
      case MessageType.CHAT:
        this.handleChatMessage(message as ChatMessage);
        break;
      case MessageType.PING:
        this.handlePing(message, senderId);
        break;
      case MessageType.PONG:
        this.handlePong(message, senderId);
        break;
      default:
        // Forward to general message callback
        this.onMessageCallback?.(message, senderId);
        break;
    }

    // Relay message to other peers if we're the host
    if (this.isHost && message.type !== MessageType.PING && message.type !== MessageType.PONG) {
      this.relayMessage(message, senderId);
    }
  }
  private handlePlayerJoin(message: PlayerJoinMessage, senderId: string): void {
    logger.info('NET', `Player joined: ${message.data.playerId}`);
    this.onPlayerJoinCallback?.(message.data.playerId, message.data.playerName);
    
    // If we're the host, send current game state to the new player
    if (this.isHost) {
      this.sendFullGameStateToPlayer(senderId);
    }
  }

  private handlePlayerLeave(message: PlayerLeaveMessage): void {
    logger.info('NET', `Player left: ${message.data.playerId}`);
    this.onPlayerLeaveCallback?.(message.data.playerId);
    this.connections.delete(message.data.playerId);
  }

  private handleEntityUpdate(message: EntityUpdateMessage): void {
    if (!this.isHost) {
      // Apply entity update
      for (const entity of Entity.all) {
        if (entity.id.toString() === message.data.entityId) {
          entity.localPosition[0] = message.data.position[0];
          entity.localPosition[1] = message.data.position[1];
          entity.localPosition[2] = message.data.position[2];
          entity.localRotation[0] = message.data.rotation[0];
          entity.localRotation[1] = message.data.rotation[1];
          entity.localRotation[2] = message.data.rotation[2];
          entity.localRotation[3] = message.data.rotation[3];
          break;
        }
      }
    }
  }
  private handleChatMessage(message: ChatMessage): void {
    logger.info('NET', `Chat from ${message.data.playerName}: ${message.data.message}`);
    this.onChatMessageCallback?.(message.data.playerName, message.data.message, message.data.timestamp);
  }

  private handlePing(message: NetworkMessage, senderId: string): void {
    // Respond with pong
    this.sendMessageToPeer(senderId, {
      type: MessageType.PONG,
      priority: MessagePriority.LOW,
      timestamp: Date.now(),
      sequenceNumber: this.getNextSequenceNumber(),
      data: {
        originalTimestamp: message.data.timestamp,
        responseTimestamp: Date.now(),
        senderId: this.peerId
      }
    });
  }

  private handlePong(message: NetworkMessage, senderId: string): void {
    const latency = Date.now() - message.data.originalTimestamp;
    const peerConnection = this.connections.get(senderId);
    if (peerConnection) {
      peerConnection.latency = latency;
    }
    logger.debug('NET', `Latency to ${senderId}: ${latency}ms`);
  }

  private handlePeerDisconnection(peerId: string): void {
    logger.info('NET', `Peer disconnected: ${peerId}`);
    this.connections.delete(peerId);
    
    // Send player leave message
    this.sendMessage({
      type: MessageType.PLAYER_LEAVE,
      priority: MessagePriority.HIGH,
      timestamp: Date.now(),
      sequenceNumber: this.getNextSequenceNumber(),
      data: {
        playerId: peerId,
        reason: 'disconnected'
      }
    } as PlayerLeaveMessage);

    // Check if we lost connection entirely
    if (this.connections.size === 0) {
      this.isConnected = false;
      this.onConnectionStateChangeCallback?.(false);
    }
  }

  // Message Sending
  sendMessage(message: NetworkMessage): void {
    message.timestamp = Date.now();
    message.sequenceNumber = this.getNextSequenceNumber();
    
    // Add to appropriate batch based on priority
    this.addMessageToBatch(message);
  }

  sendMessageToPlayer(playerId: string, message: NetworkMessage): void {
    message.timestamp = Date.now();
    message.sequenceNumber = this.getNextSequenceNumber();
    this.sendMessageToPeer(playerId, message);
  }

  private sendMessageToPeer(peerId: string, message: NetworkMessage): void {
    const peerConnection = this.connections.get(peerId);
    if (peerConnection?.dataChannel?.readyState === 'open') {
      try {
        peerConnection.dataChannel.send(JSON.stringify(message));
        this.messagesSent++;
      } catch (error) {
        logger.error('NET', `Failed to send message to ${peerId}:`, error);
      }
    }
  }

  private relayMessage(message: NetworkMessage, excludePeerId: string): void {
    for (const [peerId, peerConnection] of this.connections) {
      if (peerId !== excludePeerId && peerConnection.dataChannel?.readyState === 'open') {
        this.sendMessageToPeer(peerId, message);
      }
    }
  }
  private sendFullGameStateToPlayer(playerId: string): void {
    try {
      // Collect all current entities as snapshots
      const entitySnapshots = Entity.getAllEntitiesAsSnapshots();
      
      // Get player position/rotation if available
      let playerPosition: [number, number, number] | undefined;
      let playerRotation: [number, number, number, number] | undefined;
      
      // Try to get player state from global game state
      if ((globalThis as any).gameState) {
        const gameState = (globalThis as any).gameState;
        playerPosition = gameState.playerPos;
        playerRotation = gameState.playerOrientation;
      }
      
      const fullStateMessage = {
        type: MessageType.FULL_GAME_STATE,
        priority: MessagePriority.CRITICAL,
        timestamp: Date.now(),
        sequenceNumber: this.getNextSequenceNumber(),
        data: {
          entities: entitySnapshots,
          playerPosition,
          playerRotation,
          gameTime: Date.now(),
          hostId: this.peerId
        }
      };
      
      // Send to specific player
      this.sendMessageToPeer(playerId, fullStateMessage);
      
      logger.info('NET', `Sent full game state to ${playerId} (${entitySnapshots.length} entities)`);
    } catch (error) {
      logger.error('NET', `Failed to send full game state: ${error}`);
    }
  }

  // Message Batching System
  private addMessageToBatch(message: NetworkMessage): void {
    // Find existing batch for this priority or create new one
    let batch = this.messageBatches.find(b => b.priority === message.priority);
    
    if (!batch) {
      batch = {
        messages: [],
        priority: message.priority,
        scheduledTime: Date.now() + this.getBatchDelay(message.priority)
      };
      this.messageBatches.push(batch);
    }

    batch.messages.push(message);

    // Send immediately for critical messages
    if (message.priority === MessagePriority.CRITICAL) {
      this.flushBatch(batch);
    }
  }

  private getBatchDelay(priority: MessagePriority): number {
    switch (priority) {
      case MessagePriority.CRITICAL: return 0;
      case MessagePriority.HIGH: return 8;
      case MessagePriority.MEDIUM: return 16;
      case MessagePriority.LOW: return 100;
      default: return 16;
    }
  }

  private startMessageBatchingLoop(): void {
    const processMessages = () => {
      const now = Date.now();
      
      // Process batches that are ready to send
      this.messageBatches = this.messageBatches.filter(batch => {
        if (now >= batch.scheduledTime) {
          this.flushBatch(batch);
          return false; // Remove from array
        }
        return true; // Keep in array
      });

      // Send ping to maintain connection health
      if (now - this.lastPingTime > 5000) { // Every 5 seconds
        this.sendPingToAllPeers();
        this.lastPingTime = now;
      }

      requestAnimationFrame(processMessages);
    };
    
    requestAnimationFrame(processMessages);
  }

  private flushBatch(batch: MessageBatch): void {
    if (batch.messages.length === 0) return;

    // Group messages by type for efficiency
    const messageGroups = new Map<MessageTypeValue, NetworkMessage[]>();
    
    for (const message of batch.messages) {
      if (!messageGroups.has(message.type)) {
        messageGroups.set(message.type, []);
      }
      messageGroups.get(message.type)!.push(message);
    }

    // Send each group
    for (const [type, messages] of messageGroups) {
      if (messages.length === 1) {
        // Send individual message
        this.broadcastMessage(messages[0]);
      } else if (type === MessageType.ENTITY_UPDATE) {
        // Batch entity updates
        this.sendEntityBatch(messages as EntityUpdateMessage[]);
      } else {
        // Send messages individually for other types
        for (const message of messages) {
          this.broadcastMessage(message);
        }
      }
    }

    batch.messages.length = 0;
  }

  private broadcastMessage(message: NetworkMessage): void {
    for (const [peerId, peerConnection] of this.connections) {
      if (peerConnection.dataChannel?.readyState === 'open') {
        this.sendMessageToPeer(peerId, message);
      }
    }
  }

  private sendEntityBatch(messages: EntityUpdateMessage[]): void {
    const entities: EntitySnapshot[] = messages.map(msg => ({
      entityId: msg.data.entityId,
      position: msg.data.position,
      rotation: msg.data.rotation,
      velocity: msg.data.velocity,
      health: msg.data.health
    }));

    this.broadcastMessage({
      type: MessageType.ENTITY_STATE_BATCH,
      priority: MessagePriority.MEDIUM,
      timestamp: Date.now(),
      sequenceNumber: this.getNextSequenceNumber(),
      data: {
        entities,
        timestamp: Date.now()
      }
    });
  }

  private sendPingToAllPeers(): void {
    const pingMessage: NetworkMessage = {
      type: MessageType.PING,
      priority: MessagePriority.LOW,
      timestamp: Date.now(),
      sequenceNumber: this.getNextSequenceNumber(),
      data: {
        timestamp: Date.now(),
        senderId: this.peerId
      }
    };

    this.broadcastMessage(pingMessage);
  }

  // Main update loop for entity synchronization
  update(): void {
    if (!this.isHost || !this.isConnected) {
      return;
    }

    // Send entity updates for entities that have moved
    for (const entity of Entity.all) {
      if (entity.id > 0) { // Skip player entity (id 0)
        this.sendMessage({
          type: MessageType.ENTITY_UPDATE,
          priority: MessagePriority.MEDIUM,
          timestamp: Date.now(),
          sequenceNumber: this.getNextSequenceNumber(),
          data: {
            entityId: entity.id.toString(),
            position: [entity.localPosition[0], entity.localPosition[1], entity.localPosition[2]] as any,
            rotation: [entity.localRotation[0], entity.localRotation[1], entity.localRotation[2], entity.localRotation[3]] as any,
            velocity: entity.velocity ? [entity.velocity[0], entity.velocity[1], entity.velocity[2]] as any : undefined,
            timestamp: Date.now()
          }
        } as EntityUpdateMessage);
      }
    }
  }

  // Utility methods
  private getNextSequenceNumber(): number {
    return ++this.sequenceNumber;
  }  isHosting(): boolean {
    return this.isHost;
  }

  getPeerId(): string {
    return this.peerId;
  }

  isConnectionActive(): boolean {
    return this.isConnected;
  }

  getConnectedPeers(): string[] {
    return Array.from(this.connections.keys());
  }
  getPeerLatency(peerId: string): number {
    return this.connections.get(peerId)?.latency ?? -1;
  }

  getNetworkStats() {
    return {
      messagesSent: this.messagesSent,
      messagesReceived: this.messagesReceived,
      connectedPeers: this.connections.size,
      averageLatency: Array.from(this.connections.values())
        .reduce((sum, peer) => sum + peer.latency, 0) / this.connections.size || 0
    };
  }

  // Event callbacks
  onPlayerJoin(callback: (playerId: string, playerName: string) => void): void {
    this.onPlayerJoinCallback = callback;
  }

  onPlayerLeave(callback: (playerId: string) => void): void {
    this.onPlayerLeaveCallback = callback;
  }

  onMessage(callback: (message: NetworkMessage, senderId: string) => void): void {
    this.onMessageCallback = callback;
  }
  onConnectionStateChange(callback: (isConnected: boolean) => void): void {
    this.onConnectionStateChangeCallback = callback;
  }

  onChatMessage(callback: (playerName: string, message: string, timestamp: number) => void): void {
    this.onChatMessageCallback = callback;
  }

  // Cleanup
  disconnect(): void {
    for (const [peerId, peerConnection] of this.connections) {
      peerConnection.dataChannel?.close();
      peerConnection.connection.close();
    }
    this.connections.clear();
    this.isConnected = false;
    this.onConnectionStateChangeCallback?.(false);
  }

  private handleEntityStateBatch(message: any): void {
    if (this.isHost) {
      // Hosts shouldn't receive entity state batches
      return;
    }
    
    // Apply entity updates from batch
    for (const entityData of message.data.entities) {
      const entity = Entity.all.find(e => e.id.toString() === entityData.entityId);
      if (entity) {
        // Apply network update with interpolation
        entity.applyNetworkUpdate({
          position: entityData.position,
          rotation: entityData.rotation,
          velocity: entityData.velocity,
          timestamp: entityData.timestamp,
          sequenceNumber: 0
        });
      }
    }
  }

  private handleFullGameState(message: FullGameStateMessage): void {
    if (this.isHost) {
      // Hosts shouldn't receive full game state
      logger.warn('NET', 'Host received full game state message - ignoring');
      return;
    }
    
    try {
      logger.info('NET', `Received full game state with ${message.data.entities.length} entities`);
      
      // Clear all current entities except the player
      this.clearClientEntities();
      
      // Load entities from server snapshots
      const loadedEntities = Entity.loadEntitiesFromSnapshots(message.data.entities);
      
      // Mark all loaded entities as network entities
      for (const entity of loadedEntities) {
        entity.isNetworkEntity = true;
        entity.ownerId = message.data.hostId;
      }
      
      logger.info('NET', `Loaded ${loadedEntities.length} entities from server`);
      
      // Update player position if provided
      if (message.data.playerPosition && (globalThis as any).gameState) {
        const gameState = (globalThis as any).gameState;
        gameState.playerPos = message.data.playerPosition;
        if (message.data.playerRotation) {
          gameState.playerOrientation = message.data.playerRotation;
        }
      }
      
    } catch (error) {
      logger.error('NET', `Failed to process full game state: ${error}`);
    }
  }

  private clearClientEntities(): void {
    // Save the player entity and any local entities
    const localEntities = Entity.all.filter(entity => 
      !entity.isNetworkEntity || entity.ownerId === this.peerId
    );
    
    // Clear all entities
    Entity.clearAllEntities();
    
    // Restore local entities
    for (const entity of localEntities) {
      Entity.all.push(entity);
    }
    
    // Reset the ID counter
    Entity.nextId = Math.max(Entity.nextId, ...Entity.all.map(e => e.id), 0) + 1;
  }
}
