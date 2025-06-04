import { mat4, quat, vec3 } from 'gl-matrix';
import { Entity } from './Entity.js';
import { Camera } from './Camera.js';
import { Player } from './Player.js';
import { Model } from './Model.js';
import { Tileset } from './Tileset.js';
import { Level } from './Level.js';
import { Renderer } from './Renderer.js';
import { Net } from './Net.js';
import { greedyMesh } from './utils.js';
import type { GameSettings, GameState } from './types/index.js';

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

let settings: GameSettings = {
	version: 1,
	invertMouse: true,
	keybinds: {
		forward: 'KeyW',
		backward: 'KeyS',
		left: 'KeyA',
		right: 'KeyD',
		up: 'KeyE',
		down: 'KeyQ',
		jump: 'Space',
		respawn: 'KeyR',
		godMode: 'KeyG',
	}
};

const key_states = new Set<string>();

let mouseMoveX = 0;
let mouseMoveY = 0;
let showingMenu = false;
let godMode = true;

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

function setupUI(): void {
	// Set up keybind buttons
	for (const button of document.getElementsByClassName('bind-button')) {
		const bindButton = button as HTMLButtonElement;
		bindButton.textContent = settings.keybinds[bindButton.id as keyof typeof settings.keybinds];
	}

	// Set up mouse invert checkbox
	const invertMouseCheckbox = document.getElementById('invert-mouse') as HTMLInputElement;
	if (invertMouseCheckbox) {
		invertMouseCheckbox.checked = settings.invertMouse;
	}

	const menu = document.getElementById('main-menu');
	if (!menu) return;

	let activeBinding: HTMLButtonElement | null = null;

	menu.addEventListener('keyup', (event) => {
		event.stopPropagation();
		if (activeBinding) {
			event.preventDefault();
			activeBinding = null;
		}
	});

	menu.addEventListener('keydown', (event) => {
		event.stopPropagation();
		if (!activeBinding) return;

		activeBinding.textContent = event.code;
		activeBinding.classList.remove('listening');
		settings.keybinds[activeBinding.id as keyof typeof settings.keybinds] = event.code;
		localStorage.setItem('gameSettings', JSON.stringify(settings));
	});

	menu.addEventListener('blur', (event) => {
		if (activeBinding && event.target === activeBinding) {
			activeBinding.textContent = settings.keybinds[activeBinding.id as keyof typeof settings.keybinds];
			activeBinding.classList.remove('listening');
			activeBinding = null;
		}
	}, true);

	menu.addEventListener('click', (event) => {
		event.stopPropagation();
		const button = event.target as HTMLButtonElement;
		
		if (button.classList?.contains('bind-button')) {
			activeBinding = button;
			activeBinding.classList.add('listening');
			activeBinding.textContent = 'Press a key...';
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
	});

	// Create time label
	timeLabel = document.createElement('div');
	timeLabel.style.position = 'fixed';
	timeLabel.style.top = '0px';
	timeLabel.style.color = 'white';
	document.body.appendChild(timeLabel);
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
		}
		case 'Escape': {
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
			break;
		}
		case settings.keybinds.respawn: {
			player.respawn();
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
		forward[2] = 0;
		vec3.normalize(forward, forward);
		right[2] = 0;
		vec3.normalize(right, right);
	} else {
		player.vel[2] = 0;
	}

	player.vel[0] = 0;
	player.vel[1] = 0;

	if (key_states.has(settings.keybinds.forward)) {
		vec3.scaleAndAdd(player.vel, player.vel, forward, speed);
	}
	if (key_states.has(settings.keybinds.backward)) {
		vec3.scaleAndAdd(player.vel, player.vel, forward, -speed);
	}
	if (key_states.has(settings.keybinds.left)) {
		vec3.scaleAndAdd(player.vel, player.vel, right, -speed);
	}
	if (key_states.has(settings.keybinds.right)) {
		vec3.scaleAndAdd(player.vel, player.vel, right, speed);
	}
	if (godMode && key_states.has(settings.keybinds.up)) {
		vec3.scaleAndAdd(player.vel, player.vel, up, speed);
	}
	if (godMode && key_states.has(settings.keybinds.down)) {
		vec3.scaleAndAdd(player.vel, player.vel, up, -speed);
	}
	if (key_states.has(settings.keybinds.jump)) {
		if (player.gravity && !godMode && player.onGround(level)) {
			player.vel[2] += 5;
		}
		key_states.delete(settings.keybinds.jump);
	}

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

function loop(): void {
	const elapsed = performance.now() - lastTime;
	lastTime = performance.now();

	// Save game state
	const gameState: GameState = {
		playerPos: Array.from(player.localPosition) as [number, number, number],
		playerOrientation: Array.from(player.localRotation) as [number, number, number, number],
		playerHeadRotation: Array.from(player.head.localRotation) as [number, number, number, number],
		showingMenu,
		godMode
	};
	localStorage.setItem('gameState', JSON.stringify(gameState));

	// Update UI
	if (timeLabel) {		timeLabel.innerHTML = `<span style="color: #FFD700;">cam_pos: ${camera.entity?.worldPosition[0].toFixed(2)}, ${camera.entity?.worldPosition[1].toFixed(2)}, ${camera.entity?.worldPosition[2].toFixed(2)}
			${godMode ? '<span style="color: #FFD700;">{ God Mode }</span>' : ' { Peon Mode }'}</span>`;
	}

	processInput(elapsed);

	// Update all entities
	for (const e of Entity.all) {
		e.update(elapsed);
		
		// Apply gravity
		if (e.gravity && !(e instanceof Player && godMode)) {
			if (!e.onGround(level)) {
				e.vel[2] -= 9.8 * elapsed / 1000;
			}
		}

		// Apply velocity
		const speed = vec3.length(e.vel);
		if (speed > 100) {
			vec3.normalize(e.vel, e.vel);
			vec3.scale(e.vel, e.vel, 100);
		}
		if (speed > 0) {
			vec3.scaleAndAdd(e.localPosition, e.localPosition, e.vel, elapsed / 1000);
			e.dirty = true;
		}

		// Collision detection for players
		if (e instanceof Player && !godMode) {
			// Entity-entity collision
			for (const ee of Entity.all) {
				if (e === ee || ee.spawn || ee === e.head) continue;

				const s = vec3.sub(vec3.create(), ee.localPosition, e.localPosition);
				const d = vec3.length(s);

				if (d < e.radius + ee.radius) {
					const pushback = e.radius + ee.radius - d;
					const t = vec3.add(vec3.create(), s, e.vel);
					vec3.normalize(t, t);
					vec3.scaleAndAdd(e.localPosition, e.localPosition, t, -pushback);
					e.dirty = true;
					if (e.radius >= ee.radius) {
						vec3.scaleAndAdd(ee.localPosition, e.vel, t, pushback);
						ee.dirty = true;
					}
				}
			}

			// Terrain collision
			if (level.volume.getVoxelFloor(e.localPosition[0] + e.radius, e.localPosition[1], e.localPosition[2] + e.height / 2)) {
				e.localPosition[0] = Math.floor(e.localPosition[0] + e.radius) - e.radius;
				e.dirty = true;
			}
			if (level.volume.getVoxelFloor(e.localPosition[0] - e.radius, e.localPosition[1], e.localPosition[2] + e.height / 2)) {
				e.localPosition[0] = Math.ceil(e.localPosition[0] - e.radius) + e.radius;
				e.dirty = true;
			}
			if (level.volume.getVoxelFloor(e.localPosition[0], e.localPosition[1] + e.radius, e.localPosition[2] + e.height / 2)) {
				e.localPosition[1] = Math.floor(e.localPosition[1] + e.radius) - e.radius;
				e.dirty = true;
			}
			if (level.volume.getVoxelFloor(e.localPosition[0], e.localPosition[1] - e.radius, e.localPosition[2] + e.height / 2)) {
				e.localPosition[1] = Math.ceil(e.localPosition[1] - e.radius) + e.radius;
				e.dirty = true;
			}
			if (level.volume.getVoxelFloor(e.localPosition[0], e.localPosition[1], e.localPosition[2] + e.height)) {
				e.localPosition[2] = Math.floor(e.localPosition[2] + e.height) - e.height;
				e.vel[2] = 0;
				e.dirty = true;
			}
			if (level.volume.getVoxelFloor(e.localPosition[0], e.localPosition[1], e.localPosition[2])) {
				e.localPosition[2] = Math.ceil(e.localPosition[2]);
				e.vel[2] = 0;
				e.dirty = true;
			}
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
			player.localRotation = quat.fromValues(state.playerOrientation[0], state.playerOrientation[1], state.playerOrientation[2], state.playerOrientation[3]);
			player.head.localRotation = quat.fromValues(state.playerHeadRotation[0], state.playerHeadRotation[1], state.playerHeadRotation[2], state.playerHeadRotation[3]);
			godMode = state.godMode;
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
			} else {
				localStorage.setItem('gameSettings', JSON.stringify(settings));
			}
		} catch (error) {
			console.warn('Failed to load saved settings:', error);
			localStorage.setItem('gameSettings', JSON.stringify(settings));
		}
	}

	setupUI();
	await renderer.init();

	// Load all game assets
	await Promise.all([
		tileset.load(),
		level.load(),
		...Object.values(models).map((model) => model.load())
	]);

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
