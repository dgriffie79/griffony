import { mat4, quat, vec3 } from 'gl-matrix';
import { Entity, PhysicsLayer } from './Entity.js';
import { Camera } from './Camera.js';
import { createPlayer } from './EntityFactory.js';
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
import { GameManager } from './GameManager.js';
import { LocalPlayerController } from './PlayerController.js';
import { gameResources } from './GameResources.js';

// Make Entity class available globally for components
(globalThis as any).Entity = Entity;

// Global game state
let lastTime = 0;
let gameRunning = true;
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
let player: Entity; // Declare but don't initialize yet
const renderer = new Renderer();
const net = new Net();
const camera = new Camera();
const inputManager = InputManager.getInstance();
const chatUI = new ChatUI(net);
const gameManager = new GameManager(net);

// Make global references available for legacy compatibility
declare global {
	var models: Model[];
	var modelNames: string[];
	var tileset: Tileset;
	var level: Level;
	var player: Entity;
	var renderer: Renderer;
	var net: Net;
	var camera: Camera;
	var inputManager: InputManager;
	var chatUI: ChatUI;
	var gameManager: GameManager;
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
		oscillator.stop(audioContext.currentTime + audioConfig.hitSoundFrequency.duration);	} catch (e) {
		// Fallback if Web Audio API fails
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
		return settings;
	}
	const savedSettings = loadResult.data;
	if (!savedSettings) {
		return settings;
	}

	// Validate required fields
	if (!savedSettings.keybinds || typeof savedSettings.keybinds !== 'object') {
		return settings;
	}

	return savedSettings as GameSettings;
}

/**
 * Load game state with validation and error handling
 */
