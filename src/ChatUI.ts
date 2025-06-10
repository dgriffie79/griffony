import { Net } from './Net';
import { MessageType, MessagePriority, type ChatMessage } from './types';

export interface ChatUIOptions {
  maxMessages?: number;
  hideAfterMs?: number;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export class ChatUI {
  private container: HTMLElement | null = null;
  private messagesContainer: HTMLElement | null = null;
  private inputContainer: HTMLElement | null = null;
  private chatInput: HTMLInputElement | null = null;
  private sendButton: HTMLButtonElement | null = null;
  private net: Net;
  private isOpen: boolean = false;
  private options: Required<ChatUIOptions>;
  private hideTimeout: number | null = null;
  private messages: Array<{ sender: string; message: string; timestamp: number }> = [];

  constructor(net: Net, options: ChatUIOptions = {}) {
    this.net = net;
    this.options = {
      maxMessages: options.maxMessages || 50,
      hideAfterMs: options.hideAfterMs || 10000, // Hide after 10 seconds
      position: options.position || 'bottom-left'
    };
    
    this.createUI();
    this.setupEventListeners();
  }

  private createUI(): void {
    // Create main container
    this.container = document.createElement('div');
    this.container.id = 'chat-ui';
    this.container.style.cssText = `
      position: fixed;
      ${this.getPositionStyles()}
      width: 400px;
      max-height: 300px;
      background: rgba(0, 0, 0, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 5px;
      font-family: monospace;
      font-size: 12px;
      color: white;
      z-index: 1000;
      display: none;
      overflow: hidden;
    `;

    // Create messages container
    this.messagesContainer = document.createElement('div');
    this.messagesContainer.id = 'chat-messages';
    this.messagesContainer.style.cssText = `
      max-height: 240px;
      overflow-y: auto;
      padding: 8px;
      word-wrap: break-word;
    `;

    // Create input container
    this.inputContainer = document.createElement('div');
    this.inputContainer.id = 'chat-input-container';
    this.inputContainer.style.cssText = `
      display: flex;
      padding: 4px;
      border-top: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(0, 0, 0, 0.5);
    `;

    // Create input field
    this.chatInput = document.createElement('input');
    this.chatInput.type = 'text';
    this.chatInput.placeholder = 'Type a message...';
    this.chatInput.maxLength = 200;
    this.chatInput.style.cssText = `
      flex: 1;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 3px;
      color: white;
      padding: 4px;
      font-family: monospace;
      font-size: 12px;
    `;

    // Create send button
    this.sendButton = document.createElement('button');
    this.sendButton.textContent = 'Send';
    this.sendButton.style.cssText = `
      margin-left: 4px;
      background: rgba(0, 100, 200, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 3px;
      color: white;
      padding: 4px 8px;
      font-family: monospace;
      font-size: 12px;
      cursor: pointer;
    `;

    // Assemble UI
    this.inputContainer.appendChild(this.chatInput);
    this.inputContainer.appendChild(this.sendButton);
    this.container.appendChild(this.messagesContainer);
    this.container.appendChild(this.inputContainer);
    document.body.appendChild(this.container);
  }

  private getPositionStyles(): string {
    switch (this.options.position) {
      case 'top-left':
        return 'top: 20px; left: 20px;';
      case 'top-right':
        return 'top: 20px; right: 20px;';
      case 'bottom-right':
        return 'bottom: 20px; right: 20px;';
      case 'bottom-left':
      default:
        return 'bottom: 20px; left: 20px;';
    }
  }

  private setupEventListeners(): void {
    // Send message on button click
    this.sendButton?.addEventListener('click', () => {
      this.sendMessage();
    });

    // Send message on Enter key
    this.chatInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.sendMessage();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });    // Prevent game input when chat is focused
    this.chatInput?.addEventListener('focus', () => {
      // Only disable pointer events on game canvas/3D area, not entire document
      const canvas = document.querySelector('canvas');
      if (canvas) {
        canvas.style.pointerEvents = 'none';
      }
    });

