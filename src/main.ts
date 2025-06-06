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
import { WeaponConfigs } from './Weapon.js';
import { greedyMesh } from './utils.js';
import type { GameSettings, GameState } from './types/index.js';
import { TriggerVolume, TriggerShape } from './TriggerVolume.js';

// Message types for networking
export const MessageType = {
	PLAYER_JOIN: 0,
	PLAYER_LEAVE: 1,
	CHAT: 2,
	ENTITY_UPDATE: 3,
} as const;

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
const models: Record<string, Model> = Object.fromEntries(
	[
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
	].map((model) => [model, new Model(`/models/${model}.vox`)])
);

const tileset = new Tileset('/tilesets/dcss_tiles.tsj');
const level = new Level('/maps/test.tmj');
const player = new Player();
const renderer = new Renderer();
const net = new Net();
const camera = new Camera();

// Make global references available for legacy compatibility
declare global {
	var models: Record<string, Model>;
	var tileset: Tileset;
	var level: Level;
	var player: Player;
	var renderer: Renderer;
	var net: Net;
	var camera: Camera;
	var Entity: typeof Entity;
	var greedyMesh: any; // Will be defined later in the file
	var physicsSystem: any; // Use 'any' to avoid circular reference
	var useGreedyMesh: boolean;
}

globalThis.models = models;
globalThis.tileset = tileset;
globalThis.level = level;
globalThis.player = player;
globalThis.renderer = renderer;
globalThis.net = net;
globalThis.camera = camera;
globalThis.Entity = Entity;
globalThis.greedyMesh = greedyMesh;
globalThis.physicsSystem = physicsSystem;
globalThis.useGreedyMesh = useGreedyMesh;

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
		oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
		oscillator.frequency.exponentialRampToValueAtTime(200, audioContext.currentTime + 0.1);

		gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
		gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

		oscillator.start(audioContext.currentTime);
		oscillator.stop(audioContext.currentTime + 0.1);
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
		oscillator.frequency.setValueAtTime(150, audioContext.currentTime);
		oscillator.frequency.exponentialRampToValueAtTime(50, audioContext.currentTime + 0.15);

		gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
		gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);

		oscillator.start(audioContext.currentTime);
		oscillator.stop(audioContext.currentTime + 0.15);
	} catch (e) {
		// Fallback if Web Audio API fails
		console.log('💥 HIT!');
	}
}

// Make functions available globally for combat system
(globalThis as any).triggerAttackFlash = triggerAttackFlash;
(globalThis as any).playAttackSound = playAttackSound;
(globalThis as any).playHitSound = playHitSound;

// ...existing code...

