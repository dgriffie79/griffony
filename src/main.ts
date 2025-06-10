import { mat4, quat, vec3 } from 'gl-matrix';
import { Entity, PhysicsLayer } from './Entity.js';
import { Camera } from './Camera.js';
import { Player } from './Player.js';
import { Model } from './Model.js';
import { Tileset } from './Tileset.js';
import { Level } from './Level.js';
import { Renderer } from './Renderer.js';
import { Net } from './Net.js';
import { combatSystem } from './CombatSystem.js';
import { physicsSystem } from './PhysicsSystem.js';
import { getConfig } from './Config.js';
import { WeaponConfigs } from './Weapon.js';
import { greedyMesh } from './utils.js';
import type { GameSettings, GameState } from './types/index.js';
import { MessageType } from './types/index.js';
import { TriggerVolume, TriggerShape } from './TriggerVolume.js';
import { WeaponPositionAdjuster, toggleWeaponAdjuster } from './WeaponPositionAdjuster.js';
import { MeshStats } from './MeshStats.js';
import { errorHandler, ValidationError, Result } from './ErrorHandler.js';
import { AutoCleanup } from './ResourceManager.js';
import { ManualSignalingUI } from './ManualSignalingUI.js';
import { ChatUI } from './ChatUI.js';
import { InputManager } from './InputManager.js';
import { MultiplayerManager } from './MultiplayerManager.js';
import { LocalPlayerController } from './PlayerController.js';
import { PlayerEntity } from './PlayerEntity.js';
import { gameResources } from './GameResources.js';

// Global game state
let lastTime = 0;
let timeLabel: HTMLDivElement;
let useGreedyMesh = false; // Toggle for testing greedy mesh vs original algorithm
let physicsStarted = false; // Track when physics starts for the first time

let settings: GameSettings = {
	version: 1,
	invertMouse: true,
	useGreedyMesh: false,
	keybinds: {
		forward: 'KeyW',
		backward: 'KeyS',
		left: 'KeyA',
		right: 'KeyD',
		up: 'KeyE',
		down: 'KeyQ',
		jump: 'Space', respawn: 'KeyR',
		godMode: 'KeyG',
		attack: 'Mouse0',
		block: 'Mouse2',
		switchWeapon: 'KeyX',
		toggleMesh: 'KeyM',
		adjustWeapon: 'KeyJ', // New keybind for weapon position adjuster
	}
};

const key_states = new Set<string>();

let mouseMoveX = 0;
let mouseMoveY = 0;
let showingMenu = false;
let godMode = true;

// Make godMode available to the physics system
(globalThis as any).godMode = godMode;

// Game objects
const modelNames = [
	'player',
	'portal',
	'fatta',
	'fattb',
	'fattc',
	'fattd',
	'maze',
	'wall',
	'box_frame',
	'sword',
	'axe',
	'hammer',
	//'spawn'
];

const models: Model[] = modelNames.map((model) => new Model(`/models/${model}.vox`));

const tileset = new Tileset('/tilesets/dcss_tiles.tsj');
const level = new Level('/maps/test.tmj');
// Player will be created in main() after modelNames is initialized
let player: Player; // Declare but don't initialize yet
const renderer = new Renderer();
const net = new Net();
const camera = new Camera();
const inputManager = InputManager.getInstance();
const chatUI = new ChatUI(net);
const multiplayerManager = new MultiplayerManager(net);

// Make global references available for legacy compatibility
declare global {
	var models: Model[];
	var modelNames: string[];
	var tileset: Tileset;
	var level: Level;
	var player: Player;
	var renderer: Renderer;
	var net: Net;
	var camera: Camera;
	var inputManager: InputManager;
	var chatUI: ChatUI;
	var Entity: typeof Entity;
	var greedyMesh: any; // Will be defined later in the file
	var physicsSystem: any; // Use 'any' to avoid circular reference
	var useGreedyMesh: boolean;
}

// Initialize only non-model globals immediately
// Models, modelNames, and player will be assigned after initialization
globalThis.tileset = tileset;
globalThis.level = level;
// globalThis.player will be assigned in main() after creation
globalThis.renderer = renderer;
globalThis.net = net;
globalThis.camera = camera;
globalThis.inputManager = inputManager;
globalThis.chatUI = chatUI;
globalThis.Entity = Entity;
globalThis.greedyMesh = greedyMesh;
globalThis.physicsSystem = physicsSystem;
globalThis.useGreedyMesh = useGreedyMesh;

// Setup chat and input integration
function setupChatSystem(): void {
	// Connect input manager to chat UI
	inputManager.onChatOpen(() => {
		// Don't open chat if we're in the menu or during signaling
		if (showingMenu) {
			return;
		}

		if (!chatUI.isOpenForInput()) {
			chatUI.open();
		}
	});

	// Connect network to chat UI
	net.onChatMessage((playerName: string, message: string, timestamp: number) => {
		chatUI.addMessage(playerName, message, timestamp);
	});

	console.log('Chat system initialized');
}

// Initialize the chat system
setupChatSystem();

function triggerAttackFlash(): void {
	const flash = document.getElementById('attack-flash');
	if (flash) {
		flash.style.backgroundColor = 'rgba(255, 68, 68, 0.2)';
		setTimeout(() => {
			flash.style.backgroundColor = 'rgba(255, 68, 68, 0)';
		}, 100);
	}
}

function playAttackSound(): void {
	try {
		const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
		const oscillator = audioContext.createOscillator();
		const gainNode = audioContext.createGain();

		oscillator.connect(gainNode);
		gainNode.connect(audioContext.destination);

		// Quick metallic sound effect
		const audioConfig = getConfig().getAudioConfig();
		oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
		oscillator.frequency.exponentialRampToValueAtTime(audioConfig.attackSoundFrequency.end, audioContext.currentTime + audioConfig.attackSoundFrequency.duration);

		gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
		gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + audioConfig.attackSoundFrequency.duration);

		oscillator.start(audioContext.currentTime);
		oscillator.stop(audioContext.currentTime + audioConfig.attackSoundFrequency.duration);
	} catch (e) {
		// Fallback if Web Audio API fails
		console.log('⚔️ ATTACK!');
	}
}