    this.chatInput?.addEventListener('blur', () => {
      // Re-enable pointer events on game canvas
      const canvas = document.querySelector('canvas');
      if (canvas) {
        canvas.style.pointerEvents = 'auto';
      }
    });
  }

  private sendMessage(): void {
    if (!this.chatInput || !this.chatInput.value.trim()) {
      return;
    }

    const message = this.chatInput.value.trim();
    this.chatInput.value = '';

    // Get the proper player ID and generate a human-readable display name
    const mpManager = (globalThis as any).multiplayerManager;
    let playerId = this.net.getPeerId(); // fallback
    let playerName = 'Player';

    if (mpManager) {
      // Use the consistent player ID from MultiplayerManager
      playerId = mpManager.playerId || playerId;
      
      // Generate human-readable display name for chat
      if (mpManager.isHost) {
        playerName = 'Host';
      } else {
        // For clients, just use "Player" (could be enhanced to "Player 1", "Player 2", etc.)
        playerName = 'Player';
      }
    }

    // Send chat message through network
    const chatMessage: ChatMessage = {
      type: MessageType.CHAT,
      priority: MessagePriority.LOW,
      timestamp: Date.now(),
      sequenceNumber: Date.now(), // Simple sequence for now
      data: {
        playerId: playerId,
        playerName: playerName,
        message: message,
        timestamp: Date.now()
      }
    };

    // Add to local chat immediately    this.addMessage(chatMessage.data.playerName, message, Date.now());
    
    // Send to network
    this.net.sendMessage(chatMessage);
    
    // Close chat after sending
    this.close();
  }

  public addMessage(sender: string, message: string, timestamp: number): void {
    // Add to messages array
    this.messages.push({ sender, message, timestamp });
    
    // Remove old messages if we exceed max
    if (this.messages.length > this.options.maxMessages) {
      this.messages.shift();
    }

    // Create message element
    const messageElement = document.createElement('div');
    messageElement.style.cssText = `
      margin-bottom: 4px;
      padding: 2px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.05);
    `;

    const timeStr = new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    messageElement.innerHTML = `
      <span style="color: #888;">[${timeStr}]</span>
      <span style="color: #4CAF50; font-weight: bold;">${this.escapeHtml(sender)}:</span>
      <span style="color: #FFF;">${this.escapeHtml(message)}</span>
    `;

    this.messagesContainer?.appendChild(messageElement);

    // Scroll to bottom
    if (this.messagesContainer) {
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    // Show chat temporarily
    this.showTemporary();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  public open(): void {
    if (!this.container || !this.chatInput) return;    // Don't open chat if signaling UI is active
    const signalingUI = document.getElementById('manualSignalingUI');
    if (signalingUI) {
      return;
    }

    this.isOpen = true;
    this.container.style.display = 'block';
    this.inputContainer!.style.display = 'flex';
    
    // Clear any hide timeout
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }    // Focus input
    setTimeout(() => {
      this.chatInput!.focus();
    }, 50);
  }

  public close(): void {
    if (!this.container || !this.chatInput) return;

    this.isOpen = false;
    this.inputContainer!.style.display = 'none';
    
    // Blur input
    this.chatInput.blur();
      // Hide after delay if no messages
    this.scheduleHide();
  }

  public toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  private showTemporary(): void {
    if (!this.container) return;

    this.container.style.display = 'block';
    this.scheduleHide();
  }

  private scheduleHide(): void {
    // Clear existing timeout
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }

    // Don't hide if chat is open for input
    if (this.isOpen) return;

    // Schedule hide
    this.hideTimeout = window.setTimeout(() => {
      if (!this.isOpen && this.container) {
        this.container.style.display = 'none';
      }
      this.hideTimeout = null;
    }, this.options.hideAfterMs);
  }

  public isOpenForInput(): boolean {
    return this.isOpen;
  }

  public destroy(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }
      if (this.container) {
      document.body.removeChild(this.container);
      this.container = null;
    }
  }
}
