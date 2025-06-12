import { Net } from './Net';
import { GameManager } from './GameManager';

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
  private gameManager: GameManager;
  private currentStep: number = 0;
  private steps: SignalingStep[] = [];
  private isHost: boolean = false;
  private onCompleteCallback?: () => void;
  private onErrorCallback?: (error: string) => void;
  private connectionEstablished: boolean = false;
  private connectionCheckInterval?: number;

  constructor(net: Net, gameManager: GameManager) {
    this.net = net;
    this.gameManager = gameManager;
    this.setupConnectionStateListener();
  }
  private setupConnectionStateListener(): void {
    this.net.onConnectionStateChange((isConnected) => {
      if (isConnected && !this.connectionEstablished) {
        this.connectionEstablished = true;
        this.updateConnectionStatus();
        this.stopConnectionCheck();
        
        // Automatically close signaling UI and start the game immediately
        this.finishSignaling();
      }
    });
  }
  private startConnectionCheck(): void {
    // Stop any existing check
    this.stopConnectionCheck();
    
    // Check connection status every 500ms
    this.connectionCheckInterval = window.setInterval(() => {
      const isActive = this.net.isConnectionActive();
      
      if (isActive && !this.connectionEstablished) {
        this.connectionEstablished = true;
        this.updateConnectionStatus();
        this.stopConnectionCheck();
        
        // Automatically close signaling UI and start the game immediately
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
    
    // Show Step 1 immediately with loading spinner
    this.steps = [
      {
        type: 'offer',
        title: 'Step 1: Share Your Offer',
        instruction: 'Copy this offer and send it to the player who wants to join:',
        data: ''
      },
      {
        type: 'answer',
        title: 'Step 2: Enter Their Answer',
        instruction: 'Paste the answer you received from the other player:',
        isInput: true
      }
    ];
    
    this.currentStep = 0;
    this.showCurrentStepWithSpinner();
    
    try {
      // Note: We DON'T call createMultiplayerGame here anymore!
      // We'll create the multiplayer game when the connection is established
      console.log('HOST: Preparing to create WebRTC offer...');
      
      // Generate offer through Net with timeout (this just creates the WebRTC offer, not the game)
      const offerPromise = this.net.createOffer();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Offer generation timed out after 10 seconds')), 10000)
      );
      
      const offer = await Promise.race([offerPromise, timeoutPromise]) as string;
      console.log('Offer generated successfully');
      
      // Update the step with the actual offer data
      this.steps[0].data = offer;
      this.showCurrentStep();
      
      console.log('showHostFlow completed. Container still exists?', !!this.container);
      console.log('Container still in DOM?', !!document.getElementById('manualSignalingUI'));
    } catch (error) {
      console.error('Failed to create host game:', error);
      this.showError('Failed to create offer: ' + error);
    }
  }
  // Start the client signaling flow
  public async showJoinFlow(): Promise<void> {
    this.isHost = false;
    this.connectionEstablished = false;
    this.createContainer();
    
    try {
      // Note: We don't call joinMultiplayerGame here anymore!
      // The GameManager will handle the transition when the connection is established
      // and the full game state is received from the host
      
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
        }
      ];
      
      this.currentStep = 0;      this.showCurrentStep();
      
    } catch (error) {
      this.showError('Failed to initialize client: ' + error);
    }
  }

  private showCurrentStep(): void {
    console.log('showCurrentStep called:', { container: !!this.container, currentStep: this.currentStep, stepsLength: this.steps.length });
    
    if (!this.container || this.currentStep >= this.steps.length) {
      console.warn('showCurrentStep early return:', { container: !!this.container, currentStep: this.currentStep, stepsLength: this.steps.length });
      return;
    }
    
    const step = this.steps[this.currentStep];
    console.log('Showing step:', step);
    
    // Determine the appropriate status message
    let statusMessage = '🔄 Waiting for connection...';
    if (this.isHost && this.currentStep === 0) {
      statusMessage = '📋 Share this offer with the other player';
    } else if (this.isHost && this.currentStep === 1) {
      statusMessage = '🔄 Waiting for connection...';
    } else if (!this.isHost && this.currentStep === 0) {
      statusMessage = '📝 Paste the host\'s offer below';
    } else if (!this.isHost && this.currentStep === 1) {
      statusMessage = '📋 Share this answer with the host';
    }
    
    this.container.innerHTML = `
      <div class="signaling-step">
        <h2>${step.title}</h2>
        <p>${step.instruction}</p>
        <div class="connection-status">${statusMessage}</div>
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
  
  private showCurrentStepWithSpinner(): void {
    if (!this.container || this.currentStep >= this.steps.length) return;
    
    const step = this.steps[this.currentStep];
    
    this.container.innerHTML = `
      <div class="signaling-step">
        <h2>${step.title}</h2>
        <p>${step.instruction}</p>
        <div class="connection-status">🔄 Generating offer...</div>
        <textarea id="signalingOutput" readonly rows="10" placeholder="Generating offer, please wait..."></textarea>
        <button id="copyData" disabled>Copy to Clipboard</button>
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
        
        // Start connection checking for host after processing answer
        this.startConnectionCheck();
        
        // Also check immediately if already connected
        if (this.net.isConnectionActive() && !this.connectionEstablished) {
          this.connectionEstablished = true;
          this.updateConnectionStatus();
          this.stopConnectionCheck();
          
          // Automatically close signaling UI and start the game immediately
          this.finishSignaling();
          return; // Don't continue to nextStep
        }
      } else {
        // Client processing host offer
        const answer = await this.net.createAnswer(data);
        this.steps[1].data = answer; // Update answer step with generated answer
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
          this.finishSignaling();
        }
      }
        } catch (error) {
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
      }    } catch (error) {
      // Fallback: select the text
      output.select();
      output.setSelectionRange(0, 99999);
    }
  }
  private finishSignaling(): void {
    // Handle the transition to multiplayer for both host and client
    if (this.isHost) {
      console.log('🏗️ ManualSignalingUI: Host connection established, creating multiplayer game');
      // Host creates the multiplayer game now that connection is established
      this.gameManager.createMultiplayerGame()
        .then((gameId) => {
          console.log(`✅ Host created multiplayer game: ${gameId}`);
        })
        .catch((error) => {
          console.error('❌ Failed to create host multiplayer game:', error);
        });
    } else {
      console.log('🔗 ManualSignalingUI: Client connection established, joining multiplayer game');
      // Client sets up multiplayer state and waits for the full game state from host
      this.gameManager.joinMultiplayerGame('connected_game')
        .then(() => {
          console.log('✅ Client prepared for multiplayer game');
        })
        .catch((error) => {
          console.error('❌ Failed to prepare client for multiplayer:', error);
        });
    }
    
    this.close();
    this.onCompleteCallback?.();
  }

  private showError(message: string): void {
    if (!this.container) return;
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'signaling-error';
    errorDiv.innerHTML = `<strong>Error:</strong> ${message}`;
    
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
    console.log('ManualSignalingUI container created and added to DOM:', this.container);
    console.log('Container in DOM?', document.getElementById('manualSignalingUI'));
    console.log('Container styles:', window.getComputedStyle(this.container).display, window.getComputedStyle(this.container).visibility);
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
        font-family: var(--theme-font-family);
      }
      
      .signaling-step {
        background: var(--theme-bg-primary);
        border: var(--theme-border-width) solid var(--theme-border-primary);
        border-radius: var(--theme-border-radius);
        padding: var(--theme-padding-large);
        max-width: 600px;
        width: 90%;
        color: var(--theme-text-primary);
        text-align: center;
        font-size: 2em;
      }
      
      .signaling-step h2 {
        color: var(--theme-text-primary);
        margin-bottom: 20px;
        font-size: 1em;
        font-weight: normal;
      }
      
      .signaling-step p {
        margin-bottom: 20px;
        font-size: 0.75em;
        line-height: 1.5;
        color: var(--theme-text-primary);
      }
      
      .connection-status {
        margin: 15px 0;
        padding: 10px;
        border-radius: var(--theme-border-radius);
        font-weight: bold;
        font-size: 0.5em;
        background: rgba(255, 165, 0, 0.2);
        color: #FFA500;
      }
      
      .connection-status.connected {
        background: var(--theme-success-bg);
        color: #4CAF50;
      }
      
      #signalingInput, #signalingOutput {
        width: 100%;
        min-height: 150px;
        background: var(--theme-bg-primary);
        border: var(--theme-border-width) solid var(--theme-border-primary);
        border-radius: var(--theme-border-radius);
        color: var(--theme-text-primary);
        padding: 15px;
        font-family: var(--theme-font-family-mono);
        font-size: 0.4em;
        resize: vertical;
        margin-bottom: 15px;
        box-sizing: border-box;
      }
      
      #signalingInput:focus, #signalingOutput:focus {
        outline: none;
        border-color: var(--theme-border-primary);
      }
      
      .signaling-step button {
        position: relative;
        padding: 0.5rem 0.8rem;
        margin: 5px;
        border: var(--theme-border-width) solid var(--theme-border-primary);
        border-radius: var(--theme-border-radius);
        background-color: var(--theme-bg-primary);
        color: var(--theme-text-primary);
        font-family: var(--theme-font-family);
        font-size: 0.75em;
        cursor: pointer;
        transition: var(--theme-transition-normal);
      }
      
      .signaling-step button::after {
        content: "";
        position: absolute;
        inset: 0;
        background-color: transparent;
        border-radius: var(--theme-border-radius);
        transition: background-color var(--theme-transition-normal);
      }
      
      .signaling-step button:hover::after {
        background-color: var(--theme-hover-overlay);
      }
      
      .signaling-step button:active {
        transform: translateY(1px);
      }
      
      #closeSignaling {
        background: var(--theme-error-bg);
        border-color: var(--theme-error-border);
      }
      
      #closeSignaling:hover::after {
        background-color: rgba(255, 100, 100, 0.3);
      }
      
      .signaling-error {
        margin-bottom: 20px;
        color: var(--theme-error-border);
        background: var(--theme-error-bg);
        padding: 10px;
        border-radius: var(--theme-border-radius);
        font-size: 0.6em;
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
    console.log('ManualSignalingUI.close() called');
    this.stopConnectionCheck();
    if (this.container) {
      console.log('Removing container from DOM');
      this.container.remove();
      this.container = null;
    }
  }

  isVisible(): boolean {
    return this.container !== null;
  }

  static show(net: Net, gameManager: GameManager, isHost: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const ui = new ManualSignalingUI(net, gameManager);
      
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