function playHitSound(): void {
	try {
		const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
		const oscillator = audioContext.createOscillator();
		const gainNode = audioContext.createGain();

		oscillator.connect(gainNode);
		gainNode.connect(audioContext.destination);

		// Impact sound effect
		const audioConfig = getConfig().getAudioConfig();
		oscillator.frequency.setValueAtTime(audioConfig.hitSoundFrequency.start, audioContext.currentTime);
		oscillator.frequency.exponentialRampToValueAtTime(audioConfig.hitSoundFrequency.end, audioContext.currentTime + audioConfig.hitSoundFrequency.duration);

		gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
		gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + audioConfig.hitSoundFrequency.duration);
		oscillator.start(audioContext.currentTime);
		oscillator.stop(audioContext.currentTime + audioConfig.hitSoundFrequency.duration);
	} catch (e) {
		// Fallback if Web Audio API fails
		console.log('💥 HIT!');
	}
}

// Make functions available globally for combat system
(globalThis as any).triggerAttackFlash = triggerAttackFlash;
(globalThis as any).playAttackSound = playAttackSound;
(globalThis as any).playHitSound = playHitSound;

/**
 * Safely load data from localStorage with error handling
 */
function safeLoadFromStorage<T>(key: string, defaultValue: T): Result<T> {
	return errorHandler.safe(() => {
		const item = localStorage.getItem(key);
		if (!item) {
			return defaultValue;
		}

		const parsed = JSON.parse(item) as T;
		return parsed;
	}, `loadFromStorage:${key}`);
}

/**
 * Safely save data to localStorage with error handling
 */
function safeSaveToStorage<T>(key: string, data: T): Result<void> {
	return errorHandler.safe(() => {
		const serialized = JSON.stringify(data);
		localStorage.setItem(key, serialized);
	}, `saveToStorage:${key}`);
}

/**
 * Load game settings with validation and error handling
 */
function loadGameSettings(): GameSettings {
	const loadResult = safeLoadFromStorage<GameSettings | null>('gameSettings', null);

	if (!loadResult.success) {
		console.warn(`Failed to load settings: ${loadResult.error.message}, using defaults`);
		return settings;
	}

	const savedSettings = loadResult.data;
	if (!savedSettings) {
		console.log('No saved settings found, using defaults');
		return settings;
	}

	// Validate settings structure and version
	if (typeof savedSettings !== 'object' || savedSettings.version !== settings.version) {
		console.warn('Invalid or outdated settings format, using defaults');
		// Save current defaults to replace invalid settings
		const saveResult = safeSaveToStorage('gameSettings', settings);
		if (!saveResult.success) {
			console.error(`Failed to save default settings: ${saveResult.error.message}`);
		}
		return settings;
	}
	// Validate required fields
	if (!savedSettings.keybinds || typeof savedSettings.keybinds !== 'object') {
		console.warn('Settings missing keybinds, using defaults');
		return settings;
	}

	console.log('Successfully loaded settings from storage');
	return savedSettings as GameSettings;
}

/**
 * Load game state with validation and error handling
 */
function loadGameState(): GameState | null {
	const loadResult = safeLoadFromStorage<GameState | null>('gameState', null);

	if (!loadResult.success) {
		console.warn(`Failed to load game state: ${loadResult.error.message}`);
		return null;
	}

	const savedState = loadResult.data;
	if (!savedState) {
		console.log('No saved game state found');
		return null;
	}

	// Validate state structure
	if (typeof savedState !== 'object' ||
		!Array.isArray(savedState.playerPos) ||
		!Array.isArray(savedState.playerOrientation) ||
		!Array.isArray(savedState.playerHeadRotation)) {
		console.warn('Invalid game state format, ignoring saved state');
		return null;
	}

	console.log('Successfully loaded game state from storage');
	return savedState as GameState;
}

/**
 * Initialize keybind buttons with current settings
 */
function initializeKeybindButtons(): void {
	for (const button of document.getElementsByClassName('bind-button')) {
		const bindButton = button as HTMLButtonElement;
		const binding = settings.keybinds[bindButton.id as keyof typeof settings.keybinds];
		bindButton.textContent = binding || '';
	}
}

/**
 * Initialize settings UI elements (checkboxes, etc.)
 */
function initializeSettingsUI(): void {
	const invertMouseCheckbox = document.getElementById('invert-mouse') as HTMLInputElement;
	if (invertMouseCheckbox) {
		invertMouseCheckbox.checked = settings.invertMouse;
	}
}

/**
 * Map mouse button number to consistent string naming
 */
function mapMouseButtonToString(buttonNumber: number): string {
	switch (buttonNumber) {
		case 0: return 'Mouse0'; // Left click
		case 1: return 'Mouse1'; // Middle click
		case 2: return 'Mouse2'; // Right click
		case 3: return 'Mouse3'; // Back button
		case 4: return 'Mouse4'; // Forward button
		default: return `Mouse${buttonNumber}`;
	}
}

/**
 * Update keybinding and save to localStorage
 */
function updateKeybinding(bindingId: string, newValue: string): void {
	// Check if this key is already bound to another action
	const existingBinding = Object.entries(settings.keybinds).find(([key, value]) =>
		value === newValue && key !== bindingId
	);

	if (existingBinding) {
		// Clear the old binding
		const [oldActionKey] = existingBinding;
		settings.keybinds[oldActionKey as keyof typeof settings.keybinds] = '';

		// Update the UI for the old binding
		const oldButton = document.getElementById(oldActionKey) as HTMLButtonElement;
		if (oldButton) {
			oldButton.textContent = '';
		}
	}

	// Update the new binding
	settings.keybinds[bindingId as keyof typeof settings.keybinds] = newValue;
	const saveResult = safeSaveToStorage('gameSettings', settings);
	if (!saveResult.success) {
		console.error(`Failed to save settings after keybind update: ${saveResult.error.message}`);
	}

	// Update weapon position adjuster if this is the adjustWeapon keybinding
	if (bindingId === 'adjustWeapon') {
		WeaponPositionAdjuster.getInstance().updateKeyBindString(newValue);
	}
}

/**
 * Setup keybinding listeners for the menu
 */
