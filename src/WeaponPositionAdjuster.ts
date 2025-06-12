import { quat, vec3 } from 'gl-matrix';
import { WeaponPositionConfigs } from './components/WeaponComponent';
import { getConfig } from './Config';

/**
 * A utility class to help adjust weapon positions in-game.
 * This makes it easier to tweak weapon positions and rotations in real-time.
 */
export class WeaponPositionAdjuster {
  private static instance: WeaponPositionAdjuster;  private isActive = false;
  private currentWeaponType: string = 'DEFAULT';
  private adjustmentMode: 'position' | 'restRotation' | 'attackStartRotation' | 'attackEndRotation' | 'scale' = 'position';
  private adjustmentAmount = 1.0;
  private helpText: HTMLElement | null = null;
  private keyBindString: string = 'J'; // Default key
  
  private constructor() {
    // Private constructor for singleton
  }
  
  /**
   * Get the singleton instance
   */
  public static getInstance(): WeaponPositionAdjuster {
    if (!WeaponPositionAdjuster.instance) {
      WeaponPositionAdjuster.instance = new WeaponPositionAdjuster();
    }
    return WeaponPositionAdjuster.instance;
  }
    /**
   * Initialize the adjuster
   */  public init(adjustWeaponKey?: string): void {
    // Create help text element
    this.createHelpText();
    
    // Update keybinding string if provided
    if (adjustWeaponKey) {
      this.updateKeyBindString(adjustWeaponKey);
    }
      // Add keyboard event listeners - use capture phase to get key events before the game
    document.addEventListener('keydown', this.handleKeyDown.bind(this), true);
  }
  /**
   * Toggle the weapon position adjuster mode
   */  public toggle(weaponType?: string): void {
    this.isActive = !this.isActive;
    
    if (this.isActive) {
      if (weaponType) {
        this.currentWeaponType = weaponType;
      }
      this.showHelp();
      
      // Flash the help text to make it more noticeable
      if (this.helpText) {
        const originalBg = this.helpText.style.backgroundColor;
        this.helpText.style.backgroundColor = 'rgba(255, 255, 0, 0.5)';
        const uiConfig = getConfig().getUIConfig();
        setTimeout(() => {
          if (this.helpText) {
            this.helpText.style.backgroundColor = originalBg;
          }
        }, uiConfig.weaponAdjusterFlashDuration);
      }
    } else {
      this.hideHelp();
    }
  }
  
