import { Net } from './Net';
import { MultiplayerManager } from './MultiplayerManager';

export interface SignalingStep {
  type: 'offer' | 'answer' | 'complete';
  title: string;
  instruction: string;
  data?: string;
  isInput?: boolean;
}

export class ManualSignalingUI {
  private container: HTMLElement | null = null;
  private net: Net;
  private mpManager: MultiplayerManager;
  private currentStep: number = 0;
  private steps: SignalingStep[] = [];
  private isHost: boolean = false;
  private onCompleteCallback?: () => void;
  private onErrorCallback?: (error: string) => void;
  private connectionEstablished: boolean = false;
  private connectionCheckInterval?: number;

  constructor(net: Net, mpManager: MultiplayerManager) {
    this.net = net;
    this.mpManager = mpManager;
    this.setupConnectionStateListener();
  }

  private setupConnectionStateListener(): void {
    this.net.onConnectionStateChange((isConnected) => {
      console.log(`Connection state changed: ${isConnected}`);
      if (isConnected && !this.connectionEstablished) {
        this.connectionEstablished = true;
        this.updateConnectionStatus();
        this.stopConnectionCheck();
        
        // Automatically close signaling UI and start the game immediately
        console.log('Connection established, automatically starting game');
        this.finishSignaling();
      }
    });
  }

  private startConnectionCheck(): void {
    // Stop any existing check
    this.stopConnectionCheck();
    
    // Check connection status every 500ms
    this.connectionCheckInterval = window.setInterval(() => {
      if (this.net.isConnectionActive() && !this.connectionEstablished) {
        this.connectionEstablished = true;
        this.updateConnectionStatus();
        this.stopConnectionCheck();
        
        // Automatically close signaling UI and start the game immediately
        console.log('Connection detected via polling, automatically starting game');
        this.finishSignaling();
      }
    }, 500);
  }