function loadGameState(): GameState | null {
	const loadResult = safeLoadFromStorage<GameState | null>('gameState', null);

	if (!loadResult.success) {
		return null;
	}

	const savedState = loadResult.data;
	if (!savedState) {
		return null;
	}

	// Validate state structure
	if (typeof savedState !== 'object' ||
		!Array.isArray(savedState.playerPos) ||
		!Array.isArray(savedState.playerOrientation) ||
		!Array.isArray(savedState.playerHeadRotation)) {
		return null;
	}

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
	safeSaveToStorage('gameSettings', settings);

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
	console.log('showManualSignalingUI called, isHost:', isHost);
	
	// Check for existing signaling UI
	const existing = document.getElementById('manualSignalingUI');
	if (existing) {
		console.log('Removing existing signaling UI');
		existing.remove();
	}
	
	// Hide the main menu temporarily
	const menu = document.getElementById('main-menu');
	if (menu) {
		menu.hidden = true;
	}	// Create and show the manual signaling UI
	const signalingUI = new ManualSignalingUI(net, gameManager);
	signalingUI.onComplete(() => {
		showingMenu = false;
		// Request pointer lock to resume game
		setTimeout(() => document.body.requestPointerLock(), getConfig().getUIConfig().pointerLockDelay);
	});

	signalingUI.onError((error) => {
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
			return;
		}

		// Don't request pointer lock if clicking within the chat UI
		const chatUI = document.getElementById('chat-ui');
		if (chatUI && chatUI.contains(target)) {
			return;
		}		// Don't request pointer lock if showing menu
		if (showingMenu) {
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
			return;
		}

		// Request pointer lock for valid game area clicks
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
		}		case settings.keybinds.godMode: {
			godMode = !godMode;
			// Synchronize with global scope for physics system
			(globalThis as any).godMode = godMode;
			break;
		} case settings.keybinds.respawn: {
			player.player?.respawn();
			break;
		} case settings.keybinds.toggleMesh: {
			useGreedyMesh = !useGreedyMesh; settings.useGreedyMesh = useGreedyMesh;
			(globalThis as any).useGreedyMesh = useGreedyMesh;
			localStorage.setItem('gameSettings', JSON.stringify(settings));

			// Update renderer to use new mesh type immediately
			renderer.updateMeshRenderingMode();

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
			}
			break;		} case settings.keybinds.adjustWeapon: {
			// Toggle the weapon position adjuster with the current weapon model
			const currentWeapon = combatSystem.getWeapon(player);
			if (currentWeapon) {
				toggleWeaponAdjuster(currentWeapon.weaponData.modelName);
			} else {
				toggleWeaponAdjuster();
			}
			break;
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
	const playerHead = player.player?.getHead();

	quat.rotateZ(player.localRotation, player.localRotation, -dx * elapsed / 1000);
	if (playerHead) {
		quat.rotateX(playerHead.localRotation, playerHead.localRotation, dy * elapsed / 1000);

		// Clamp head rotation - extract pitch angle properly
		const tempAxis = vec3.create();
		const angle = quat.getAxisAngle(tempAxis, playerHead.localRotation);
		
		// Check if rotation is around X-axis (pitch) and clamp it
		if (Math.abs(tempAxis[0]) > 0.9) { // X-axis rotation
			const pitch = tempAxis[0] > 0 ? angle : -angle;
			const maxPitch = Math.PI / 2 - 0.01; // Slightly less than 90 degrees to prevent gimbal lock
			
			if (Math.abs(pitch) > maxPitch) {
				const clampedPitch = Math.sign(pitch) * maxPitch;
				quat.setAxisAngle(playerHead.localRotation, vec3.fromValues(1, 0, 0), clampedPitch);
			}
		}
	}

	player.dirty = true;
	if (playerHead) {
		playerHead.dirty = true;
	}

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
	const playerHead = player.player?.getHead();
	const gameState: GameState = {
		playerPos: Array.from(player.localPosition) as [number, number, number],
		playerOrientation: Array.from(player.localRotation) as [number, number, number, number],
		playerHeadRotation: playerHead ? Array.from(playerHead.localRotation) as [number, number, number, number] : [0, 0, 0, 1],
		showingMenu,
		godMode
	};
	safeSaveToStorage('gameState', gameState);

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
	
	// Skip rendering if game is shutting down or resources might be disposed
	if (!gameRunning) {
		return 0;
	}
	
	try {
		camera.update();
		renderer.draw();
	} catch (error) {
		console.warn('Render error (likely during shutdown):', error);
		return 0;
	}
	
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
	// Check if game should continue running
	if (!gameRunning) {
		return;
	}
	
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
	gameManager.update(elapsed);
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

	// Initialize resource manager (optional - can be removed if not used elsewhere)
	gameResources.initializeModelNames(modelNames);
	gameResources.setRenderer(renderer);
	gameResources.setCamera(camera);
	gameResources.setTileset(tileset);
	gameResources.setLevel(level);
	
	// Create player after model names are available
	// Use the GameManager to create the local player properly
	gameManager.initializeLocalPlayer();
	const localPlayerEntity = gameManager.getLocalPlayerEntity();
	
	if (localPlayerEntity) {
		player = localPlayerEntity;
		globalThis.player = player; // Make player available globally
		gameResources.setPlayer(player);
	} else {
		// Fallback: create player directly if GameManager fails
		const playerId = gameManager.getPlayerId() || 'local_player';
		player = createPlayer(true, playerId);
		globalThis.player = player;
		gameResources.setPlayer(player);
	}

	// Set camera to follow the local player's head now that player exists
	camera.entity = player.player?.getHead();

	// Load saved game state now that player exists
	const savedState = localStorage.getItem('gameState');
	if (savedState) {
		try {
			const state: GameState = JSON.parse(savedState);
			player.localPosition = vec3.fromValues(state.playerPos[0], state.playerPos[1], state.playerPos[2]);
			player.localRotation = quat.fromValues(state.playerOrientation[0], state.playerOrientation[1], state.playerOrientation[2], state.playerOrientation[3]);
			const playerHead = player.player?.getHead();
			if (playerHead) {
				playerHead.localRotation = quat.fromValues(state.playerHeadRotation[0], state.playerHeadRotation[1], state.playerHeadRotation[2], state.playerHeadRotation[3]);
			}
			godMode = state.godMode;
			// Make sure godMode is synchronized with global scope
			(globalThis as any).godMode = godMode;
			showingMenu = state.showingMenu;		} catch (error) {
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
			}		} catch (error) {
			localStorage.setItem('gameSettings', JSON.stringify(settings));
		}
	} else {
		// No saved settings, save the defaults
		localStorage.setItem('gameSettings', JSON.stringify(settings));
	}
	// Ensure useGreedyMesh is synchronized with global state
	useGreedyMesh = settings.useGreedyMesh;
	(globalThis as any).useGreedyMesh = useGreedyMesh;

	// Load all game assets (level loading now has access to modelNames)
	await Promise.all([
		tileset.load(),
		level.load(), // Now level loading can properly resolve model names to IDs
		...models.map((model) => model.load())
	]);

	// NOW assign models array to globalThis after they're fully loaded
	globalThis.models = models;
	gameResources.setModels(models); // Also set in GameResources for proper lookup

	// NOW that globalThis.models is available, we can equip weapons
	combatSystem.equipWeapon(player, 'IRON_SWORD'); // Start with iron sword

	// Wait for GPU operations to complete before starting physics
	// The greedy mesh algorithm takes longer, so we need to ensure all resources are uploaded
	await new Promise(resolve => requestAnimationFrame(resolve));
	await new Promise(resolve => requestAnimationFrame(resolve)); // Wait additional frame for greedy mesh	// Wait for level to be fully loaded and registered
	while (!level.isFullyLoaded) {
		await new Promise(resolve => setTimeout(resolve, 10));
	}
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
				// Example: Boost player speed temporarily
				physicsSystem.updateConfig({
					maxVelocity: 20
				});
			}
		},
		onExit: (entity) => {
			if (entity === player) {
				// Reset player speed
				physicsSystem.updateConfig({
					maxVelocity: 10
				});
			}
		}
	});
	// Initialize multiplayer manager
	(globalThis as any).gameManager = gameManager;
	
	// Add shutdown handler to stop game loop during page unload
	window.addEventListener('beforeunload', () => {
		gameRunning = false;
		console.log('Game loop stopped for page unload');
	});
	
	// Start the game loop only after all initialization is complete
	requestAnimationFrame(loop);
}

// Start the application
main().catch(console.error);