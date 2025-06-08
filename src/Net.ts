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
  type TerrainModification
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
  private onConnectionStateChangeCallback?: (isConnected: boolean) => void;
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
    
    // Store the connection for later use
    const peerConnection: PeerConnection = {
      id: 'pending_client',
      connection,
      dataChannel,
      isHost: true,
      lastSeen: Date.now(),
      latency: 0
    };
    
    // We'll update this when we get the answer
    this.pendingConnection = peerConnection;
    
    logger.info('NET', 'Created WebRTC offer for host');
    return JSON.stringify(offer);
  }

  async createAnswer(offerString: string): Promise<string> {
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

      // Set up data channel handler
      let dataChannel: RTCDataChannel | undefined;
      connection.ondatachannel = (event) => {
        dataChannel = event.channel;
        this.setupDataChannelHandlers(dataChannel, 'host');
      };

      // Set remote description and create answer
      await connection.setRemoteDescription(offer);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      
      // Store the connection for later use
      const peerConnection: PeerConnection = {
        id: 'host',
        connection,
        dataChannel,
        isHost: false,
        lastSeen: Date.now(),
        latency: 0
      };
      
      this.pendingConnection = peerConnection;
      
      logger.info('NET', 'Created WebRTC answer for client');
      return JSON.stringify(answer);
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
      
      // Set up data channel handlers
      if (this.pendingConnection.dataChannel) {
        this.setupDataChannelHandlers(this.pendingConnection.dataChannel, 'client');
      }
      
      // Update the connection ID and add to active connections
      this.pendingConnection.id = 'client';
      this.connections.set('client', this.pendingConnection);
      this.pendingConnection = undefined;
      
      // Set up connection state monitoring
      this.pendingConnection = undefined;
      this.isConnected = true;
      
      logger.info('NET', 'WebRTC connection established as host');
      this.onConnectionStateChangeCallback?.(true);
    } catch (error) {
      logger.error('NET', 'Failed to process answer:', error);
      throw new Error('Invalid answer format');
    }
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
        // In manual signaling, this would be copied to the other peer
        logger.debug('NET', `ICE candidate for ${peerId}:`, event.candidate);
      }
    };

    this.connections.set(peerId, peerConnection);
  }

  private setupDataChannelHandlers(dataChannel: RTCDataChannel, peerId: string): void {
    dataChannel.onopen = () => {
      logger.info('NET', `Data channel opened with ${peerId}`);
      
      // Send player join message if this is a new connection
      if (!this.isHost) {
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
      this.sendGameStateToPlayer(senderId);
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

  private sendGameStateToPlayer(playerId: string): void {
    const entities: EntitySnapshot[] = Entity.all.map(entity => ({
      entityId: entity.id.toString(),
      position: [entity.localPosition[0], entity.localPosition[1], entity.localPosition[2]] as any,
      rotation: [entity.localRotation[0], entity.localRotation[1], entity.localRotation[2], entity.localRotation[3]] as any,
      velocity: entity.velocity ? [entity.velocity[0], entity.velocity[1], entity.velocity[2]] as any : undefined,
      health: (entity as any).health
    }));

    this.sendMessageToPeer(playerId, {
      type: MessageType.GAME_STATE_RESPONSE,
      priority: MessagePriority.HIGH,
      timestamp: Date.now(),
      sequenceNumber: this.getNextSequenceNumber(),
      data: {
        entities,
        terrainModifications: [], // TODO: Add terrain modifications
        gameTime: Date.now(),
        hostId: this.peerId
      }
    });
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
  }

  isHosting(): boolean {
    return this.isHost;
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
}
