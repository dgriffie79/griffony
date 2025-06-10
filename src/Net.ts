import { Entity } from './Entity';
import {
  MessageType,
  MessagePriority,
  type MessageTypeValue,
  type NetworkMessage,
  type EntityUpdateMessage,
  type PlayerJoinMessage,  type PlayerLeaveMessage,
  type ChatMessage,
  type EntitySnapshot,
  type TerrainModification,
  type FullGameStateMessage
} from './types';

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
  private onChatMessageCallback?: (playerName: string, message: string, timestamp: number) => void;
  private onDataChannelReadyCallback?: (peerId: string) => void;

  constructor() {
    this.startMessageBatchingLoop();
  }

  // Event callback setters
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

  onDataChannelReady(callback: (peerId: string) => void): void {
    this.onDataChannelReadyCallback = callback;
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
    });    // Create data channel
    const dataChannel = connection.createDataChannel('gameData', {
      ordered: false,
      maxRetransmits: 0
    });

    // We'll set up the data channel later when we know the client's ID
    // this.setupDataChannel(dataChannel, this.peerId);

    // Set up ICE candidate collection
    const candidates: RTCIceCandidate[] = [];
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        candidates.push(event.candidate);
      }
    };

    // Create offer
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);

    // Wait for ICE gathering to complete
    await new Promise<void>((resolve) => {
      if (connection.iceGatheringState === 'complete') {
        resolve();
      } else {
        connection.addEventListener('icegatheringstatechange', () => {
          if (connection.iceGatheringState === 'complete') {
            resolve();
          }
        });
      }
    });    // Store the connection for later use
    this.pendingConnection = {
      id: 'pending_client', // Temporary ID, will be updated in completeConnection
      connection,
      dataChannel,
      isHost: true,
      lastSeen: Date.now(),
      latency: 0
    };

    // Return the offer SDP with ICE candidates
    const offerData = {
      type: 'offer',
      sdp: connection.localDescription?.sdp,
      candidates: candidates.map(c => ({
        candidate: c.candidate,
        sdpMLineIndex: c.sdpMLineIndex,
        sdpMid: c.sdpMid
      }))    };

    console.log(`✅ Created offer for host ${this.peerId}`);
    return JSON.stringify(offerData);
  }

  async acceptOffer(offerString: string): Promise<string> {
    // Generate a unique peer ID for this client
    this.peerId = 'client_' + Math.random().toString(36).substr(2, 9);
    this.isHost = false;

    const offerData = JSON.parse(offerString);

    // Create a peer connection for the answer
    const connection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });    // Set up data channel reception
    connection.ondatachannel = (event) => {
      const dataChannel = event.channel;
      const hostId = 'host'; // Use consistent host ID
      
      // Store the connection FIRST
      const connectionInfo: PeerConnection = {
        id: hostId,
        connection,
        dataChannel,
        isHost: false,
        lastSeen: Date.now(),
        latency: 0
      };
      
      // Add to active connections immediately
      this.connections.set(hostId, connectionInfo);
      
      // Then set up the data channel
      this.setupDataChannel(dataChannel, hostId);
    };

    // Set remote description
    await connection.setRemoteDescription({
      type: 'offer',
      sdp: offerData.sdp
    });

    // Add ICE candidates
    for (const candidateData of offerData.candidates || []) {
      await connection.addIceCandidate(new RTCIceCandidate(candidateData));
    }

    // Create answer
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);

    // Set up ICE candidate collection for answer
    const candidates: RTCIceCandidate[] = [];
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        candidates.push(event.candidate);
      }
    };

    // Wait for ICE gathering to complete
    await new Promise<void>((resolve) => {
      if (connection.iceGatheringState === 'complete') {
        resolve();
      } else {
        connection.addEventListener('icegatheringstatechange', () => {
          if (connection.iceGatheringState === 'complete') {
            resolve();
          }
        });
      }
    });

    // Return the answer SDP with ICE candidates
    const answerData = {
      type: 'answer',
      sdp: connection.localDescription?.sdp,
      candidates: candidates.map(c => ({
        candidate: c.candidate,
        sdpMLineIndex: c.sdpMLineIndex,
        sdpMid: c.sdpMid
      }))    };

    console.log(`✅ Created answer for client ${this.peerId}`);
    return JSON.stringify(answerData);
  }
  async completeConnection(answerString: string): Promise<void> {
    if (!this.pendingConnection) {
      throw new Error('No pending connection to complete');
    }

    const answerData = JSON.parse(answerString);
    const connection = this.pendingConnection.connection;

    // Set remote description
    await connection.setRemoteDescription({
      type: 'answer',
      sdp: answerData.sdp
    });

    // Add ICE candidates
    for (const candidateData of answerData.candidates || []) {
      await connection.addIceCandidate(new RTCIceCandidate(candidateData));
    }

    // Generate a unique ID for the client
    const clientId = 'client_' + Math.random().toString(36).substr(2, 9);
    
    // Update the pending connection with the correct client ID
    this.pendingConnection.id = clientId;
    
    // Now set up the data channel with the correct client ID
    if (this.pendingConnection.dataChannel) {
      this.setupDataChannel(this.pendingConnection.dataChannel, clientId);
    }    // Move from pending to active connections
    this.connections.set(clientId, this.pendingConnection);
    this.pendingConnection = undefined;

    console.log(`✅ Connection completed for client ${clientId}`);
  }

  // Legacy method names for backward compatibility
  async processAnswer(answerString: string): Promise<void> {
    return this.completeConnection(answerString);
  }

  async createAnswer(offerString: string): Promise<string> {
    return this.acceptOffer(offerString);
  }  private setupDataChannel(dataChannel: RTCDataChannel, peerId: string): void {
    console.log(`🔧 Setting up data channel for peer ${peerId}`);
    
    dataChannel.onopen = () => {
      console.log(`✅ Data channel opened for peer ${peerId}`);
      console.log(`🔍 Current connections: ${Array.from(this.connections.keys()).join(', ')}`);
      console.log(`🔍 Is host: ${this.isHost}`);
      
      this.isConnected = true;
      this.onConnectionStateChangeCallback?.(true);
      
      // Notify that data channel is ready
      console.log(`📢 Triggering onDataChannelReady callback for peer ${peerId}`);
      this.onDataChannelReadyCallback?.(peerId);
    };

    dataChannel.onclose = () => {
      console.log(`❌ Data channel closed for peer ${peerId}`);
      this.isConnected = false;
      this.onConnectionStateChangeCallback?.(false);
      this.handlePeerDisconnection(peerId);
    };    dataChannel.onerror = (error) => {
      console.error(`❌ Data channel error for peer ${peerId}:`, error);
    };

    dataChannel.onmessage = (event) => {
      try {
        const rawData = event.data;
        console.log(`📨 Raw data received from ${peerId}:`, rawData);

        const message: NetworkMessage = JSON.parse(rawData);
        console.log(`📨 Parsed message from ${peerId}:`, message);

        this.messagesReceived++;
        this.handleIncomingMessage(message, peerId);
      } catch (error) {
        console.error(`❌ Failed to parse message from ${peerId}:`, error);
      }
    };
  }
  private handleIncomingMessage(message: NetworkMessage, senderId: string): void {
    console.log(`🔄 Handling message type ${message.type} from ${senderId}`);

    // Update last seen time for the sender
    const connection = this.connections.get(senderId);
    if (connection) {
      connection.lastSeen = Date.now();
    }

    // Handle specific message types
    switch (message.type) {
      case MessageType.FULL_GAME_STATE:
        console.log(`📦 Received FULL_GAME_STATE from ${senderId}`);
        this.handleFullGameState(message as FullGameStateMessage);
        break;

      case MessageType.CHAT:
        console.log(`💬 Net.handleIncomingMessage: Received CHAT message from ${senderId}`);
        const chatMsg = message as ChatMessage;
        console.log(`💬 Net.handleIncomingMessage: Chat data:`, chatMsg.data);
        console.log(`💬 Net.handleIncomingMessage: Calling onChatMessageCallback`);
        this.onChatMessageCallback?.(
          chatMsg.data.playerName,
          chatMsg.data.message,
          chatMsg.data.timestamp
        );
        console.log(`✅ Net.handleIncomingMessage: CHAT message processed`);
        // Also pass to general message callback so MultiplayerManager can see it
        this.onMessageCallback?.(message, senderId);
        break;

      case MessageType.PING:
        // Respond with pong
        this.sendMessageToPlayer(senderId, {
          type: MessageType.PONG,
          priority: MessagePriority.LOW,
          timestamp: Date.now(),
          sequenceNumber: this.getNextSequenceNumber(),
          data: { originalTimestamp: message.timestamp }
        });
        break;

      case MessageType.PONG:
        const latency = Date.now() - message.data.originalTimestamp;
        const conn = this.connections.get(senderId);
        if (conn) {
          conn.latency = latency;
        }
        break;

      default:
        // Pass all other messages to the callback
        this.onMessageCallback?.(message, senderId);
        break;
    }
  }
  private handleFullGameState(message: FullGameStateMessage): void {
    console.log(`🔄 Processing FULL_GAME_STATE with ${message.data.entities.length} entities`);
    
    // Clear all client entities first
    this.clearClientEntities();
    
    // Load entities from the message
    this.loadEntitiesFromSnapshots(message.data.entities);
    
    console.log(`✅ FULL_GAME_STATE processed successfully`);
  }  private clearClientEntities(): void {
    console.log(`🧹 Clearing all client entities (count: ${Entity.all.length})`);
    
    // Clear all entities
    Entity.all.length = 0;
    
    console.log(`✅ All entities cleared`);
  }  private loadEntitiesFromSnapshots(snapshots: EntitySnapshot[]): void {
    console.log(`📦 Loading ${snapshots.length} entities from snapshots`);
    console.log(`📦 Entity.all before loading: ${Entity.all.length} entities`);
      for (const snapshot of snapshots) {
      try {
        const entity = Entity.fromSnapshot(snapshot);
        console.log(`✅ Loaded entity ${entity.id} of type ${entity.constructor.name}`);
      } catch (error) {
        console.error(`❌ Failed to load entity from snapshot:`, error, snapshot);
      }
    }
    
    console.log(`✅ Loaded ${Entity.all.length} entities from snapshots`);
    console.log(`📦 Entity.all after loading: ${Entity.all.length} entities`);
    
    // Log first few entity IDs for verification
    const entityIds = Entity.all.slice(0, 5).map(e => e.id);
    console.log(`📦 First few entity IDs: [${entityIds.join(', ')}]`);
  }  // Public method to send full game state to a specific player
  public sendFullGameStateToPlayer(playerId: string): void {
    if (!this.isHost) {
      console.warn(`❌ Cannot send full game state - not host`);
      return;
    }

    console.log(`📤 Sending FULL_GAME_STATE to player ${playerId}`);
    console.log(`🔍 Available connections: ${Array.from(this.connections.keys()).join(', ')}`);

    const connection = this.connections.get(playerId);
    if (!connection) {
      console.error(`❌ No connection found for player ${playerId}`);
      return;
    }

    if (!connection.dataChannel || connection.dataChannel.readyState !== 'open') {
      console.error(`❌ Data channel not ready for player ${playerId}, state: ${connection.dataChannel?.readyState || 'none'}`);
      return;
    }    // Collect all entity snapshots
    const entitySnapshots: EntitySnapshot[] = [];
    for (const entity of Entity.all) {
      try {
        const snapshot = entity.serialize();
        entitySnapshots.push(snapshot);
      } catch (error) {
        console.error(`❌ Failed to create snapshot for entity ${entity.id}:`, error);
      }
    }

    const message: FullGameStateMessage = {
      type: MessageType.FULL_GAME_STATE,
      priority: MessagePriority.CRITICAL,
      timestamp: Date.now(),
      sequenceNumber: this.getNextSequenceNumber(),
      data: {
        entities: entitySnapshots,
        gameTime: Date.now(),
        hostId: this.peerId
      }    };

    console.log(`📤 Sending ${entitySnapshots.length} entities to player ${playerId}`);
    this.sendMessageToPlayer(playerId, message);
  }
  private handlePeerDisconnection(peerId: string): void {
    console.log(`🔌 Handling disconnection for peer ${peerId}`);
    
    const connection = this.connections.get(peerId);
    if (connection) {
      connection.connection.close();
      this.connections.delete(peerId);
      this.onPlayerLeaveCallback?.(peerId);
    }
  }

  // Message sending methods
  sendMessage(message: NetworkMessage): void {
    console.log(`📡 Net.sendMessage: Broadcasting message type ${message.type} to ${this.connections.size} connections`);
    
    // Broadcast to all connected peers
    for (const [peerId, connection] of this.connections) {
      if (connection.dataChannel && connection.dataChannel.readyState === 'open') {
        console.log(`📤 Net.sendMessage: Sending to peer ${peerId}`);
        this.sendMessageToPlayer(peerId, message);
      } else {
        console.warn(`⚠️ Net.sendMessage: Skipping peer ${peerId} - dataChannel not ready (state: ${connection.dataChannel?.readyState || 'missing'})`);
      }
    }
    
    console.log(`✅ Net.sendMessage: Finished broadcasting message type ${message.type}`);
  }
  sendMessageToPlayer(playerId: string, message: NetworkMessage): void {
    const connection = this.connections.get(playerId);
    if (!connection || !connection.dataChannel || connection.dataChannel.readyState !== 'open') {
      console.warn(`❌ Cannot send message to ${playerId} - no active connection (connection exists: ${!!connection}, dataChannel exists: ${!!connection?.dataChannel}, state: ${connection?.dataChannel?.readyState})`);
      return;
    }

    try {
      const messageStr = JSON.stringify(message);
      console.log(`📤 Net.sendMessageToPlayer: Sending to ${playerId}:`, message);
      connection.dataChannel.send(messageStr);
      this.messagesSent++;
      console.log(`✅ Net.sendMessageToPlayer: Successfully sent to ${playerId}`);
    } catch (error) {
      console.error(`❌ Failed to send message to ${playerId}:`, error);
    }
  }

  // Connection management
  isConnectionActive(): boolean {
    return this.isConnected && this.connections.size > 0;
  }

  getConnectedPeerIds(): string[] {
    return Array.from(this.connections.keys());
  }
  
  // Debug method to inspect connection state
  debugConnectionState(): void {
    console.log(`🔍 Net Debug State:`);
    console.log(`  - peerId: ${this.peerId}`);
    console.log(`  - isHost: ${this.isHost}`);
    console.log(`  - isConnected: ${this.isConnected}`);
    console.log(`  - connections.size: ${this.connections.size}`);
    
    for (const [peerId, connection] of this.connections) {
      console.log(`  - Connection ${peerId}:`);
      console.log(`    - isHost: ${connection.isHost}`);
      console.log(`    - dataChannel exists: ${!!connection.dataChannel}`);
      console.log(`    - dataChannel state: ${connection.dataChannel?.readyState || 'N/A'}`);
      console.log(`    - lastSeen: ${connection.lastSeen}`);
    }
  }
  disconnect(): void {
    console.log(`🔌 Disconnecting all peers`);
    
    for (const [peerId, connection] of this.connections) {
      connection.connection.close();
    }
    
    this.connections.clear();
    this.isConnected = false;
    this.onConnectionStateChangeCallback?.(false);
  }

  // Getter methods
  getPeerId(): string {
    return this.peerId;
  }

  // Update method for main game loop
  update(): void {
    // Update connection statistics and handle timeouts
    const now = Date.now();
      for (const [peerId, connection] of this.connections) {
      // Check for stale connections (no activity for 30 seconds)
      if (now - connection.lastSeen > 30000) {
        console.warn(`Connection to ${peerId} is stale, disconnecting`);
        this.handlePeerDisconnection(peerId);
      }
    }
  }

  // Utility methods
  private getNextSequenceNumber(): number {
    return ++this.sequenceNumber;
  }

  private startMessageBatchingLoop(): void {
    const processBatches = () => {
      const now = Date.now();
      
      // Process batches that are ready
      this.messageBatches = this.messageBatches.filter(batch => {
        if (now >= batch.scheduledTime) {
          // Send batch
          for (const message of batch.messages) {
            this.sendMessage(message);
          }
          return false; // Remove from queue
        }
        return true; // Keep in queue
      });
      
      // Schedule next batch processing
      setTimeout(processBatches, this.BATCH_INTERVAL);
    };
    
    processBatches();
  }

  // Debug and statistics methods
  getStatistics() {
    return {
      peerId: this.peerId,
      isHost: this.isHost,
      isConnected: this.isConnected,
      connectionCount: this.connections.size,
      messagesSent: this.messagesSent,
      messagesReceived: this.messagesReceived,
      connections: Array.from(this.connections.entries()).map(([id, conn]) => ({
        id,
        isHost: conn.isHost,
        latency: conn.latency,
        lastSeen: conn.lastSeen
      }))
    };
  }
}