  /**
   * Set the current weapon type to adjust
   */  public setWeaponType(weaponType: string): void {
    if (WeaponPositionConfigs[weaponType]) {
      this.currentWeaponType = weaponType;
    }
  }
  /**
   * Handle keyboard input for adjustments
   */  private handleKeyDown(event: KeyboardEvent): void {
    // Always log the key when Alt is pressed for debugging
    if (event.altKey) {
    }
    
    if (!this.isActive) return;
    
    // Only process when holding Alt key to avoid conflicts with game controls
    if (!event.altKey) return;
    
    const config = WeaponPositionConfigs[this.currentWeaponType];
    if (!config) return;
    
    // Switch adjustment mode
    switch (event.code) {
      case 'Digit1':
        this.adjustmentMode = 'position';
        break;
      case 'Digit2':
        this.adjustmentMode = 'restRotation';
        break;
      case 'Digit3':
        this.adjustmentMode = 'attackStartRotation';
        break;
      case 'Digit4':
        this.adjustmentMode = 'attackEndRotation';
        break;
      case 'Digit5':
        this.adjustmentMode = 'scale';
        break;
    }
    
    // Adjust values
    const amount = event.shiftKey ? 5.0 : 1.0;
    const smallAmount = event.shiftKey ? 0.1 : 0.01;
    
    switch (event.code) {
      case 'KeyX':
        this.adjustValue(0, amount);
        break;
      case 'KeyY':
        this.adjustValue(1, amount);
        break;
      case 'KeyZ':
        this.adjustValue(2, amount);
        break;
      case 'ArrowRight':
        this.adjustValue(0, amount);
        break;
      case 'ArrowLeft':
        this.adjustValue(0, -amount);
        break;
      case 'ArrowUp':
        this.adjustValue(1, amount);
        break;
      case 'ArrowDown':
        this.adjustValue(1, -amount);
        break;
      case 'PageUp':
        this.adjustValue(2, amount);
        break;
      case 'PageDown':
        this.adjustValue(2, -amount);
        break;      case 'Equal': // +
        if (this.adjustmentMode === 'scale') {
          config.scale = (config.scale || 1.0) + smallAmount;
          this.updatePlayer();
        }
        break;
      case 'Minus': // -
        if (this.adjustmentMode === 'scale') {
          config.scale = Math.max(0.1, (config.scale || 1.0) - smallAmount);
          this.updatePlayer();
        }
        break;
      case 'KeyP':
        // Print current config for copying into code
        this.printCurrentConfig();
        break;
      case 'KeyR':
        // Reset current adjustment
        this.resetCurrentAdjustment();
        break;
    }
      // Prevent default action and stop propagation if we handled the key
    if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 
         'KeyX', 'KeyY', 'KeyZ', 
         'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown',
         'PageUp', 'PageDown', 'Equal', 'Minus', 'KeyP', 'KeyR'].includes(event.code)) {
      event.preventDefault();
      event.stopPropagation();
      
      // Update the UI to show the current values
      this.updateHelpTextWithCurrentValues();
    }
  }
  
  /**
   * Adjust a value in the current adjustment mode
   */
  private adjustValue(index: number, amount: number): void {
    const config = WeaponPositionConfigs[this.currentWeaponType];
    if (!config) return;
      switch (this.adjustmentMode) {
      case 'position':
        config.position[index] += amount * 0.01;
        break;
      case 'restRotation':
        config.restRotation[index] += amount;
        break;
      case 'attackStartRotation':
        config.attackStartRotation[index] += amount;
        break;
      case 'attackEndRotation':
        config.attackEndRotation[index] += amount;
        break;
    }
    
    // Apply changes immediately to player
    this.updatePlayer();
  }
  
  /**
   * Reset the current adjustment to default values
   */
  private resetCurrentAdjustment(): void {
    const config = WeaponPositionConfigs[this.currentWeaponType];
    if (!config) return;
    
    const defaultConfig = WeaponPositionConfigs.DEFAULT;
    
    switch (this.adjustmentMode) {
      case 'position':
        config.position = [...defaultConfig.position];
        break;
      case 'restRotation':
        config.restRotation = [...defaultConfig.restRotation];
        break;
      case 'attackStartRotation':
        config.attackStartRotation = [...defaultConfig.attackStartRotation];
        break;
      case 'attackEndRotation':
        config.attackEndRotation = [...defaultConfig.attackEndRotation];
        break;      case 'scale':
        config.scale = defaultConfig.scale || 1.0;
        break;
    }
    
    this.updatePlayer();
  }
  
  /**
   * Update the player's weapon with the current configuration
   */
  private updatePlayer(): void {
    const player = globalThis.player;
    if (player && player.weapon) {
      // Access the applyWeaponPositionConfig method on the WeaponComponent
      if (player.weapon && 'applyWeaponPositionConfig' in player.weapon) {
        (player.weapon as any).applyWeaponPositionConfig(this.currentWeaponType);
      }
    }
  }
    /**
   * Print the current weapon configuration to console
   */
  private printCurrentConfig(): void {
    const config = WeaponPositionConfigs[this.currentWeaponType];
    if (!config) return;
    
    console.log(`\nConfiguration for ${this.currentWeaponType}:`);
    
    // Format as code that can be directly pasted into the source
    const formattedConfig = `  ${this.currentWeaponType}: {
    position: [${config.position[0].toFixed(2)}, ${config.position[1].toFixed(2)}, ${config.position[2].toFixed(2)}],
    restRotation: [${config.restRotation[0].toFixed(0)}, ${config.restRotation[1].toFixed(0)}, ${config.restRotation[2].toFixed(0)}],
    attackStartRotation: [${config.attackStartRotation[0].toFixed(0)}, ${config.attackStartRotation[1].toFixed(0)}, ${config.attackStartRotation[2].toFixed(0)}],
    attackEndRotation: [${config.attackEndRotation[0].toFixed(0)}, ${config.attackEndRotation[1].toFixed(0)}, ${config.attackEndRotation[2].toFixed(0)}],
    scale: ${(config.scale || 1.0).toFixed(2)}
  },`;
    
    console.log(formattedConfig);
    console.log('\nCopy the above into the WeaponPositionConfigs object in components/WeaponComponent.ts');
    
    // Also provide HTML element to make copying easier
    const copyHelper = document.createElement('textarea');
    copyHelper.style.position = 'fixed';
    copyHelper.style.left = '0';
    copyHelper.style.top = '0';
    copyHelper.style.width = '1px';
    copyHelper.style.height = '1px';
    copyHelper.style.opacity = '0';
    copyHelper.value = formattedConfig;
    document.body.appendChild(copyHelper);
    copyHelper.select();
    document.execCommand('copy');
    document.body.removeChild(copyHelper);
    
    console.log('✅ Configuration has been copied to clipboard!');
  }
  
  /**
   * Create and setup help text element
   */
  private createHelpText(): void {
    if (this.helpText) return;
    
    this.helpText = document.createElement('div');
    this.helpText.style.position = 'fixed';
    this.helpText.style.bottom = '10px';
    this.helpText.style.left = '10px';
    this.helpText.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    this.helpText.style.color = '#FFFFFF';
    this.helpText.style.padding = '10px';
    this.helpText.style.borderRadius = '5px';
    this.helpText.style.fontFamily = 'monospace';
    this.helpText.style.zIndex = '1000';
    this.helpText.style.display = 'none';
    
    document.body.appendChild(this.helpText);
  }
  /**
   * Show the help text
   */
  private showHelp(): void {
    if (!this.helpText) return;
    
    this.helpText.innerHTML = `      <h3>Weapon Position Adjuster</h3>
      <p>Currently adjusting: <strong>${this.currentWeaponType}</strong></p>
      <p style="color: #ff0; font-weight: bold;">Activation: Press ${this.keyBindString} to toggle.</p>
      <p>Hold ALT key + use the following:</p>
      <ul>
        <li>1-5: Switch adjustment mode (Position, Resting, Attack Start, Attack End, Scale)</li>
        <li>Arrow keys: Adjust X/Y</li>
        <li>Page Up/Down: Adjust Z</li>
        <li>+/-: Adjust scale (when in scale mode)</li>
        <li>P: Print current config to console</li>
        <li>R: Reset current adjustment</li>
      </ul>
      <p>Hold SHIFT for larger adjustments</p>
      <div id="current-values" style="margin-top: 10px; padding: 5px; background: rgba(0,0,0,0.3); border-radius: 3px;">
        <p>Current values will appear here when adjusting</p>
      </div>
    `;
    
    this.helpText.style.display = 'block';
    this.updateHelpTextWithCurrentValues();
  }
  
  /**
   * Update the help text with current values
   */
  private updateHelpTextWithCurrentValues(): void {
    if (!this.helpText) return;
    
    const config = WeaponPositionConfigs[this.currentWeaponType];
    if (!config) return;
    
    const valuesDiv = this.helpText.querySelector('#current-values');
    if (!valuesDiv) return;
    
    let valuesHtml = `<p>Mode: <strong>${this.adjustmentMode}</strong></p>`;
    
    switch (this.adjustmentMode) {
      case 'position':
        valuesHtml += `<p>Position: [${config.position[0].toFixed(2)}, ${config.position[1].toFixed(2)}, ${config.position[2].toFixed(2)}]</p>`;
        break;
      case 'restRotation':
        valuesHtml += `<p>Rest Rotation: [${config.restRotation[0].toFixed(0)}, ${config.restRotation[1].toFixed(0)}, ${config.restRotation[2].toFixed(0)}]</p>`;
        break;
      case 'attackStartRotation':
        valuesHtml += `<p>Attack Start: [${config.attackStartRotation[0].toFixed(0)}, ${config.attackStartRotation[1].toFixed(0)}, ${config.attackStartRotation[2].toFixed(0)}]</p>`;
        break;
      case 'attackEndRotation':
        valuesHtml += `<p>Attack End: [${config.attackEndRotation[0].toFixed(0)}, ${config.attackEndRotation[1].toFixed(0)}, ${config.attackEndRotation[2].toFixed(0)}]</p>`;
        break;
      case 'scale':
        valuesHtml += `<p>Scale: ${(config.scale || 1.0).toFixed(2)}</p>`;
        break;
    }
    
    valuesDiv.innerHTML = valuesHtml;
  }
  
  /**
   * Hide the help text
   */
  private hideHelp(): void {
    if (!this.helpText) return;
    this.helpText.style.display = 'none';
  }
  
  /**
   * Update the key binding string from settings
   */
  public updateKeyBindString(keyCode: string): void {
    // Convert key codes to friendly names for display
    if (keyCode.startsWith('Key')) {
      this.keyBindString = keyCode.replace('Key', '');
    } else if (keyCode === 'Space') {
      this.keyBindString = 'Spacebar';
    } else if (keyCode.startsWith('Mouse')) {
      const buttonNum = keyCode.replace('Mouse', '');
      switch (buttonNum) {
        case '0': this.keyBindString = 'Left Click'; break;
        case '1': this.keyBindString = 'Middle Click'; break;
        case '2': this.keyBindString = 'Right Click'; break;
        default: this.keyBindString = `Mouse Button ${buttonNum}`; break;
      }
    } else {
      this.keyBindString = keyCode;
    }
  }
}

// Export a global function to toggle the adjuster
export function toggleWeaponAdjuster(weaponType?: string): void {
  const adjuster = WeaponPositionAdjuster.getInstance();
  adjuster.toggle(weaponType);
  
  // Get UI config for timing
  const uiConfig = getConfig().getUIConfig();
  
  // Add a visual indicator that adjuster was toggled
  const flashElement = document.createElement('div');
  flashElement.style.position = 'fixed';
  flashElement.style.top = '0';
  flashElement.style.left = '0';
  flashElement.style.width = '100%';
  flashElement.style.height = '100%';
  flashElement.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
  flashElement.style.pointerEvents = 'none';
  flashElement.style.zIndex = '9999';
  flashElement.style.transition = 'opacity 0.5s ease-out';
  document.body.appendChild(flashElement);
  
  // Fade out the flash using config timing
  setTimeout(() => {
    flashElement.style.opacity = '0';
    setTimeout(() => {
      document.body.removeChild(flashElement);
    }, uiConfig.weaponAdjusterFlashDuration);
  }, uiConfig.weaponAdjusterFlashDelay);
}