function setupUI(): void {	// Set up keybind buttons
	for (const button of document.getElementsByClassName('bind-button')) {
		const bindButton = button as HTMLButtonElement;
		const binding = settings.keybinds[bindButton.id as keyof typeof settings.keybinds];
		bindButton.textContent = binding || '';
	}

	// Set up mouse invert checkbox
	const invertMouseCheckbox = document.getElementById('invert-mouse') as HTMLInputElement;
	if (invertMouseCheckbox) {
		invertMouseCheckbox.checked = settings.invertMouse;
	}

	const menu = document.getElementById('main-menu');
	if (!menu) return;
	let activeBinding: HTMLButtonElement | null = null;
	let bindingJustCompleted = false;
	menu.addEventListener('keyup', (event) => {
		event.stopPropagation();
		if (activeBinding) {
			event.preventDefault();
		}

		// If we just completed a binding, ignore this keyup to prevent re-activation
		if (bindingJustCompleted) {
			bindingJustCompleted = false;
			event.preventDefault();
			return;
		}
	}); menu.addEventListener('keydown', (event) => {
		event.stopPropagation();
		if (!activeBinding) return;

		// Check if this key is already bound to another action
		const existingBinding = Object.entries(settings.keybinds).find(([key, value]) =>
			value === event.code && key !== activeBinding!.id
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

		activeBinding.textContent = event.code;
		activeBinding.classList.remove('listening');
		settings.keybinds[activeBinding.id as keyof typeof settings.keybinds] = event.code;
		localStorage.setItem('gameSettings', JSON.stringify(settings));
		activeBinding = null;
		bindingJustCompleted = true;

		// Prevent the key from activating the button
		event.preventDefault();
	}); menu.addEventListener('mousedown', (event) => {
		event.stopPropagation();
		if (!activeBinding) return;

		// Map mouse buttons to consistent naming
		let mouseButton: string;
		switch (event.button) {
			case 0: mouseButton = 'Mouse0'; break; // Left click
			case 1: mouseButton = 'Mouse1'; break; // Middle click
			case 2: mouseButton = 'Mouse2'; break; // Right click
			case 3: mouseButton = 'Mouse3'; break; // Back button
			case 4: mouseButton = 'Mouse4'; break; // Forward button
			default: mouseButton = `Mouse${event.button}`; break;
		}

		// Check if this mouse button is already bound to another action
		const existingBinding = Object.entries(settings.keybinds).find(([key, value]) =>
			value === mouseButton && key !== activeBinding!.id
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

		activeBinding.textContent = mouseButton;
		activeBinding.classList.remove('listening');
		settings.keybinds[activeBinding.id as keyof typeof settings.keybinds] = mouseButton;
		localStorage.setItem('gameSettings', JSON.stringify(settings));
		activeBinding = null;
		bindingJustCompleted = true;

		// Prevent the subsequent click event
		event.preventDefault();
	}); menu.addEventListener('blur', (event) => {
		if (activeBinding && event.target === activeBinding) {
			const currentBinding = settings.keybinds[activeBinding.id as keyof typeof settings.keybinds];
			activeBinding.textContent = currentBinding || '';
			activeBinding.classList.remove('listening');
			activeBinding = null;
		}
	}, true);

	menu.addEventListener('click', (event) => {
		event.stopPropagation();

		// If we just completed a binding, ignore this click
		if (bindingJustCompleted) {
			bindingJustCompleted = false;
			return;
		}
		const button = event.target as HTMLButtonElement;
		if (button.classList?.contains('bind-button')) {
			activeBinding = button;
			activeBinding.classList.add('listening');
			// Don't change textContent - CSS will show "Press key..." via ::before
			return;
		}

		switch (button.id) {
			case 'close-menu':
				showingMenu = false;
				menu.hidden = true;
				break;
			case 'host':
				net.isHost = true;
				const hostIdInput = document.getElementById('hostid') as HTMLInputElement;
				if (hostIdInput) {
					net.host(hostIdInput.value);
				}
				break;
			case 'join':
				const joinHostIdInput = document.getElementById('hostid') as HTMLInputElement;
				if (joinHostIdInput) {
					net.join(joinHostIdInput.value);
				}
				break;
		}
	});

	if (showingMenu) {
		menu.hidden = false;
	}

	// Event listeners
	document.addEventListener('keydown', onKeydown);
	document.addEventListener('keyup', (event) => {
		key_states.delete(event.code);
	});

	document.addEventListener('mousemove', (event) => {
		if (document.pointerLockElement) {
			mouseMoveX += event.movementX;
			mouseMoveY += event.movementY;
		}
	});

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

		if (!document.pointerLockElement) {
			document.body.requestPointerLock();
		}
		if (showingMenu) {
			showingMenu = false;
			menu.hidden = true;
		}
	});

	document.addEventListener('visibilitychange', () => {
		lastTime = performance.now();
	});
	// Mouse button handlers for combat
	document.addEventListener('mousedown', (event) => {
		if (!document.pointerLockElement || showingMenu) return;

		// Map mouse buttons to consistent naming
		let mouseButton: string;
		switch (event.button) {
			case 0: mouseButton = 'Mouse0'; break; // Left click
			case 1: mouseButton = 'Mouse1'; break; // Middle click
			case 2: mouseButton = 'Mouse2'; break; // Right click
			case 3: mouseButton = 'Mouse3'; break; // Back button
			case 4: mouseButton = 'Mouse4'; break; // Forward button
			default: mouseButton = `Mouse${event.button}`; break;
		}

		key_states.add(mouseButton);
	});

	document.addEventListener('mouseup', (event) => {
		// Map mouse buttons to consistent naming
		let mouseButton: string;
		switch (event.button) {
			case 0: mouseButton = 'Mouse0'; break;
			case 1: mouseButton = 'Mouse1'; break;
			case 2: mouseButton = 'Mouse2'; break;
			case 3: mouseButton = 'Mouse3'; break;
			case 4: mouseButton = 'Mouse4'; break;
			default: mouseButton = `Mouse${event.button}`; break;
		}

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

	window.addEventListener('error', (event) => {
		const debug = document.getElementById('debug');
		if (debug) {
			debug.innerHTML = `${event.error} at ${event.filename}:${event.lineno}<br>${debug.innerHTML}`;
		}
	});

	window.addEventListener('unhandledrejection', (event) => {
		const debug = document.getElementById('debug');
		if (debug) {
			debug.innerHTML = `${event.reason}<br>${debug.innerHTML}`;
		}
	});	// Create time label
	timeLabel = document.createElement('div');
	timeLabel.style.position = 'fixed';
	timeLabel.style.top = '0px';
	timeLabel.style.color = 'white';
	timeLabel.style.padding = '10px';
	timeLabel.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
	timeLabel.style.borderRadius = '5px';
	timeLabel.style.fontFamily = 'monospace';
	timeLabel.style.fontSize = '14px'; timeLabel.style.lineHeight = '1.4';
	document.body.appendChild(timeLabel);

	// Create crosshair
	const crosshair = document.createElement('div');
	crosshair.id = 'crosshair';
	crosshair.style.position = 'fixed';
	crosshair.style.top = '50%';
	crosshair.style.left = '50%';
	crosshair.style.transform = 'translate(-50%, -50%)';
	crosshair.style.width = '20px';
	crosshair.style.height = '20px';
	crosshair.style.pointerEvents = 'none';
	crosshair.style.zIndex = '1000'; crosshair.innerHTML = `
		<div style="position: absolute; top: 50%; left: 0; right: 0; height: 2px; background: white; transform: translateY(-50%);"></div>
		<div style="position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; background: white; transform: translateX(-50%);"></div>
	`;
	document.body.appendChild(crosshair);

	// Create attack flash overlay
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

function onKeydown(event: KeyboardEvent): void {
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
		}		case 'Escape': {
			if (showingMenu) {
				showingMenu = false;
				const mainMenu = document.getElementById('main-menu');
				if (mainMenu) {
					mainMenu.hidden = true;
				}
				setTimeout(() => document.body.requestPointerLock(), 150);
			}
			break;
		}
		case settings.keybinds.godMode: {
			godMode = !godMode;
			// Synchronize with global scope for physics system
			(globalThis as any).godMode = godMode;
			console.log(`God Mode ${godMode ? 'enabled' : 'disabled'}`);
			break;
		} case settings.keybinds.respawn: {
			player.respawn();
			break;
		} case settings.keybinds.toggleMesh: {
			useGreedyMesh = !useGreedyMesh;
			settings.useGreedyMesh = useGreedyMesh;
			(globalThis as any).useGreedyMesh = useGreedyMesh;
			localStorage.setItem('gameSettings', JSON.stringify(settings));
			console.log(`Mesh algorithm switched to: ${useGreedyMesh ? 'Greedy Mesh' : 'Original'}`);
			console.log('Reload models to see the change...');
			// TODO: Could add live model reloading here
			break;
		}
		case settings.keybinds.switchWeapon: {
			// Cycle through available weapons
			const currentWeapon = combatSystem.getWeapon(player);
			if (currentWeapon) {
				const weaponTypes = Object.keys(WeaponConfigs) as Array<keyof typeof WeaponConfigs>;
				const currentIndex = weaponTypes.findIndex(type =>
					WeaponConfigs[type].id === currentWeapon.weaponData.id
				);
				const nextIndex = (currentIndex + 1) % weaponTypes.length;
				combatSystem.equipWeapon(player, weaponTypes[nextIndex]);
				console.log(`Switched to ${WeaponConfigs[weaponTypes[nextIndex]].name}`);
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
				setTimeout(() => line.style.background = '#FFFFFF', 200);
			}
		}
	}
}

function loop(): void {
	const elapsed = performance.now() - lastTime;
	lastTime = performance.now();	// Save game state
	const gameState: GameState = {
		playerPos: Array.from(player.localPosition) as [number, number, number],
		playerOrientation: Array.from(player.localRotation) as [number, number, number, number],
		playerHeadRotation: Array.from(player.head.localRotation) as [number, number, number, number],
		showingMenu,
		godMode
	};
	localStorage.setItem('gameState', JSON.stringify(gameState));

	// Ensure globalThis.godMode is always in sync
	if ((globalThis as any).godMode !== godMode) {
		(globalThis as any).godMode = godMode;
	}

	// Monitor for fall-through (player falling below reasonable level)
	if (player.localPosition[2] < -2 && !godMode) {
		console.warn(`⚠️ Potential fall-through detected! Player Z position: ${player.localPosition[2].toFixed(2)}`);
		console.warn(`Current mesh algorithm: ${useGreedyMesh ? 'Greedy Mesh' : 'Original'}`);
		console.warn(`Player velocity: [${player.vel[0].toFixed(2)}, ${player.vel[1].toFixed(2)}, ${player.vel[2].toFixed(2)}]`);
		console.warn(`On ground: ${physicsSystem.isEntityOnGround(player)}`);
	}// Update UI
	if (timeLabel) {
		const playerStats = combatSystem.getCombatStats(player);
		const currentWeapon = combatSystem.getWeapon(player);
		const healthInfo = playerStats ? `HP: ${Math.ceil(playerStats.health)}/${playerStats.maxHealth}` : '';
		const weaponInfo = currentWeapon ? `Weapon: ${currentWeapon.weaponData.name}` : '';
		const attackInfo = currentWeapon?.swing.isSwinging ?
			`<span style="color: #FF4444; font-weight: bold;">⚔️ ATTACKING! (${Math.round(currentWeapon.swing.progress * 100)}%)</span>` :
			`<span style="color: #888888;">Ready to attack</span>`;

		// Get physics info
		const physicsInfo = physicsSystem.getDebugStatus();
		const velocityInfo = `Speed: ${vec3.length(player.vel).toFixed(2)} m/s`;
		const groundedInfo = physicsSystem.isEntityOnGround(player) ?
			'<span style="color: #4ECDC4;">On Ground</span>' :
			'<span style="color: #FF6B6B;">Airborne</span>';

		timeLabel.innerHTML = `<span style="color: #FFD700;">cam_pos: ${camera.entity?.worldPosition[0].toFixed(2)}, ${camera.entity?.worldPosition[1].toFixed(2)}, ${camera.entity?.worldPosition[2].toFixed(2)}<br>
			${godMode ? '<span style="color: #FFD700;">{ God Mode }</span>' : ' { Peon Mode }'}<br>
			<span style="color: #FF6B6B;">${healthInfo}</span><br>
			<span style="color: #4ECDC4;">${weaponInfo}</span><br>
			${attackInfo}</span><br>
			<span style="color: #AAFFAA;">${velocityInfo} | ${groundedInfo}</span><br>
			<span style="color: #AAAAFF; font-size: 0.9em;">${physicsInfo}</span>`;

		// Update crosshair color based on attack state
		const crosshair = document.getElementById('crosshair');
		if (crosshair && currentWeapon) {
			const color = currentWeapon.swing.isSwinging ? '#FF4444' : '#FFFFFF';
			const lines = crosshair.getElementsByTagName('div');
			for (let i = 0; i < lines.length; i++) {
				(lines[i] as HTMLElement).style.background = color;
			}
		}
	}	// CRITICAL: Only process input after level is fully loaded to prevent race condition
	// Input processing can modify entity velocities, which should only happen after terrain is ready
	if (level.isFullyLoaded) {
		processInput(elapsed);
	}

	// Update systems
	combatSystem.update(elapsed);
	// CRITICAL: Only run physics after level is fully loaded to prevent race condition
	// Greedy mesh takes longer to generate, so physics must wait for terrain data
	if (level.isFullyLoaded) {
		if (!physicsStarted) {
			console.log('🎮 Physics system started - level fully loaded and terrain collision data ready');
			physicsStarted = true;
		}
		physicsSystem.update(elapsed);
	}
	// Update all entities (gameplay logic only, physics handled separately)
	// Wait for level to be fully loaded before running entity updates to prevent race conditions
	if (level.isFullyLoaded) {
		for (const e of Entity.all) {
			e.update(elapsed);
		}
	}

	// Update transforms
	for (const e of Entity.all) {
		if (!e.parent) {
			e.updateTransforms(null);
		}
	}

	camera.update();
	renderer.draw();
	net.update();
	requestAnimationFrame(loop);
}

async function main(): Promise<void> {
	camera.entity = player.head;

	// Load saved game state
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

	setupUI();
	await renderer.init();
	// Load all game assets
	await Promise.all([
		tileset.load(),
		level.load(),
		...Object.values(models).map((model) => model.load())]);
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
	combatSystem.initializeCombatStats(player, 100, 5); // 100 HP, 5 defense
	combatSystem.equipWeapon(player, 'IRON_SWORD'); // Start with iron sword

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

	requestAnimationFrame(loop);
}

// Start the game
main().catch(error => {
	console.error('Failed to start game:', error);
	const debug = document.getElementById('debug');
	if (debug) {
		debug.innerHTML = `Failed to start game: ${error}<br>${debug.innerHTML}`;
	}
});