function setupKeybindingListeners(): void {
	const menu = document.getElementById('main-menu');
	if (!menu) return;

	let activeBinding: HTMLButtonElement | null = null;
	let bindingJustCompleted = false;

	// Keyboard event for keybinding
	menu.addEventListener('keydown', (event) => {
		event.stopPropagation();
		if (!activeBinding) return;

		const button = document.getElementById(activeBinding.id) as HTMLButtonElement;
		if (button) {
			button.textContent = event.code;
			button.classList.remove('listening');
		}

		updateKeybinding(activeBinding.id, event.code);
		activeBinding = null;
		bindingJustCompleted = true;
		event.preventDefault();
	});

	// Mouse event for keybinding
	menu.addEventListener('mousedown', (event) => {
		event.stopPropagation();
		if (!activeBinding) return;

		const mouseButton = mapMouseButtonToString(event.button);
		const button = document.getElementById(activeBinding.id) as HTMLButtonElement;
		if (button) {
			button.textContent = mouseButton;
			button.classList.remove('listening');
		}

		updateKeybinding(activeBinding.id, mouseButton);
		activeBinding = null;
		bindingJustCompleted = true;
		event.preventDefault();
	});

	// Handle keyup to prevent re-activation
	menu.addEventListener('keyup', (event) => {
		event.stopPropagation();
		if (activeBinding) {
			event.preventDefault();
		}

		if (bindingJustCompleted) {
			bindingJustCompleted = false;
			event.preventDefault();
			return;
		}
	});

	// Handle blur to reset binding state
	menu.addEventListener('blur', (event) => {
		if (activeBinding && event.target === activeBinding) {
			const currentBinding = settings.keybinds[activeBinding.id as keyof typeof settings.keybinds];
			activeBinding.textContent = currentBinding || '';
			activeBinding.classList.remove('listening');
			activeBinding = null;
		}
	}, true);

	// Handle menu button clicks
	menu.addEventListener('click', (event) => {
		event.stopPropagation();

		if (bindingJustCompleted) {
			bindingJustCompleted = false;
			return;
		}

		const button = event.target as HTMLButtonElement;
		if (button.classList?.contains('bind-button')) {
			activeBinding = button;
			activeBinding.classList.add('listening');
			return;
		}

		handleMenuButtonClick(button.id);
	});

	if (showingMenu) {
		menu.hidden = false;
	}
}

/**
 * Handle menu button clicks (close, host, join)
 */
function handleMenuButtonClick(buttonId: string): void {
	const menu = document.getElementById('main-menu');
	if (!menu) return;
	switch (buttonId) {
		case 'close-menu':
			showingMenu = false;
			menu.hidden = true;
			break;
		case 'host':
			// Show host signaling flow
			showManualSignalingUI(true);
			break;
		case 'join':
			// Show join signaling flow
			showManualSignalingUI(false);
			break;
	}
}

/**
 * Show the manual signaling UI for multiplayer connection
 */
function showManualSignalingUI(isHost: boolean): void {
	// Hide the main menu temporarily
	const menu = document.getElementById('main-menu');
	if (menu) {
		menu.hidden = true;
	}	// Create and show the manual signaling UI
	const signalingUI = new ManualSignalingUI(net, multiplayerManager);
	signalingUI.onComplete(() => {
		console.log('Connection established successfully');
		showingMenu = false;
		// Request pointer lock to resume game
		setTimeout(() => document.body.requestPointerLock(), getConfig().getUIConfig().pointerLockDelay);
	});

	signalingUI.onError((error) => {
		console.error('Connection failed:', error);
		// Show the main menu again
		if (menu) {
			menu.hidden = false;
		}
	});

	// Start the appropriate signaling flow
	if (isHost) {
		signalingUI.showHostFlow();
	} else {
		signalingUI.showJoinFlow();
	}
}

/**
 * Setup global document event listeners
 */
function setupGlobalEventListeners(): void {
	// Core input listeners
	document.addEventListener('keydown', onKeydown);
	document.addEventListener('keyup', (event) => {
		key_states.delete(event.code);
	});

	document.addEventListener('mousemove', (event) => {
		if (document.pointerLockElement) {
			mouseMoveX += event.movementX;
			mouseMoveY += event.movementY;
		}
	});	// Menu toggle and pointer lock management
	document.addEventListener('click', (event) => {
		const target = event.target as HTMLElement;
		// Debug logging
		console.log(`Click detected on element: ${target.tagName}, id: ${target.id}, class: ${target.className}`);

		if (target instanceof HTMLButtonElement && target.id === 'toggle-menu') {
			showingMenu = !showingMenu;
			const mainMenu = document.getElementById('main-menu');
			if (mainMenu) {
				mainMenu.hidden = !showingMenu;
			}
			if (showingMenu) {
				document.exitPointerLock();
			} else {
				document.body.requestPointerLock();
			}
			return;
		}
		// Don't request pointer lock if clicking within the signaling UI
		const signalingUI = document.getElementById('manualSignalingUI');
		if (signalingUI && signalingUI.contains(target)) {
			console.log('Click within signaling UI, not requesting pointer lock');
			return;
		}

		// Don't request pointer lock if clicking within the chat UI
		const chatUI = document.getElementById('chat-ui');
		if (chatUI && chatUI.contains(target)) {
			console.log('Click within chat UI, not requesting pointer lock');
			return;
		}		// Don't request pointer lock if showing menu
		if (showingMenu) {
			console.log('Menu is showing, not requesting pointer lock');
			showingMenu = false;
			const mainMenu = document.getElementById('main-menu');
			if (mainMenu) {
				mainMenu.hidden = true;
			}
			return;
		}
		// Don't request pointer lock if clicking on UI elements
		if (target.tagName === 'BUTTON' ||
			target.classList.contains('bind-button') ||
			target.classList.contains('ui-button') ||
			target.tagName === 'INPUT' ||
			target.tagName === 'TEXTAREA' ||
			target.tagName === 'SELECT') {
			console.log('Click on UI element, not requesting pointer lock');
			return;
		}

		// Request pointer lock for valid game area clicks
		console.log('Requesting pointer lock for game area click');
		document.body.requestPointerLock();
	});

	document.addEventListener('visibilitychange', () => {
		lastTime = performance.now();
	});
}

/**
 * Setup mouse input handlers for combat
 */
function setupMouseInputHandlers(): void {
	document.addEventListener('mousedown', (event) => {
		if (!document.pointerLockElement || showingMenu) return;
		const mouseButton = mapMouseButtonToString(event.button);
		key_states.add(mouseButton);
	});

	document.addEventListener('mouseup', (event) => {
		const mouseButton = mapMouseButtonToString(event.button);
		key_states.delete(mouseButton);
	});

	document.addEventListener('contextmenu', (event) => {
		event.preventDefault();
	});

	document.addEventListener('pointerlockchange', () => {
		if (!key_states.has('`')) {
			key_states.clear();
		}
	});
}

/**
 * Create and append the time display label
 */
function createTimeLabel(): void {
	timeLabel = document.createElement('div');
	timeLabel.style.position = 'fixed';
	timeLabel.style.top = '0px';
	timeLabel.style.color = 'white';
	timeLabel.style.padding = '10px';
	timeLabel.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
	timeLabel.style.borderRadius = '5px';
	timeLabel.style.fontFamily = 'monospace';
	timeLabel.style.fontSize = '14px';
	timeLabel.style.lineHeight = '1.4';
	document.body.appendChild(timeLabel);
}

