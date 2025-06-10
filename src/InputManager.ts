import { vec2 } from 'gl-matrix';
import { 
  MessageType, 
  MessagePriority, 
  type PlayerInputMessage, 
  type PlayerActionMessage 
} from './types';

export interface InputState {
  // Movement keys
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  crouch: boolean;
  
  // Action keys
  attack: boolean;
  block: boolean;
  interact: boolean;
  reload: boolean;
  aim: boolean;
  
  // Mouse input
  mouseDelta: vec2;
  mouseButtons: {
    left: boolean;
    right: boolean;
    middle: boolean;
  };
}

export interface BufferedInput {
  inputState: InputState;
  timestamp: number;
  sequenceNumber: number;
  deltaTime: number;
}

export interface InputEvent {
  type: 'keydown' | 'keyup' | 'mousemove' | 'mousedown' | 'mouseup' | 'action';
  key?: string;
  button?: number;
  deltaX?: number;
  deltaY?: number;
  action?: string;
  timestamp: number;
}

export class InputManager {
  private static instance: InputManager;
  
  // Current input state
  private currentInput: InputState = this.createEmptyInputState();
  
  // Input buffering for networking
  private inputBuffer: BufferedInput[] = [];
  private inputSequence: number = 0;
  private maxBufferSize: number = 120; // 2 seconds at 60 FPS
  
  // Key bindings
  private keyBindings: Map<string, keyof InputState> = new Map();
  
  // Mouse handling
  private mouseSensitivity: number = 1.0;
  private mouseInverted: boolean = false;
  private mouseLocked: boolean = false;
    // Event callbacks
  private onInputCallback?: (input: BufferedInput) => void;
  private onActionCallback?: (action: string, position?: [number, number, number]) => void;
  private onChatOpenCallback?: () => void;
  
  // Performance tracking
  private inputsProcessed: number = 0;
  private lastInputTime: number = 0;
  private averageInputRate: number = 0;

  private constructor() {
    this.setupDefaultKeyBindings();
    this.setupEventListeners();
  }

  static getInstance(): InputManager {
    if (!InputManager.instance) {
      InputManager.instance = new InputManager();
    }
    return InputManager.instance;
  }

  // Setup and Configuration
  private setupDefaultKeyBindings(): void {
    // Movement keys
    this.keyBindings.set('KeyW', 'forward');
    this.keyBindings.set('KeyS', 'backward');
    this.keyBindings.set('KeyA', 'left');
    this.keyBindings.set('KeyD', 'right');
    this.keyBindings.set('Space', 'jump');
    this.keyBindings.set('ShiftLeft', 'crouch');
    this.keyBindings.set('ControlLeft', 'crouch');
    
    // Action keys - these will trigger action events instead of state changes
    // Attack and block are handled via mouse buttons and action events
  }

