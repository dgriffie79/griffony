import { Net } from './Net';
import { Logger } from './Logger.js';

const logger = Logger.getInstance();

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
  private currentStep: number = 0;
  private steps: SignalingStep[] = [];
  private isHost: boolean = false;
  private onCompleteCallback?: () => void;
  private onErrorCallback?: (error: string) => void;

  constructor(net: Net) {
    this.net = net;
  }
  // Show host signaling flow directly
  showHostFlow(): void {
    this.createContainer();
    if (!this.container) return;
    this.startHostFlow();
  }

  // Show join signaling flow directly  
  showJoinFlow(): void {
    this.createContainer();
    if (!this.container) return;
    this.startJoinFlow();
  }

  // Start the host signaling flow
  private async startHostFlow(): Promise<void> {
    this.isHost = true;
    
    try {
      logger.info('SIGNALING', 'Starting host signaling flow');
      
      // Generate offer
      const offer = await this.net.createOffer();
      
      this.steps = [
        {
          type: 'offer',
          title: 'Step 1: Share Your Offer',
          instruction: 'Copy this offer and send it to the player who wants to join:',
          data: offer
        },
        {
          type: 'answer',
          title: 'Step 2: Enter Client Answer',
          instruction: 'Paste the answer you received from the joining player:',
          isInput: true
        },
        {
          type: 'complete',
          title: 'Connection Complete!',
          instruction: 'The connection has been established successfully.'
        }
      ];
      
      this.currentStep = 0;
      this.showCurrentStep();
      
    } catch (error) {
      logger.error('SIGNALING', 'Host flow error:', error);
      this.showError('Failed to create offer: ' + error);
    }
  }

  // Start the client signaling flow
  private startJoinFlow(): void {
    this.isHost = false;
    
    this.steps = [
      {
        type: 'offer',
        title: 'Step 1: Enter Host Offer',
        instruction: 'Paste the offer you received from the host:',
        isInput: true
      },
      {
        type: 'answer',
        title: 'Step 2: Share Your Answer',
        instruction: 'Copy this answer and send it back to the host:',
        data: '' // Will be filled after processing offer
      },
      {
        type: 'complete',
        title: 'Connection Complete!',
        instruction: 'Waiting for the host to complete the connection...'
      }
    ];
    
    this.currentStep = 0;
    this.showCurrentStep();
  }

  private showCurrentStep(): void {
    if (!this.container || this.currentStep >= this.steps.length) return;
    
    const step = this.steps[this.currentStep];
    
    this.container.innerHTML = `
      <div class="signaling-step">
        <div class="step-header">
          <h2>${step.title}</h2>
          <div class="step-progress">
            Step ${this.currentStep + 1} of ${this.steps.length}
          </div>
        </div>
        
        <p class="step-instruction">${step.instruction}</p>
        
        ${step.isInput ? this.createInputSection() : this.createDataSection(step.data || '')}
        
        <div class="step-buttons">
          ${step.isInput ? '<button id="processInput" class="primary-btn">Continue</button>' : ''}
          ${!step.isInput && this.currentStep < this.steps.length - 1 ? '<button id="nextStep" class="primary-btn">Next</button>' : ''}
          ${step.type === 'complete' ? '<button id="finishSignaling" class="success-btn">Start Game</button>' : ''}
          <button id="cancelSignaling" class="cancel-btn">Cancel</button>
        </div>
      </div>
    `;

    this.attachStepEventListeners();
  }

  private createInputSection(): string {
    return `
      <div class="input-section">
        <textarea id="signalingInput" placeholder="Paste the signaling data here..." rows="10"></textarea>
        <div class="input-help">
          <small>💡 Tip: Use Ctrl+V to paste the data</small>
        </div>
      </div>
    `;
  }

  private createDataSection(data: string): string {
    return `
      <div class="output-section">
        <textarea id="signalingOutput" readonly rows="10">${data}</textarea>
        <button id="copyData" class="copy-btn">📋 Copy to Clipboard</button>
        <div class="copy-help">
          <small>💡 Click the copy button or select all text and press Ctrl+C</small>
        </div>
      </div>
    `;
  }

  private attachStepEventListeners(): void {
    const processBtn = document.getElementById('processInput');
    const nextBtn = document.getElementById('nextStep');
    const finishBtn = document.getElementById('finishSignaling');
    const cancelBtn = document.getElementById('cancelSignaling');
    const copyBtn = document.getElementById('copyData');    processBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.processInput(); });
    nextBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.nextStep(); });
    finishBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.finishSignaling(); });
    cancelBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.close(); });
    copyBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.copyToClipboard(); });
  }

  private async processInput(): Promise<void> {
    const input = document.getElementById('signalingInput') as HTMLTextAreaElement;
    if (!input || !input.value.trim()) {
      this.showError('Please paste the signaling data');
      return;
    }

    try {
      const data = input.value.trim();
      
      if (this.isHost) {
        // Host processing client answer
        await this.net.processAnswer(data);
        logger.info('SIGNALING', 'Host processed client answer');
      } else {
        // Client processing host offer
        const answer = await this.net.createAnswer(data);
        this.steps[1].data = answer; // Update answer step with generated answer
        logger.info('SIGNALING', 'Client processed host offer and generated answer');
      }
      
      this.nextStep();
      
    } catch (error) {
      logger.error('SIGNALING', 'Process input error:', error);
      this.showError('Invalid signaling data: ' + error);
    }
  }

  private nextStep(): void {
    this.currentStep++;
    this.showCurrentStep();
  }

  private async copyToClipboard(): Promise<void> {
    const output = document.getElementById('signalingOutput') as HTMLTextAreaElement;
    if (!output) return;

    try {
      await navigator.clipboard.writeText(output.value);
      
      // Show feedback
      const copyBtn = document.getElementById('copyData');
      if (copyBtn) {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '✅ Copied!';
        copyBtn.classList.add('copied');
        
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.classList.remove('copied');
        }, 2000);
      }
      
    } catch (error) {
      // Fallback for older browsers
      output.select();
      document.execCommand('copy');
      logger.info('SIGNALING', 'Data copied to clipboard (fallback method)');
    }
  }

  private finishSignaling(): void {
    logger.info('SIGNALING', 'Signaling process completed');
    this.close();
    this.onCompleteCallback?.();
  }

  private showError(message: string): void {
    if (!this.container) return;
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'signaling-error';
    errorDiv.innerHTML = `
      <div class="error-content">
        <span class="error-icon">⚠️</span>
        <span class="error-message">${message}</span>
        <button class="error-close">×</button>
      </div>
    `;
    
    this.container.prepend(errorDiv);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      errorDiv.remove();
    }, 5000);
    
    // Manual close
    const closeBtn = errorDiv.querySelector('.error-close');
    closeBtn?.addEventListener('click', () => errorDiv.remove());
    
    this.onErrorCallback?.(message);
  }

  private createContainer(): void {
    // Remove existing container
    this.close();
    
    // Create new container
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
    styles.id = 'signalingStyles';    styles.textContent = `
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
        color: var(--theme-text-primary);
        padding: var(--theme-padding-large);
        border: var(--theme-border-width) solid var(--theme-border-primary);
        border-radius: var(--theme-border-radius);
        max-width: 600px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        font-size: 1.2em;
      }
      
      .signaling-step h2 {
        margin: 0 0 1rem 0;
        color: var(--theme-text-primary);
        text-align: center;
        font-size: 1.5em;
      }
      
      .step-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.3);
      }
      
      .step-progress {
        background: rgba(255, 255, 255, 0.1);
        padding: 0.3rem var(--theme-padding-base);
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: var(--theme-border-radius);
        font-size: 0.8em;
        color: var(--theme-text-primary);
      }
      
      .step-instruction {
        background: rgba(255, 255, 255, 0.05);
        padding: 1rem;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: var(--theme-border-radius);
        margin: 1rem 0;
        color: var(--theme-text-primary);
        line-height: 1.4;
      }
      
      .input-section, .output-section {
        margin: 1rem 0;
      }
      
      .input-section textarea, .output-section textarea {
        width: 100%;
        min-height: 120px;
        background: var(--theme-bg-primary);
        border: var(--theme-border-width) solid var(--theme-border-primary);
        border-radius: var(--theme-border-radius);
        padding: var(--theme-padding-base);
        color: var(--theme-text-primary);
        font-family: var(--theme-font-family-mono);
        font-size: 0.9em;
        resize: vertical;
        box-sizing: border-box;
      }
      
      .input-section textarea:focus {
        outline: none;
        border-color: rgba(255, 255, 255, 0.8);
        box-shadow: 0 0 5px rgba(255, 255, 255, 0.3);
      }
      
      .input-section textarea::placeholder {
        color: var(--theme-text-secondary);
      }
      
      .copy-btn, .primary-btn, .success-btn, .cancel-btn {
        position: relative;
        padding: 0.6rem 1.2rem;
        border: var(--theme-border-width) solid var(--theme-border-primary);
        border-radius: var(--theme-border-radius);
        background-color: var(--theme-bg-primary);
        color: var(--theme-text-primary);
        font-family: var(--theme-font-family);
        font-size: 0.9em;
        cursor: pointer;
        transition: all var(--theme-transition-fast);
        margin: 0.5rem 0.5rem 0 0;
      }
      
      .copy-btn::after, .primary-btn::after, .success-btn::after, .cancel-btn::after {
        content: "";
        position: absolute;
        inset: 0;
        background-color: transparent;
        border-radius: var(--theme-border-radius);
        transition: background-color var(--theme-transition-normal);
      }
      
      .copy-btn:hover::after, .primary-btn:hover::after {
        background-color: var(--theme-hover-overlay);
      }
      
      .success-btn {
        background-color: var(--theme-success-bg);
        border-color: var(--theme-success-border);
      }
      
      .success-btn:hover::after {
        background-color: rgba(0, 255, 0, 0.1);
      }
      
      .cancel-btn:hover::after {
        background-color: rgba(255, 255, 255, 0.05);
      }
      
      .copy-btn.copied {
        background-color: var(--theme-success-bg);
        border-color: var(--theme-success-border);
      }
      
      .input-help, .copy-help {
        margin-top: 0.5rem;
      }
      
      .input-help small, .copy-help small {
        color: var(--theme-text-secondary);
        font-style: italic;
        font-size: 0.8em;
      }
      
      .step-buttons {
        display: flex;
        gap: var(--theme-gap-base);
        justify-content: flex-end;
        margin-top: 2rem;
        padding-top: 1rem;
        border-top: 1px solid rgba(255, 255, 255, 0.3);
      }
      
      .signaling-error {
        background: var(--theme-error-bg);
        color: var(--theme-text-primary);
        padding: 1rem;
        border: var(--theme-border-width) solid var(--theme-error-border);
        border-radius: var(--theme-border-radius);
        margin-bottom: 1rem;
        animation: slideIn var(--theme-transition-normal);
      }      
      .error-content {
        display: flex;
        align-items: center;
        gap: var(--theme-gap-base);
      }
      
      .error-icon {
        font-size: 1.2em;
      }
      
      .error-message {
        flex: 1;
      }
      
      .error-close {
        background: none;
        border: none;
        color: var(--theme-text-primary);
        font-size: 1.2em;
        cursor: pointer;
        padding: 0;
        margin-left: auto;
      }
      
      @keyframes slideIn {
        from {
          transform: translateY(-10px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
        align-items: center;
        gap: 0.8rem;
      }
      
      .error-message {
        flex: 1;
        font-size: 0.9em;
      }
      
      .error-close {
        background: none;
        border: 1px solid rgba(255, 255, 255, 0.5);
        color: white;
        font-size: 1.2em;
        font-weight: bold;
        cursor: pointer;
        padding: 0.2rem 0.5rem;
        border-radius: 3px;
        transition: background-color 0.2s ease;
      }
      
      .error-close:hover {
        background: rgba(255, 255, 255, 0.2);
      }
      
      @keyframes slideIn {
        from {
          transform: translateY(-20px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
      
      @media (max-width: 768px) {
        .signaling-step {
          width: 95%;
          padding: 1.5rem;
          font-size: 1em;
        }
        
        .step-header {
          flex-direction: column;
          gap: 0.8rem;
          text-align: center;
        }
        
        .step-buttons {
          flex-wrap: wrap;
          justify-content: center;
        }
        
        .copy-btn, .primary-btn, .success-btn, .cancel-btn {
          font-size: 0.8em;
          padding: 0.5rem 1rem;
        }
      }
    `;
    
    document.head.appendChild(styles);
  }

  // Public API
  onComplete(callback: () => void): void {
    this.onCompleteCallback = callback;
  }

  onError(callback: (error: string) => void): void {
    this.onErrorCallback = callback;
  }

  close(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }

  isVisible(): boolean {
    return this.container !== null;
  }
  // Static helper for easy integration
  static show(net: Net, isHost: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const ui = new ManualSignalingUI(net);
      
      ui.onComplete(() => {
        ui.close();
        resolve();
      });
      
      ui.onError((error) => {
        ui.close();
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