/**
 * Create and append the crosshair element
 */
function createCrosshair(): void {
	const crosshair = document.createElement('div');
	crosshair.id = 'crosshair';
	crosshair.style.position = 'fixed';

	const uiConfig = getConfig().getUIConfig();
	crosshair.style.top = `${uiConfig.centerPosition}%`;
	crosshair.style.left = `${uiConfig.centerPosition}%`;
	crosshair.style.transform = `translate(-${uiConfig.centerPosition}%, -${uiConfig.centerPosition}%)`;
	crosshair.style.width = '20px';
	crosshair.style.height = '20px';
	crosshair.style.pointerEvents = 'none';
	crosshair.style.zIndex = '1000';

	crosshair.innerHTML = `
		<div style="position: absolute; top: ${uiConfig.centerPosition}%; left: 0; right: 0; height: 2px; background: white; transform: translateY(-${uiConfig.centerPosition}%);"></div>
		<div style="position: absolute; left: ${uiConfig.centerPosition}%; top: 0; bottom: 0; width: 2px; background: white; transform: translateX(-${uiConfig.centerPosition}%);"></div>
	`;

	document.body.appendChild(crosshair);
}

/**
 * Create and append the attack flash overlay
 */
function createAttackFlash(): void {
	const attackFlash = document.createElement('div');
	attackFlash.id = 'attack-flash';
	attackFlash.style.position = 'fixed';
	attackFlash.style.top = '0';
	attackFlash.style.left = '0';
	attackFlash.style.width = '100%';
	attackFlash.style.height = '100%';
	attackFlash.style.backgroundColor = 'rgba(255, 68, 68, 0)';
	attackFlash.style.pointerEvents = 'none';
	attackFlash.style.zIndex = '999';
	attackFlash.style.transition = 'background-color 0.1s ease-out';
	document.body.appendChild(attackFlash);
}

/**
 * Main UI setup function - coordinates all UI initialization
 */
function setupUI(): void {
	// Initialize UI components
	initializeKeybindButtons();
	initializeSettingsUI();

	// Setup event handling
	setupKeybindingListeners();
	setupGlobalEventListeners();
	setupMouseInputHandlers();

	// Create UI elements
	createTimeLabel();
	createCrosshair();
	createAttackFlash();
}

/**
 * Create a UI button for activating the weapon adjuster
 */
function onKeydown(event: KeyboardEvent): void {
	// Prevent game input when chat is open, except for 'T' and 'Escape'
	if (chatUI.isOpenForInput() && event.code !== 'KeyT' && event.code !== 'Escape') {
		return;
	}

	// Prevent chat from opening when menu is showing
	if (event.code === 'KeyT' && showingMenu) {
		return;
	}

	key_states.add(event.code);

	switch (event.code) {
		case 'Backquote': {
			showingMenu = !showingMenu;
			const mainMenu = document.getElementById('main-menu');
			if (mainMenu) {
				mainMenu.hidden = !showingMenu;
			}
			if (showingMenu) {
				document.exitPointerLock();
			} else {
				document.body.requestPointerLock();
			}
			break;
		} case 'Escape': {
			if (showingMenu) {
				showingMenu = false;
				const mainMenu = document.getElementById('main-menu');
				if (mainMenu) {
					mainMenu.hidden = true;
				}
				setTimeout(() => document.body.requestPointerLock(), getConfig().getUIConfig().pointerLockDelay);
			}
			break;
		} case settings.keybinds.godMode: {
			godMode = !godMode;
			// Synchronize with global scope for physics system
			(globalThis as any).godMode = godMode;
			console.log(`God Mode ${godMode ? 'enabled' : 'disabled'}`);
			break;
		} case settings.keybinds.respawn: {
			player.respawn();
			break;
		} case settings.keybinds.toggleMesh: {
			useGreedyMesh = !useGreedyMesh; settings.useGreedyMesh = useGreedyMesh;
			(globalThis as any).useGreedyMesh = useGreedyMesh;
			localStorage.setItem('gameSettings', JSON.stringify(settings));
			console.log(`Mesh algorithm switched to: ${useGreedyMesh ? 'Greedy Mesh' : 'Original'}`);

			// Update renderer to use new mesh type immediately
			renderer.updateMeshRenderingMode();
			console.log('Mesh rendering updated - no reload needed!');

			// Reset mesh stats when switching algorithms
			MeshStats.getInstance().reset();

			break;
		} case settings.keybinds.switchWeapon: {
			// Cycle through available weapons
			const currentWeapon = combatSystem.getWeapon(player);
			if (currentWeapon) {
				const weaponTypes = Object.keys(WeaponConfigs) as Array<keyof typeof WeaponConfigs>;
				const currentIndex = weaponTypes.findIndex(type =>
					WeaponConfigs[type].id === currentWeapon.weaponData.id
				); const nextIndex = (currentIndex + 1) % weaponTypes.length;
				combatSystem.equipWeapon(player, weaponTypes[nextIndex]);
				console.log(`Switched to ${WeaponConfigs[weaponTypes[nextIndex]].name}`);
			}
			break;
		} case settings.keybinds.adjustWeapon: {
			// Toggle the weapon position adjuster with the current weapon model
			console.log('Activating weapon position adjuster');
			const currentWeapon = combatSystem.getWeapon(player);
			if (currentWeapon) {
				toggleWeaponAdjuster(currentWeapon.weaponData.modelName);
			} else {
				toggleWeaponAdjuster();
			} break;
		}
	}
}