  private stopConnectionCheck(): void {
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = undefined;
    }
  }

  private updateConnectionStatus(): void {
    if (!this.container) return;
    
    const statusElement = this.container.querySelector('.connection-status');
    if (statusElement) {
      statusElement.textContent = '✅ Connected! Starting game...';
      statusElement.className = 'connection-status connected';
    }
  }

  // Start the host signaling flow
  public async showHostFlow(): Promise<void> {
    this.isHost = true;
    this.connectionEstablished = false;
    this.createContainer();
    
    try {
      console.log('Starting host signaling flow');
      
      // Create the game (this sets up multiplayer manager as host)
      console.log('Calling mpManager.createGame()...');
      const gameId = await this.mpManager.createGame();
      console.log(`Game created with ID: ${gameId}`);
      console.log(`MultiplayerManager isHost: ${this.mpManager.isHost}`);
      
      // Generate offer through Net
      const offer = await this.net.createOffer();
      console.log(`Net isHost: ${(this.net as any).isHost}`);
      
      this.steps = [
        {
          type: 'offer',
          title: 'Step 1: Share Your Offer',
          instruction: 'Copy this offer and send it to the player who wants to join:',
          data: offer
        },
        {
          type: 'answer',
          title: 'Step 2: Enter Their Answer',
          instruction: 'Paste the answer you received from the other player:',
          isInput: true
        },
        {
          type: 'complete',
          title: 'Step 3: Connection Complete',
          instruction: 'Connection established! The game will start automatically.'
        }
      ];
      
      this.currentStep = 0;
      this.showCurrentStep();
      
    } catch (error) {
      console.error('Host flow error:', error);
      this.showError('Failed to create offer: ' + error);
    }
  }

  // Start the client signaling flow
  public async showJoinFlow(): Promise<void> {
    this.isHost = false;
    this.connectionEstablished = false;
    this.createContainer();
    
    try {
      console.log('Starting client signaling flow');
      
      // Initialize as client (this sets isHost to false)
      await this.mpManager.joinGame('manual_join');
      console.log(`MultiplayerManager isHost: ${this.mpManager.isHost}`);
      
      this.steps = [
        {
          type: 'offer',
          title: 'Step 1: Enter Host\'s Offer',
          instruction: 'Paste the offer you received from the host:',
          isInput: true
        },
        {
          type: 'answer',
          title: 'Step 2: Share Your Answer',
          instruction: 'Copy this answer and send it back to the host:',
          data: ''
        },
        {
          type: 'complete',
          title: 'Step 3: Connection Complete',
          instruction: 'Connection established! The game will start automatically.'
        }
      ];
      
      this.currentStep = 0;
      this.showCurrentStep();
      
    } catch (error) {
      console.error('Client flow error:', error);
      this.showError('Failed to initialize client: ' + error);
    }
  }

  private showCurrentStep(): void {
    if (!this.container || this.currentStep >= this.steps.length) return;
    
    const step = this.steps[this.currentStep];
    
    this.container.innerHTML = `
      <div class="signaling-step">
        <h2>${step.title}</h2>
        <p>${step.instruction}</p>
        <div class="connection-status">🔄 Waiting for connection...</div>
        ${step.isInput ? 
          `<textarea id="signalingInput" placeholder="Paste data here..." rows="10"></textarea>
           <button id="processInput">Next</button>` :
          `<textarea id="signalingOutput" readonly rows="10">${step.data || ''}</textarea>
           <button id="copyData">Copy to Clipboard</button>
           ${this.currentStep < this.steps.length - 1 ? '<button id="nextStep">Next</button>' : ''}`
        }
        <button id="closeSignaling">Cancel</button>
      </div>
    `;
    
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    if (!this.container) return;
    
    const processBtn = this.container.querySelector('#processInput');
    const nextBtn = this.container.querySelector('#nextStep');
    const copyBtn = this.container.querySelector('#copyData');
    const closeBtn = this.container.querySelector('#closeSignaling');
    
    if (processBtn) {
      processBtn.addEventListener('click', () => this.processInput());
    }
    
    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.nextStep());
    }
    
    if (copyBtn) {
      copyBtn.addEventListener('click', () => this.copyToClipboard());
    }
    
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.close();
        this.onErrorCallback?.('User cancelled');
      });
    }
  }

  private async processInput(): Promise<void> {
    const input = this.container?.querySelector('#signalingInput') as HTMLTextAreaElement;
    if (!input?.value.trim()) return;
    
    const data = input.value.trim();
    
    try {
      if (this.isHost) {
        // Host processing client answer
        await this.net.processAnswer(data);
        console.log('Host processed client answer');
        
        // Start connection checking for host after processing answer
        this.startConnectionCheck();
        
        // Also check immediately if already connected
        if (this.net.isConnectionActive() && !this.connectionEstablished) {
          this.connectionEstablished = true;
          this.updateConnectionStatus();
          this.stopConnectionCheck();
          
          // Automatically close signaling UI and start the game immediately
          console.log('Host connection detected immediately after processing answer');
          this.finishSignaling();
          return; // Don't continue to nextStep
        }
      } else {
        // Client processing host offer
        const answer = await this.net.createAnswer(data);
        this.steps[1].data = answer; // Update answer step with generated answer
        console.log('Client processed host offer and generated answer');
      }
      
      this.nextStep();
      
      // For clients, immediately start connection checking after generating answer
      if (!this.isHost && this.currentStep === 1) {
        this.startConnectionCheck();
        
        // Also check immediately if already connected
        if (this.net.isConnectionActive() && !this.connectionEstablished) {
          this.connectionEstablished = true;
          this.updateConnectionStatus();
          this.stopConnectionCheck();
          
          // Automatically close signaling UI and start the game immediately
          console.log('Connection detected immediately, automatically starting game');
          this.finishSignaling();
        }
      }
      
    } catch (error) {
      console.error('Process input error:', error);
      this.showError('Invalid signaling data: ' + error);
    }
  }

  private nextStep(): void {
    this.currentStep++;
    
    if (this.currentStep >= this.steps.length) {
      this.finishSignaling();
    } else {
      this.showCurrentStep();
    }
  }

  private async copyToClipboard(): Promise<void> {
    const output = this.container?.querySelector('#signalingOutput') as HTMLTextAreaElement;
    if (!output) return;

    try {
      await navigator.clipboard.writeText(output.value);
      
      // Visual feedback
      const copyBtn = this.container?.querySelector('#copyData') as HTMLButtonElement;
      if (copyBtn) {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        copyBtn.style.backgroundColor = '#4CAF50';
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.style.backgroundColor = '';
        }, 2000);
      }
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      // Fallback: select the text
      output.select();
      output.setSelectionRange(0, 99999);
    }
  }

  private finishSignaling(): void {
    console.log('Signaling process completed');
    this.close();
    this.onCompleteCallback?.();
  }

  private showError(message: string): void {
    if (!this.container) return;
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'signaling-error';
    errorDiv.innerHTML = `
      <div style="color: #ff4444; background: rgba(255, 68, 68, 0.1); padding: 10px; border-radius: 5px; margin: 10px 0;">
        <strong>Error:</strong> ${message}
      </div>
    `;
    
    this.container.prepend(errorDiv);
    
    // Auto-remove error after 5 seconds
    setTimeout(() => {
      errorDiv.remove();
    }, 5000);
    
    // Call error callback
    this.onErrorCallback?.(message);
  }

  private createContainer(): void {
    // Remove any existing container
    this.close();
    
    // Create main container
    this.container = document.createElement('div');
    this.container.id = 'manualSignalingUI';
    this.container.className = 'signaling-overlay';
    
    // Add styles
    this.addStyles();
    
    document.body.appendChild(this.container);
  }

  private addStyles(): void {
    if (document.getElementById('signalingStyles')) return;
    
    const styles = document.createElement('style');
    styles.id = 'signalingStyles';
    styles.textContent = `
      .signaling-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
        font-family: 'Courier New', monospace;
      }
      
      .signaling-step {
        background: #1a1a1a;
        border: 2px solid #333;
        border-radius: 10px;
        padding: 30px;
        max-width: 600px;
        width: 90%;
        color: #fff;
        text-align: center;
      }
      
      .signaling-step h2 {
        color: #4CAF50;
        margin-bottom: 20px;
        font-size: 24px;
      }
      
      .signaling-step p {
        margin-bottom: 20px;
        font-size: 16px;
        line-height: 1.5;
      }
      
      .connection-status {
        margin: 15px 0;
        padding: 10px;
        border-radius: 5px;
        font-weight: bold;
        background: rgba(255, 165, 0, 0.2);
        color: #FFA500;
      }
      
      .connection-status.connected {
        background: rgba(76, 175, 80, 0.2);
        color: #4CAF50;
      }
      
      #signalingInput, #signalingOutput {
        width: 100%;
        min-height: 150px;
        background: #2a2a2a;
        border: 1px solid #555;
        border-radius: 5px;
        color: #fff;
        padding: 15px;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        resize: vertical;
        margin-bottom: 15px;
        box-sizing: border-box;
      }
      
      #signalingInput:focus, #signalingOutput:focus {
        outline: none;
        border-color: #4CAF50;
      }
      
      .signaling-step button {
        background: #4CAF50;
        color: white;
        border: none;
        padding: 12px 24px;
        margin: 5px;
        border-radius: 5px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        transition: background-color 0.2s;
      }
      
      .signaling-step button:hover {
        background: #45a049;
      }
      
      .signaling-step button:active {
        transform: translateY(1px);
      }
      
      #closeSignaling {
        background: #f44336;
      }
      
      #closeSignaling:hover {
        background: #d32f2f;
      }
      
      .signaling-error {
        margin-bottom: 20px;
      }
    `;
    
    document.head.appendChild(styles);
  }

  onComplete(callback: () => void): void {
    this.onCompleteCallback = callback;
  }

  onError(callback: (error: string) => void): void {
    this.onErrorCallback = callback;
  }

  close(): void {
    this.stopConnectionCheck();
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }

  isVisible(): boolean {
    return this.container !== null;
  }

  static show(net: Net, mpManager: MultiplayerManager, isHost: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const ui = new ManualSignalingUI(net, mpManager);
      
      ui.onComplete(() => {
        resolve();
      });
      
      ui.onError((error) => {
        reject(new Error(error));
      });
      
      if (isHost) {
        ui.showHostFlow();
      } else {
        ui.showJoinFlow();
      }
    });
  }
}