  private setupEventListeners(): void {
    // Keyboard events
    document.addEventListener('keydown', (event) => {
      this.handleKeyEvent(event, true);
    });

    document.addEventListener('keyup', (event) => {
      this.handleKeyEvent(event, false);
    });

    // Mouse events
    document.addEventListener('mousemove', (event) => {
      this.handleMouseMove(event);
    });

    document.addEventListener('mousedown', (event) => {
      this.handleMouseButton(event, true);
    });

    document.addEventListener('mouseup', (event) => {
      this.handleMouseButton(event, false);
    });

    // Prevent context menu on right click
    document.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });

    // Handle pointer lock
    document.addEventListener('pointerlockchange', () => {
      this.mouseLocked = document.pointerLockElement === document.body;
    });
  }
  // Event Handlers
  private handleKeyEvent(event: KeyboardEvent, isPressed: boolean): void {
    // Check if chat input has focus - if so, don't process movement keys
    const chatInput = document.querySelector('#chat-ui input') as HTMLInputElement;
    const isChatInputFocused = chatInput && document.activeElement === chatInput;
    
    const binding = this.keyBindings.get(event.code);
    
    if (binding) {
      // Don't prevent default or process movement keys if chat input is focused
      if (isChatInputFocused) {
        return;
      }
      
      event.preventDefault();
      
      // Handle movement keys
      if (binding in this.currentInput) {
        (this.currentInput as any)[binding] = isPressed;
      }
      
      // Handle action keys (only on key down)
      if (isPressed) {
        switch (event.code) {
          case 'KeyE':
            this.triggerAction('interact');
            break;
          case 'KeyR':
            this.triggerAction('reload');
            break;
          case 'KeyF':
            this.triggerAction('aim');
            break;
        }
      }
    }    // Handle special keys
    if (isPressed) {
      switch (event.code) {
        case 'KeyT':
          this.triggerAction('chat');
          break;
        case 'Escape':
          this.releaseMouse();
          break;
        case 'Enter':
          if (event.altKey) {
            // Toggle fullscreen
            this.toggleFullscreen();
          }
          break;
      }
    }
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.mouseLocked) return;

    const deltaX = event.movementX * this.mouseSensitivity;
    const deltaY = event.movementY * this.mouseSensitivity * (this.mouseInverted ? 1 : -1);

    this.currentInput.mouseDelta[0] += deltaX;
    this.currentInput.mouseDelta[1] += deltaY;
  }
  private handleMouseButton(event: MouseEvent, isPressed: boolean): void {
    const target = event.target as HTMLElement;
    
    // Don't process mouse input if clicking on UI elements
    if (this.isUIElement(target)) {
      return; // Allow normal button behavior
    }
    
    event.preventDefault();

    switch (event.button) {
      case 0: // Left mouse button
        this.currentInput.mouseButtons.left = isPressed;
        if (isPressed) {
          this.triggerAction('attack');
          this.requestMouseLock();
        }
        break;
      case 1: // Middle mouse button
        this.currentInput.mouseButtons.middle = isPressed;
        break;
      case 2: // Right mouse button
        this.currentInput.mouseButtons.right = isPressed;
        if (isPressed) {
          this.triggerAction('block');
        }
        break;
    }
  }

  // Input Processing
  update(deltaTime: number): BufferedInput | null {
    const now = Date.now();
    
    // Create buffered input
    const bufferedInput: BufferedInput = {
      inputState: this.cloneInputState(this.currentInput),
      timestamp: now,
      sequenceNumber: ++this.inputSequence,
      deltaTime
    };

    // Add to buffer
    this.inputBuffer.push(bufferedInput);
    
    // Trim buffer to max size
    if (this.inputBuffer.length > this.maxBufferSize) {
      this.inputBuffer = this.inputBuffer.slice(-this.maxBufferSize);
    }

    // Reset mouse delta after processing
    vec2.set(this.currentInput.mouseDelta, 0, 0);

    // Update performance tracking
    this.inputsProcessed++;
    if (now - this.lastInputTime > 0) {
      this.averageInputRate = 1000 / (now - this.lastInputTime);
    }
    this.lastInputTime = now;

    // Trigger callback
    this.onInputCallback?.(bufferedInput);    return bufferedInput;
  }

  private triggerAction(action: string): void {
    console.log(`Action triggered: ${action}`);
    
    if (action === 'chat') {
      // Don't open chat if signaling UI is active
      const signalingUI = document.getElementById('manualSignalingUI');
      if (signalingUI) {
        console.log('Cannot open chat while signaling UI is active');
        return;
      }
      this.onChatOpenCallback?.();
    } else {
      this.onActionCallback?.(action);
    }
  }

  // Network Integration
  createNetworkInputMessage(playerId: string, input: BufferedInput): PlayerInputMessage {
    return {
      type: MessageType.PLAYER_INPUT,
      priority: MessagePriority.HIGH,
      timestamp: input.timestamp,
      sequenceNumber: input.sequenceNumber,
      data: {
        playerId,
        inputSequence: input.sequenceNumber,
        timestamp: input.timestamp,
        keys: {
          forward: input.inputState.forward,
          backward: input.inputState.backward,
          left: input.inputState.left,
          right: input.inputState.right,
          jump: input.inputState.jump,
          crouch: input.inputState.crouch
        },
        mouse: {
          deltaX: input.inputState.mouseDelta[0],
          deltaY: input.inputState.mouseDelta[1]
        }
      }
    };
  }

  createNetworkActionMessage(playerId: string, action: string, position?: [number, number, number], direction?: [number, number, number]): PlayerActionMessage {
    return {
      type: MessageType.PLAYER_ACTION,
      priority: MessagePriority.HIGH,
      timestamp: Date.now(),
      sequenceNumber: ++this.inputSequence,
      data: {
        playerId,
        action: action as any,
        timestamp: Date.now(),
        position,
        direction
      }
    };
  }

  // Input Buffer Management
  getInputBySequence(sequenceNumber: number): BufferedInput | null {
    return this.inputBuffer.find(input => input.sequenceNumber === sequenceNumber) || null;
  }

  getInputsAfterSequence(sequenceNumber: number): BufferedInput[] {
    return this.inputBuffer.filter(input => input.sequenceNumber > sequenceNumber);
  }

  getRecentInputs(maxAge: number = 500): BufferedInput[] {
    const cutoff = Date.now() - maxAge;
    return this.inputBuffer.filter(input => input.timestamp > cutoff);
  }

  clearOldInputs(maxAge: number = 2000): void {
    const cutoff = Date.now() - maxAge;
    this.inputBuffer = this.inputBuffer.filter(input => input.timestamp > cutoff);
  }
  // Utility Methods
  private isUIElement(element: HTMLElement): boolean {
    // Check if element is a button
    if (element.tagName === 'BUTTON') {
      return true;
    }
    
    // Check if element has UI-related classes
    if (element.classList.contains('bind-button') || 
        element.classList.contains('ui-button') ||
        element.classList.contains('menu-button')) {
      return true;
    }
    
    // Check if element is within specific UI containers
    const uiContainers = [
      'main-menu',
      'manualSignalingUI', 
      'chat-ui',
      'settings-panel',
      'ui-panel'
    ];
    
    for (const containerId of uiContainers) {
      const container = document.getElementById(containerId);
      if (container && container.contains(element)) {
        return true;
      }
    }
    
    // Check if element is an input field
    if (element.tagName === 'INPUT' || 
        element.tagName === 'TEXTAREA' || 
        element.tagName === 'SELECT') {
      return true;
    }
    
    return false;
  }

  private createEmptyInputState(): InputState {
    return {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      crouch: false,
      attack: false,
      block: false,
      interact: false,
      reload: false,
      aim: false,
      mouseDelta: vec2.create(),
      mouseButtons: {
        left: false,
        right: false,
        middle: false
      }
    };
  }

  private cloneInputState(input: InputState): InputState {
    return {
      forward: input.forward,
      backward: input.backward,
      left: input.left,
      right: input.right,
      jump: input.jump,
      crouch: input.crouch,
      attack: input.attack,
      block: input.block,
      interact: input.interact,
      reload: input.reload,
      aim: input.aim,
      mouseDelta: vec2.clone(input.mouseDelta),
      mouseButtons: {
        left: input.mouseButtons.left,
        right: input.mouseButtons.right,
        middle: input.mouseButtons.middle
      }
    };
  }

  // Mouse and Settings
  requestMouseLock(): void {
    if (!this.mouseLocked) {
      document.body.requestPointerLock();
    }
  }

  releaseMouse(): void {
    if (this.mouseLocked) {
      document.exitPointerLock();
    }
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }

  // Configuration
  setKeyBinding(key: string, action: keyof InputState): void {
    this.keyBindings.set(key, action);
  }

  setMouseSensitivity(sensitivity: number): void {
    this.mouseSensitivity = Math.max(0.1, Math.min(5.0, sensitivity));
  }

  setMouseInverted(inverted: boolean): void {
    this.mouseInverted = inverted;
  }

  // State Queries
  isKeyPressed(action: keyof InputState): boolean {
    return !!(this.currentInput as any)[action];
  }

  getMouseDelta(): vec2 {
    return vec2.clone(this.currentInput.mouseDelta);
  }

  isMouseLocked(): boolean {
    return this.mouseLocked;
  }

  getCurrentInputState(): InputState {
    return this.cloneInputState(this.currentInput);
  }

  // Performance and Debug Info
  getInputStats() {
    return {
      inputsProcessed: this.inputsProcessed,
      bufferSize: this.inputBuffer.length,
      averageInputRate: this.averageInputRate,
      currentSequence: this.inputSequence,
      mouseLocked: this.mouseLocked
    };
  }

  // Event Callbacks
  onInput(callback: (input: BufferedInput) => void): void {
    this.onInputCallback = callback;
  }
  onAction(callback: (action: string, position?: [number, number, number]) => void): void {
    this.onActionCallback = callback;
  }

  onChatOpen(callback: () => void): void {
    this.onChatOpenCallback = callback;
  }

  // Cleanup
  destroy(): void {
    // Remove all event listeners - in a real implementation, you'd want to track these
    // For now, since we're using global document listeners, they'll persist
    this.inputBuffer.length = 0;
    this.onInputCallback = undefined;
    this.onActionCallback = undefined;
  }
}