function processInput(elapsed: number): void {
	const right = vec3.fromValues(1, 0, 0);
	vec3.transformQuat(right, right, player.localRotation);

	const forward = vec3.fromValues(0, 1, 0);
	vec3.transformQuat(forward, forward, player.localRotation);

	const up = vec3.fromValues(0, 0, 1);
	vec3.transformQuat(up, up, player.localRotation);
	const speed = 10;

	if (!godMode) {
		// For non-god mode, movement is restricted to the horizontal plane
		forward[2] = 0;
		vec3.normalize(forward, forward);
		right[2] = 0;
		vec3.normalize(right, right);
	} else {
		player.vel[2] = 0; // Reset vertical velocity for god mode
	}

	// Reset horizontal velocity for new input
	player.vel[0] = 0;
	player.vel[1] = 0;

	// Apply movement input using the physics system
	if (key_states.has(settings.keybinds.forward)) {
		physicsSystem.applyMovement(player, forward, speed);
	}
	if (key_states.has(settings.keybinds.backward)) {
		physicsSystem.applyMovement(player, forward, -speed);
	}
	if (key_states.has(settings.keybinds.left)) {
		physicsSystem.applyMovement(player, right, -speed);
	}
	if (key_states.has(settings.keybinds.right)) {
		physicsSystem.applyMovement(player, right, speed);
	}
	if (godMode && key_states.has(settings.keybinds.up)) {
		physicsSystem.applyMovement(player, up, speed);
	}
	if (godMode && key_states.has(settings.keybinds.down)) {
		physicsSystem.applyMovement(player, up, -speed);
	}
	if (key_states.has(settings.keybinds.jump)) {
		if (!godMode) {
			physicsSystem.jump(player);
		}
		key_states.delete(settings.keybinds.jump);
	}

	// Combat inputs
	if (key_states.has(settings.keybinds.attack)) {
		// Calculate attack target position (forward from player)
		const attackRange = 3.0; // meters
		const attackTarget = vec3.create();
		vec3.scaleAndAdd(attackTarget, player.worldPosition, forward, attackRange);
		attackTarget[2] += player.height * 0.7; // Attack at chest height

		combatSystem.tryAttack(player, attackTarget);
		key_states.delete(settings.keybinds.attack); // Single attack per press
	}
	// Handle blocking (not implemented yet, but reserve the input)
	if (key_states.has(settings.keybinds.block)) {
		// TODO: Implement blocking mechanics
		// For now, just log that blocking is active
		// console.log('Blocking...');
	}

	// Mouse rotation
	const dx = mouseMoveX;
	const dy = settings.invertMouse ? -mouseMoveY : mouseMoveY;

	quat.rotateZ(player.localRotation, player.localRotation, -dx * elapsed / 1000);
	quat.rotateX(player.head.localRotation, player.head.localRotation, dy * elapsed / 1000);

	// Clamp head rotation
	const angle = quat.getAxisAngle(vec3.create(), player.head.localRotation);
	if (angle > Math.PI / 2) {
		if (dy > 0) {
			quat.setAxisAngle(player.head.localRotation, vec3.fromValues(1, 0, 0), Math.PI / 2);
		} else {
			quat.setAxisAngle(player.head.localRotation, vec3.fromValues(1, 0, 0), -Math.PI / 2);
		}
	}

	player.dirty = true;
	player.head.dirty = true;

	mouseMoveX = 0;
	mouseMoveY = 0;
}

/**
 * Perform a raycast from the player's position in the view direction
 */
function performRaycast(): void {
	if (!player || !camera.entity) return;

	// Get forward vector from camera
	const forward = vec3.fromValues(0, 1, 0);
	vec3.transformQuat(forward, forward, camera.entity.worldRotation);

	// Perform raycast
	const origin = vec3.clone(camera.entity.worldPosition);
	const result = physicsSystem.raycast(origin, forward, 20, {
		ignoreEntity: player
	});
	// Show result
	if (result.hit) {
		console.log('Raycast hit:', {
			position: [
				result.position[0].toFixed(2),
				result.position[1].toFixed(2),
				result.position[2].toFixed(2)
			],
			distance: result.distance.toFixed(2),
			entity: result.entity ? `Entity #${result.entity.id}` : 'terrain'
		});

		// Flash the crosshair red
		const crosshair = document.getElementById('crosshair');
		if (crosshair) {
			const lines = crosshair.getElementsByTagName('div');
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i] as HTMLElement;
				line.style.background = '#FF0000';
				setTimeout(() => line.style.background = '#FFFFFF', getConfig().getUIConfig().crosshairFlashDuration);
			}
		}
	}
}

/**
 * Save current game state to localStorage
 */
function saveGameState(): void {
	// Don't save if player hasn't been initialized yet
	if (!player) {
		return;
	}

	const gameState: GameState = {
		playerPos: Array.from(player.localPosition) as [number, number, number],
		playerOrientation: Array.from(player.localRotation) as [number, number, number, number],
		playerHeadRotation: Array.from(player.head.localRotation) as [number, number, number, number],
		showingMenu,
		godMode
	};
	const saveResult = safeSaveToStorage('gameState', gameState);
	if (!saveResult.success) {
		console.error(`Failed to save game state: ${saveResult.error.message}`);
	}

	// Ensure globalThis.godMode is always in sync
	if ((globalThis as any).godMode !== godMode) {
		(globalThis as any).godMode = godMode;
	}
}

/**
 * Update the UI display with game information
 */
function updateGameUI(): void {
	if (!timeLabel) return;

	// Get player combat stats
	const playerStats = combatSystem.getCombatStats(player);
	const currentWeapon = combatSystem.getWeapon(player);
	const healthInfo = playerStats ? `HP: ${Math.ceil(playerStats.health)}/${playerStats.maxHealth}` : '';
	const weaponInfo = currentWeapon ? `Weapon: ${currentWeapon.weaponData.name}` : '';
	const attackInfo = currentWeapon?.swing.isSwinging ?
		`<span style="color: #FF4444; font-weight: bold;">⚔️ ATTACKING! (${Math.round(currentWeapon.swing.progress * 100)}%)</span>` :
		`<span style="color: #888888;">Ready to attack</span>`;

	// Get physics and movement info
	const velocityInfo = `Speed: ${vec3.length(player.vel).toFixed(2)} m/s`;
	const groundedInfo = physicsSystem.isEntityOnGround(player) ?
		'<span style="color: #4ECDC4;">On Ground</span>' :
		'<span style="color: #FF6B6B;">Airborne</span>';

	// Get rendering info
	const meshStats = renderer.getMeshStats();
	const meshAlgorithm = useGreedyMesh ? "Greedy" : "Original";
	const faceCount = meshStats.faces > 0 ? meshStats.faces : 1000;
	const simpleMeshInfo = `Faces: ${faceCount.toLocaleString()} (${meshAlgorithm} mesh)`;

	// Update main UI display
	timeLabel.innerHTML = `<span style="color: #FFD700;">cam_pos: ${camera.entity?.worldPosition[0].toFixed(2)}, ${camera.entity?.worldPosition[1].toFixed(2)}, ${camera.entity?.worldPosition[2].toFixed(2)}<br>
		${godMode ? '<span style="color: #FFD700;">{ God Mode }</span>' : ' { Peon Mode }'}<br>
		<span style="color: #FF6B6B;">${healthInfo}</span><br>
		<span style="color: #4ECDC4;">${weaponInfo}</span><br>
		${attackInfo}</span><br>
		<span style="color: #AAFFAA;">${velocityInfo} | ${groundedInfo}</span><br>
		<span style="color: #FFB74D; font-size: 0.9em;">${simpleMeshInfo}</span>`;

	// Update crosshair color based on attack state
	updateCrosshairDisplay(currentWeapon);
}

/**
 * Update crosshair visual state
 */
function updateCrosshairDisplay(currentWeapon: any): void {
	const crosshair = document.getElementById('crosshair');
	if (!crosshair || !currentWeapon) return;

	const color = currentWeapon.swing.isSwinging ? '#FF4444' : '#FFFFFF';
	const lines = crosshair.getElementsByTagName('div');
	for (let i = 0; i < lines.length; i++) {
		(lines[i] as HTMLElement).style.background = color;
	}
}

/**
 * Process game input with performance monitoring
 */
function processGameInput(elapsed: number): number {
	if (!level.isFullyLoaded) return 0;

	const inputStartTime = performance.now();
	processInput(elapsed);
	const inputTime = performance.now() - inputStartTime;

	return inputTime;
}

/**
 * Update combat system with performance monitoring
 */
function updateCombatSystem(elapsed: number): number {
	const combatStartTime = performance.now();
	combatSystem.update(elapsed);
	return performance.now() - combatStartTime;
}

/**
 * Update physics system with performance monitoring
 */
function updatePhysicsSystem(elapsed: number): number {
	if (!level.isFullyLoaded) return 0;

	if (!physicsStarted) {
		console.log('🎮 Physics system started - level fully loaded and terrain collision data ready');
		physicsStarted = true;
	}

	const physicsStartTime = performance.now();
	physicsSystem.update(elapsed);
	const physicsTime = performance.now() - physicsStartTime;

	return physicsTime;
}

/**
 * Update all game entities
 */
function updateGameEntities(elapsed: number): void {
	if (!level.isFullyLoaded) return;

	for (const e of Entity.all) {
		e.update(elapsed);
	}
}

/**
 * Update entity transforms with performance monitoring
 */
function updateEntityTransforms(): number {
	const transformStartTime = performance.now();
	for (const e of Entity.all) {
		if (!e.parent) {
			e.updateTransforms(null);
		}
	}
	return performance.now() - transformStartTime;
}

/**
 * Render the current frame with performance monitoring
 */
function renderFrame(): number {
	const renderStartTime = performance.now();
	camera.update();
	renderer.draw();
	return performance.now() - renderStartTime;
}

/**
 * Update network systems with performance monitoring
 */
function updateNetworking(): number {
	const netStartTime = performance.now();
	net.update();
	return performance.now() - netStartTime;
}

/**
 * Main game loop - coordinates all game systems and updates
 */
function loop(): void {
	const frameStartTime = performance.now();
	const elapsed = frameStartTime - lastTime;
	lastTime = frameStartTime;
	// Game state management
	saveGameState();
	updateGameUI();
	// System updates
	const inputTime = processGameInput(elapsed);
	const combatTime = updateCombatSystem(elapsed);
	const physicsTime = updatePhysicsSystem(elapsed);

	// Update multiplayer system
	multiplayerManager.update(elapsed);
	updateGameEntities(elapsed);

	// Entity synchronization for multiplayer (handled by MultiplayerManager)

	const transformTime = updateEntityTransforms();
	const renderTime = renderFrame();
	const netTime = updateNetworking();

	// Performance monitoring
	const frameEndTime = performance.now();
	const totalFrameTime = frameEndTime - frameStartTime;

	requestAnimationFrame(loop);
}

async function main(): Promise<void> {
	setupUI();
	await renderer.init();
	// Set globalThis.modelNames BEFORE loading level (entities need this for model lookup)
	globalThis.modelNames = modelNames;
	console.log('✅ globalThis.modelNames assigned for entity creation');

	// Initialize resource manager (optional - can be removed if not used elsewhere)
	gameResources.initializeModelNames(modelNames);
	gameResources.setRenderer(renderer);
	gameResources.setCamera(camera);
	gameResources.setTileset(tileset);
	gameResources.setLevel(level);
	console.log('✅ Resource manager initialized with model names');
	// Create player after model names are available
	player = new Player(1, true, 'local_player');
	globalThis.player = player; // Make player available globally
	gameResources.setPlayer(player);
	console.log('✅ Player created and registered');

	// Set camera to follow the local player's head now that player exists
	camera.entity = player.head;

	// Load saved game state now that player exists
	const savedState = localStorage.getItem('gameState');
	if (savedState) {
		try {
			const state: GameState = JSON.parse(savedState);
			player.localPosition = vec3.fromValues(state.playerPos[0], state.playerPos[1], state.playerPos[2]);
			player.localRotation = quat.fromValues(state.playerOrientation[0], state.playerOrientation[1], state.playerOrientation[2], state.playerOrientation[3]); player.head.localRotation = quat.fromValues(state.playerHeadRotation[0], state.playerHeadRotation[1], state.playerHeadRotation[2], state.playerHeadRotation[3]);
			godMode = state.godMode;
			// Make sure godMode is synchronized with global scope
			(globalThis as any).godMode = godMode;
			showingMenu = state.showingMenu;
		} catch (error) {
			console.warn('Failed to load saved game state:', error);
		}
	}

	// Load saved settings
	const savedSettings = localStorage.getItem('gameSettings');
	if (savedSettings) {
		try {
			const obj: GameSettings = JSON.parse(savedSettings);
			if (obj.version === settings.version) {
				settings = obj;
				// Synchronize the useGreedyMesh variable with loaded settings
				useGreedyMesh = settings.useGreedyMesh;
				(globalThis as any).useGreedyMesh = useGreedyMesh;
			} else {
				localStorage.setItem('gameSettings', JSON.stringify(settings));
			}
		} catch (error) {
			console.warn('Failed to load saved settings:', error);
			localStorage.setItem('gameSettings', JSON.stringify(settings));
		}
	} else {
		// No saved settings, save the defaults
		localStorage.setItem('gameSettings', JSON.stringify(settings));
	}
	// Ensure useGreedyMesh is synchronized with global state
	useGreedyMesh = settings.useGreedyMesh;
	(globalThis as any).useGreedyMesh = useGreedyMesh;

	// Load all game assets
	await Promise.all([
		tileset.load(),
		level.load(),
		...models.map((model) => model.load())]
	);	// NOW assign models array to globalThis after they're fully loaded
	// modelNames was already assigned above for entity creation	globalThis.models = models;

	console.log('✅ Models array assigned to globalThis after loading');
	console.log(`📦 Loaded ${models.length} models successfully`);
	
	// NOW that globalThis.models is available, we can equip weapons
	combatSystem.equipWeapon(player, 'IRON_SWORD'); // Start with iron sword
	console.log('✅ Weapon equipped after models are fully loaded');
	
	// FIX: Update entity modelIds that were set to -1 during level loading
	// This happens because globalThis.modelNames wasn't available when entities were created
	let updatedEntities = 0;
	for (const entity of Entity.all) {
		if (entity.modelId === -1) {
			// Try to find the correct modelId based on entity type or properties
			if (entity instanceof Player) {
				entity.modelId = modelNames.indexOf('player'); if (entity.modelId >= 0) {
					updatedEntities++;
					console.log(`🔧 Fixed Player entity ${entity.id} modelId: ${entity.modelId} (${modelNames[entity.modelId]})`);
				}
			} else if ((entity as any).spawn) {
				// This is a spawn point entity - use 'portal' model since 'spawn' doesn't exist
				const spawnModelId = modelNames.indexOf('portal'); if (spawnModelId >= 0) {
					entity.modelId = spawnModelId;
					updatedEntities++;
					console.log(`🔧 Fixed spawn entity ${entity.id} modelId: ${entity.modelId} (${modelNames[entity.modelId]})`);
				}
			}
			// Note: FirstPersonWeapon entities should get their modelId set when a weapon is equipped
		}
	}
	if (updatedEntities > 0) {
		console.log(`🔧 Fixed modelIds for ${updatedEntities} entities after model loading`);
	}

	// Wait for GPU operations to complete before starting physics
	// The greedy mesh algorithm takes longer, so we need to ensure all resources are uploaded
	console.log('Waiting for GPU resource upload to complete...');
	await new Promise(resolve => requestAnimationFrame(resolve));
	await new Promise(resolve => requestAnimationFrame(resolve)); // Wait additional frame for greedy mesh
	// Wait for level to be fully loaded and registered
	while (!level.isFullyLoaded) {
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	console.log('Level fully loaded, starting physics...');
	// Initialize physics system with configuration
	physicsSystem.setLevel(level);
	physicsSystem.updateConfig({
		gravity: 9.8,
		maxVelocity: 100,
		jumpForce: 5,
		friction: 0.2,
		airResistance: 0.01,
		collisionBounce: 0.3,
		entityCollisionEnabled: true,
		terrainCollisionEnabled: true
	});

	// Enable physics debugging
	physicsSystem.setDebug(true);
	// Configure player physics properties
	physicsSystem.configureEntity(player, {
		hasGravity: true,
		hasCollision: true,
		radius: 0.25,
		height: 0.5,
		layer: PhysicsLayer.Player,
		collidesWith: PhysicsLayer.All & ~PhysicsLayer.Trigger // Collide with everything except triggers
	});

	// Initialize combat system
	const combatConfig = getConfig().getCombatConfig();
	combatSystem.initializeCombatStats(player, combatConfig.defaultMaxHealth, combatConfig.defaultDefense); // 100 HP, 5 defense

	// NOTE: Weapon equipping moved to after globalThis.models is available
	// Initialize weapon position adjuster
	WeaponPositionAdjuster.getInstance().init(settings.keybinds.adjustWeapon);

	// Initialize mesh statistics tracking
	MeshStats.getInstance();

	// Create a demo trigger volume
	const demoTrigger = new TriggerVolume(TriggerShape.Box, vec3.fromValues(2, 2, 2));
	demoTrigger.localPosition = vec3.fromValues(5, 5, 1);
	demoTrigger.setCallback({
		onEnter: (entity) => {
			if (entity === player) {
				console.log('Player entered trigger zone!');
				// Example: Boost player speed temporarily
				physicsSystem.updateConfig({
					maxVelocity: 20
				});
			}
		},
		onExit: (entity) => {
			if (entity === player) {
				console.log('Player exited trigger zone!');
				// Reset player speed
				physicsSystem.updateConfig({
					maxVelocity: 10
				});
			}
		}
	});
	// Initialize multiplayer manager
	(globalThis as any).multiplayerManager = multiplayerManager;
	
	// Start the game loop only after all initialization is complete
	requestAnimationFrame(loop);
}

// Start the game loop
requestAnimationFrame(loop);

// Add debug functions for testing
(globalThis as any).testMultiplayer = () => {
	console.log('🔄 Multiplayer Test');
	console.log(`📊 Total entities: ${Entity.all.length}`);

	const networkEntities = Entity.all.filter(e => e.isNetworkEntity);
	console.log(`🌐 Network entities: ${networkEntities.length}`);

	const remotePlayers = Entity.all.filter(e => e instanceof Player && !e.isLocalPlayer);
	console.log(`👥 Remote players: ${remotePlayers.length}`);

	// Log entity details
	Entity.all.forEach((entity, index) => {
		if (entity instanceof Player) {
			console.log(`Player ${index}: ID=${entity.id}, Local=${entity.isLocalPlayer}, Network=${entity.isNetworkEntity}, NetworkID=${entity.networkPlayerId}, Name=${entity.playerName}`);
		} else {
			console.log(`Entity ${index}: ID=${entity.id}, Network=${entity.isNetworkEntity}, Type=${entity.constructor.name}`);
		}
	});
};

// Debug function to manually create a test remote player
(globalThis as any).createTestRemotePlayer = () => {
	console.log('🧪 Creating test remote player...');
	const testPlayer = Player.createRemotePlayer('test_player_123');
	testPlayer.localPosition = vec3.fromValues(2, 2, 1); // Position nearby		console.log(`✅ Created test remote player at position [${testPlayer.localPosition[0]}, ${testPlayer.localPosition[1]}, ${testPlayer.localPosition[2]}]`);
	console.log(`🎨 ModelId assigned: ${testPlayer.modelId >= 0 ? 'Yes' : 'No'} (${testPlayer.modelId})`);
	return testPlayer;
};
// Debug function to check multiplayer player state
(globalThis as any).checkMultiplayerState = () => {
	const localPlayer = Player.getLocalPlayer();
	const globalPlayer = (globalThis as any).player;
	console.log('🔍 Multiplayer State Check');
	console.log('========================');

	console.log(`🔍 Player Reference Check:`);
	console.log(`   Global player === Local player: ${globalPlayer === localPlayer}`);
	console.log(`   Global player ID: ${globalPlayer?.id}`);
	console.log(`   Local player ID: ${localPlayer?.id}`);
	console.log(`   Camera following entity: ${(globalThis as any).camera?.entity?.parent?.id || 'none'}`);

	if (localPlayer) {
		console.log(`🏠 Local Player:`);
		console.log(`   ID: ${localPlayer.id}`);
		console.log(`   Network ID: ${localPlayer.networkPlayerId}`);
		console.log(`   Name: ${localPlayer.playerName}`);
		console.log(`   Is Local: ${localPlayer.isLocalPlayer}`);
		console.log(`   Is Network Entity: ${localPlayer.isNetworkEntity}`);
		console.log(`   Position: [${localPlayer.localPosition[0].toFixed(2)}, ${localPlayer.localPosition[1].toFixed(2)}, ${localPlayer.localPosition[2].toFixed(2)}]`);
	} else {
		console.log('❌ No local player found!');
	}

	const remotePlayers = Entity.all.filter(e => e instanceof Player && !e.isLocalPlayer) as Player[];
	console.log(`\n👥 Remote Players (${remotePlayers.length}):`);
	remotePlayers.forEach((player, index) => {
		console.log(`   Player ${index + 1}:`);
		console.log(`     ID: ${player.id}`);
		console.log(`     Network ID: ${player.networkPlayerId}`);
		console.log(`     Name: ${player.playerName}`);
		console.log(`     Is Network Entity: ${player.isNetworkEntity}`);
		console.log(`     Position: [${player.localPosition[0].toFixed(2)}, ${player.localPosition[1].toFixed(2)}, ${player.localPosition[2].toFixed(2)}]`);
	});

	const mpManager = (globalThis as any).multiplayerManager;
	if (mpManager) {
		const stats = mpManager.getNetworkStats();
		console.log(`\n📊 Network Status:`);
		console.log(`   Player ID: ${stats.playerId}`);
		console.log(`   Is Host: ${stats.isHost}`);
		console.log(`   Connection Active: ${stats.connectionActive}`);
	}

	console.log(`\n📦 Total Entities: ${Entity.all.length}`);
	console.log('========================');
};

// Debug function to test multiplayer host/join flow
(globalThis as any).testHostGame = async () => {
	console.log('🎮 Testing host game...');
	const mpManager = (globalThis as any).multiplayerManager;
	if (mpManager) {
		await mpManager.createGame('test_host_123');
		console.log('✅ Host game created');
		(globalThis as any).checkMultiplayerState();
	}
};

(globalThis as any).testJoinGame = async () => {
	console.log('🔗 Testing join game...');
	const mpManager = (globalThis as any).multiplayerManager;
	if (mpManager) {
		await mpManager.joinGame('test_client_456', 'test_host_123');
		console.log('✅ Attempted to join game');
		(globalThis as any).checkMultiplayerState();
	}
};

// Test function for the unified multiplayer architecture
(globalThis as any).testUnifiedMultiplayer = function () {
	console.log('=== Testing Unified Multiplayer Architecture ===');

	const mpManager = (globalThis as any).multiplayerManager;
	if (!mpManager) {
		console.error('MultiplayerManager not found');
		return;
	}

	console.log('MultiplayerManager debug state:', mpManager.getDebugState());
	console.log('Connection info:', mpManager.getConnectionInfo());

	// Test local player initialization
	if (!mpManager.getLocalPlayer()) {
		console.log('Initializing local player...');
		mpManager.initializeLocalPlayer();
	}

	const localPlayer = mpManager.getLocalPlayer();
	const localEntity = mpManager.getLocalPlayerEntity();

	console.log('Local player controller:', localPlayer ? localPlayer.getPlayerId() : 'None');
	console.log('Local player entity:', localEntity ? localEntity.id : 'None');

	// Test player management
	console.log('All players:', mpManager.getAllPlayers().map((p: any) => ({
		id: p.getPlayerId(),
		isLocal: p instanceof LocalPlayerController,
		hasEntity: !!p.getPlayerEntity()
	})));

	console.log('=== Architecture Test Complete ===');
	return {
		status: 'success',
		localPlayerId: localPlayer?.getPlayerId(),
		totalPlayers: mpManager.getAllPlayers().length,
		hasLocalEntity: !!localEntity
	};
};

// Test function for entity synchronization
(globalThis as any).testEntitySync = function () {
	console.log('=== Testing Entity Synchronization ===');

	const mpManager = (globalThis as any).multiplayerManager;
	if (!mpManager) {
		console.error('MultiplayerManager not found');
		return;
	}

	const syncStatus = mpManager.debugEntitySync();
	console.log('Entity Sync Status:', syncStatus);

	// Check if local player exists and is properly set up
	if (!syncStatus.localPlayer) {
		console.warn('No local player found - initializing...');
		mpManager.initializeLocalPlayer();
		const newStatus = mpManager.debugEntitySync();
		console.log('After initialization:', newStatus);
	}

	// Show entity count vs player count
	console.log(`Total player entities: ${syncStatus.allPlayerEntities.length}`);
	console.log(`Total controllers: ${syncStatus.controllers.length}`);
	console.log(`Connection active: ${syncStatus.isConnected}`);
	console.log(`Is host: ${syncStatus.isHost}`);

	if (syncStatus.allPlayerEntities.length === 0) {
		console.warn('⚠️  No player entities found - this could be why sync isn\'t working');
	}

	if (!syncStatus.isConnected) {
		console.warn('⚠️  Not connected to network - entities won\'t sync without connection');
	}

	return syncStatus;
};
// Force entity sync test
(globalThis as any).forceEntitySync = function () {
	console.log('=== Forcing Entity Sync Test ===');

	const mpManager = (globalThis as any).multiplayerManager;
	if (!mpManager) {
		console.error('MultiplayerManager not found');
		return;
	}

	// Ensure local player exists
	if (!mpManager.getLocalPlayer()) {
		console.log('Creating local player...');
		mpManager.initializeLocalPlayer();
	}

	// Get current state before
	const beforeState = mpManager.debugEntitySync();
	console.log('Before sync:', beforeState);

	// Manually trigger entity update
	if (mpManager.isConnected()) {
		console.log('Manually triggering entity sync...');
		mpManager.forceEntitySync();
		console.log('Entity sync triggered! Check other client for updates.');
	} else {
		console.warn('⚠️  Not connected - cannot sync entities');
		console.log('Available methods:');
		console.log('- createGame() to host');
		console.log('- joinGame(gameId) to join');
	}
	// Show final state
	const afterState = mpManager.debugEntitySync();
	console.log('After sync:', afterState);
	return { before: beforeState, after: afterState };
};

// Start the application
main().catch(console.error);