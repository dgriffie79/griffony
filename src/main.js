import { mat4, quat, vec3 } from 'gl-matrix'

import V_SRC from './shaders/V.glsl.js'
//import MODEL_F_SRC from './shaders/model_F.glsl.js'
// @ts-ignore
import MODEL_F_SRC from './shaders/model_F.glsl?raw'
import TERRAIN_F_SRC from './shaders/terrain_F.glsl.js'

/**@type {WebGL2RenderingContext} */
let gl

let lastTime = 0

/** @type {HTMLDivElement} */
let timeLabel

/** @type {Shader} */
let modelShader

/** @type {Shader} */
let terrainShader

/** @type {Tileset} */
let tileset

let viewport = [0, 0]
let cameraPosition = vec3.create()
let cameraPitch = 0
let cameraOrientation = quat.create()

let settings = {
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
}

const key_states = new Set()

let mouseMoveX = 0
let mouseMoveY = 0
let showingMenu = false
let godMode = true

/** @type {Entity[]} */
const entities = []

/** @type {Entity} */
let player

/** @type { {[key: string]: Model}} */
const models = {}

/** @type {Level} */
let level

/** @enum {number} */
const EntityType = Object.freeze({
	NONE: 0,
	PLAYER: 1,
	SPAWN: 2,
})

class Entity {
	constructor() {
		this.id = -1

		/** @type {EntityType} */
		this.type = EntityType.NONE
		this.pos = vec3.create()
		this.vel = vec3.create()
		this.orientation = quat.create()
		this.frame = 0
		this.frame_time = 0
		this.model_id = -1
		this.height = 1
		this.radius = 0.5
		this.gravity = true
		/** @type {Model} */
		this.model
		this.scale = vec3.fromValues(1, 1, 1)
		this.animationFrame = 0
	}

	static deserialize(data) {
		const entity = new Entity()

		entity.type = EntityType[data.type.toUpperCase()] ?? EntityType.NONE
		entity.pos = vec3.fromValues(data.x / 32, data.y / 32, 1)

		switch (data.type) {
			case EntityType.SPAWN:
				entity.gravity = false
				break
		}

		for (const property of data.properties ?? []) {
			switch (property.name) {
				case 'rotation':
					quat.fromEuler(entity.orientation, 0, 0, property.value)
					break
				case 'scale':
					entity.scale = vec3.fromValues(property.value, property.value, property.value)
					entity.radius = property.value
					break
				case 'model_id':
					entity.model_id = property.value
					break
			}
		}

		entity.model = models[entity.model_id]

		return entity
	}

	/**
	 * @param {Level} terrain
	 * @returns {boolean}
	 */
	onGround(terrain) {
		const r = .85 * this.radius
		if (terrain.getVoxel(this.pos[0], this.pos[1], this.pos[2] - Number.EPSILON)) {
			return true
		}
		if (terrain.getVoxel(this.pos[0] + r, this.pos[1], this.pos[2] - Number.EPSILON)) {
			return true
		}
		if (terrain.getVoxel(this.pos[0] - r, this.pos[1], this.pos[2] - Number.EPSILON)) {
			return true
		}
		if (terrain.getVoxel(this.pos[0], this.pos[1] + r, this.pos[2] - Number.EPSILON)) {
			return true
		}
		if (terrain.getVoxel(this.pos[0], this.pos[1] - r, this.pos[2] - Number.EPSILON)) {
			return true
		}
		return false
	}
}

class Shader {
	/**
	 * @param {string} vertexSource
	 * @param {string} fragmentSource
	 * */
	constructor(vertexSource, fragmentSource) {
		this.program = null
		this.vertexShader = null
		this.fragmentShader = null
		this.viewportLocation = null
		this.voxelsLocation = null
		this.tilesLocation = null
		this.paletteLocation = null
		this.mvpMatrixLocation = null
		this.modelMatrixLocation = null
		this.modelViewMatrixLocation = null
		this.projectionMatrixLocation = null
		this.cameraPositionLocation = null

		this.vertexShader = gl.createShader(gl.VERTEX_SHADER)
		if (!this.vertexShader) {
			throw new Error('Error creating vertex shader')
		}
		gl.shaderSource(this.vertexShader, vertexSource)
		gl.compileShader(this.vertexShader)
		if (!gl.getShaderParameter(this.vertexShader, gl.COMPILE_STATUS)) {
			console.error('Error compiling shader:', gl.getShaderInfoLog(this.vertexShader))
		}

		this.fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)
		if (!this.fragmentShader) {
			throw new Error('Error creating fragment shader')
		}
		gl.shaderSource(this.fragmentShader, fragmentSource)
		gl.compileShader(this.fragmentShader)
		if (!gl.getShaderParameter(this.fragmentShader, gl.COMPILE_STATUS)) {
			console.error('Error compiling shader:', gl.getShaderInfoLog(this.fragmentShader))
		}

		this.program = gl.createProgram()
		gl.attachShader(this.program, this.vertexShader)
		gl.attachShader(this.program, this.fragmentShader)
		gl.linkProgram(this.program)
		if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
			console.error('Error linking program:', gl.getProgramInfoLog(this.program))
		}

		this.viewportLocation = gl.getUniformLocation(this.program, 'viewport')
		this.voxelsLocation = gl.getUniformLocation(this.program, 'voxels')
		this.tilesLocation = gl.getUniformLocation(this.program, 'tiles')
		this.paletteLocation = gl.getUniformLocation(this.program, 'palette')
		this.mvpMatrixLocation = gl.getUniformLocation(this.program, 'mvpMatrix')
		this.modelMatrixLocation = gl.getUniformLocation(this.program, 'modelMatrix')
		this.modelViewMatrixLocation = gl.getUniformLocation(this.program, 'modelViewMatrix')
		this.projectionMatrixLocation = gl.getUniformLocation(this.program, 'projectionMatrix')
		this.cameraPositionLocation = gl.getUniformLocation(this.program, 'cameraPosition')
	}
}

class Model {
	constructor(url = '') {
		this.url = url
		this.sizeX = 0
		this.sizeY = 0
		this.sizeZ = 0
		this.voxels = null
		this.palette = null
		this.texture = null
	}

	async load() {
		const response = await fetch(this.url)
		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`)
		}
		if (response.headers.get('Content-Type') === 'text/html') {
			throw new Error('Invalid model')
		}

		const buffer = await response.arrayBuffer()
		const dataView = new DataView(buffer)

		this.sizeX = dataView.getInt32(0, true)
		this.sizeY = dataView.getInt32(4, true)
		this.sizeZ = dataView.getInt32(8, true)

		const numVoxels = this.sizeX * this.sizeY * this.sizeZ
		const sourceVoxels = new Uint8Array(dataView.buffer, 12, numVoxels)
		this.voxels = new Uint8Array(numVoxels);

		// Transform from [x][y][z] to [z][y][x]
		for (let x = 0; x < this.sizeX; x++) {
			for (let y = 0; y < this.sizeY; y++) {
				for (let z = 0; z < this.sizeZ; z++) {
					const srcIdx = x * this.sizeY * this.sizeZ + y * this.sizeZ + z
					const dstIdx = (this.sizeZ - z - 1) * this.sizeY * this.sizeX + (this.sizeY - y - 1) * this.sizeX + x
					this.voxels[dstIdx] = sourceVoxels[srcIdx]
				}
			}
		}

		this.palette = new Uint8Array(dataView.buffer, 12 + numVoxels, 256 * 3)
		for (let i = 0; i < this.palette.length; i++) {
			this.palette[i] = this.palette[i] << 2
		}

		this.texture = gl.createTexture()
		gl.bindTexture(gl.TEXTURE_3D, this.texture)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
		gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8UI, this.sizeX, this.sizeY, this.sizeZ, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, this.voxels)
	}

	draw(mvpMatrix, modelMatrix) {
		gl.useProgram(modelShader.program)
		gl.uniformMatrix4fv(modelShader.mvpMatrixLocation, false, mvpMatrix)
		gl.uniformMatrix4fv(modelShader.modelMatrixLocation, false, modelMatrix)
		gl.uniform3fv(modelShader.cameraPositionLocation, cameraPosition)
		gl.activeTexture(gl.TEXTURE0)
		gl.bindTexture(gl.TEXTURE_3D, this.texture)
		gl.uniform1i(modelShader.voxelsLocation, 0)
		gl.uniform1uiv(modelShader.paletteLocation, new Uint32Array(this.palette.slice().buffer))
		gl.drawArrays(gl.TRIANGLES, 0, 36)
	}
}

class Tileset {
	constructor() {
		this.url = ''
		this.texture = null
	}

	/**
	 * @param {string} url
	 * @returns {Promise<HTMLImageElement>}
	 */
	async #loadImage(url) {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.src = url;
			img.onload = () => resolve(img);
			img.onerror = reject
		});
	}

	/**
	 * @param {HTMLImageElement | ImageData } src 
	 * @param {number} tileWidth
	 * @param {number} tileHeight
	 * @param {number} tileCount
	 */

	#createTexture(src, tileWidth, tileHeight, tileCount) {
		this.texture = gl.createTexture()
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture)
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT)
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT)
		gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, tileWidth, tileHeight, tileCount, 0, gl.RGBA, gl.UNSIGNED_BYTE, src)
	}

	async load() {
		const response = await fetch(this.url)
		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`)
		}
		let data
		try {
			data = await response.json()
		}
		catch (e) {
			console.error('Invalid tileset:', e)
			throw e
		}

		const tileWidth = data.tilewidth
		const tileHeight = data.tileheight
		const tileCount = data.tilecount

		const baseUrl = new URL(this.url, window.location.href).href

		if (data.image) {
			const img = await this.#loadImage(new URL(data.image, baseUrl).href)
			this.#createTexture(img, tileWidth, tileHeight, tileCount)
		} else if (data.tiles) {
			const canvas = document.createElement('canvas')
			const ctx = canvas.getContext('2d')
			if (!ctx) {
				throw new Error('Failed to create 2d context')
			}
			canvas.width = tileWidth
			canvas.height = tileHeight * tileCount

			await Promise.all(data.tiles.map(async (tile) => {
				const img = await this.#loadImage(new URL(tile.image, baseUrl).href)
				ctx.drawImage(img, 0, tileHeight * tile.id, tileWidth, tileHeight)
			}));

			const imageData = ctx.getImageData(0, 0, data.tilewidth, data.tileheight * data.tilecount)
			this.#createTexture(imageData, tileWidth, tileHeight, tileCount)
		} else {
			throw new Error('Invalid tileset')
		}
	}
}

class Level {
	constructor() {
		this.url = ''
		this.sizeX = 0
		this.sizeY = 0
		this.sizeZ = 0
		this.voxels = null
		this.texture = null
	}

	getVoxel(x, y, z) {
		x = Math.floor(x)
		y = Math.floor(y)
		z = Math.floor(z)

		if (x < 0 || y < 0 || z < 0 || x >= this.sizeX || y >= this.sizeY || z >= this.sizeZ) {
			return 0
		}

		return this.voxels[z * this.sizeY * this.sizeX + y * this.sizeX + x]
	}

	async load() {
		const response = await fetch(this.url)
		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`)
		}
		let data
		try {
			data = await response.json()
		}
		catch {
			throw new Error('Invalid level')
		}

		this.sizeX = data.width
		this.sizeY = data.height
		this.sizeZ = 3
		this.voxels = new Uint16Array(this.sizeX * this.sizeY * this.sizeZ)

		data.layers.forEach((layer) => {
			if (layer.type === 'tilelayer') {
				let layerIndex

				switch (layer.name) {
					case 'Floor':
						layerIndex = 0
						break
					case 'Walls':
						layerIndex = 1
						break
					case 'Ceiling':
						layerIndex = 2
						break
					default:
						console.log(`Unknown tilelayer name: ${layer.name}`)
						return
				}

				layer.data.forEach((value, index) => {
					const x = index % this.sizeX;
					const y = this.sizeY - Math.floor(index / this.sizeX) - 1;
					const z = layerIndex;
					const voxelIndex = z * this.sizeX * this.sizeY + y * this.sizeX + x;
					this.voxels[voxelIndex] = value;
				});

			} else if (layer.type === 'objectgroup') {
				for (const object of layer.objects) {
					const entity = Entity.deserialize(object)
					entity.pos[1] = this.sizeY - entity.pos[1]
					if (entity != null) {
						entities.push(entity)
					}
				}
			}
		})

		this.texture = gl.createTexture()
		gl.bindTexture(gl.TEXTURE_3D, this.texture)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

		gl.texImage3D(gl.TEXTURE_3D, 0, gl.RG8UI, this.sizeX, this.sizeY, this.sizeZ,
			0, gl.RG_INTEGER, gl.UNSIGNED_BYTE, new Uint8Array(this.voxels.buffer))
	}

	draw(mvpMatrix, modelMatrix) {
		gl.useProgram(terrainShader.program)
		gl.uniformMatrix4fv(terrainShader.mvpMatrixLocation, false, mvpMatrix)
		gl.uniformMatrix4fv(terrainShader.modelMatrixLocation, false, modelMatrix)
		gl.uniform3fv(terrainShader.cameraPositionLocation, cameraPosition)
		gl.activeTexture(gl.TEXTURE0)
		gl.bindTexture(gl.TEXTURE_3D, this.texture)
		gl.uniform1i(terrainShader.voxelsLocation, 0)
		gl.activeTexture(gl.TEXTURE1)
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, tileset.texture)
		gl.uniform1i(terrainShader.tilesLocation, 1)
		gl.drawArrays(gl.TRIANGLES, 0, 36)
	}
}

class Camera {
	constructor(fov = Math.PI / 3, aspect = 1, near = .1, far = 1000) {
		this.fov = fov
		this.aspect = aspect
		this.near = near
		this.far = far
		this.position = vec3.create()
		this.orientation = quat.create()
		this.pitch = 0
		this.worldMatrix = mat4.create()
		this.worldInverseMatrix = mat4.create()
		this.projectionMatrix = mat4.create()

		this.update()
	}

	updateWorldMatrix() {
		mat4.fromRotationTranslation(this.worldMatrix, this.orientation, this.position)
	}

	updateWorldInverseMatrix() {
		mat4.invert(this.worldInverseMatrix, this.worldMatrix)
	}

	updateProjectionMatrix() {
		mat4.perspective(this.projectionMatrix, Math.PI / 3, this.aspect, .1, 1000)
		mat4.rotateX(this.projectionMatrix, this.projectionMatrix, -Math.PI / 2)
	}

	update() {
		this.updateWorldMatrix()
		this.updateWorldInverseMatrix()
		this.updateProjectionMatrix()
	}
}


function createContext() {
	const canvas = document.createElement('canvas')
	canvas.width = window.innerWidth
	canvas.height = window.innerHeight

	viewport = [canvas.width, canvas.height]

	timeLabel = document.createElement('div')
	timeLabel.style.position = 'fixed'
	timeLabel.style.top = '0px'
	timeLabel.style.color = 'white'

	document.body.appendChild(canvas)
	document.body.appendChild(timeLabel)

	const gl = canvas.getContext('webgl2', { antialias: false, failIfMajorPerformanceCaveat: true })
	if (!gl) {
		throw new Error('Failed to create WebGL2 context')
	}

	window.addEventListener('resize', () => {
		canvas.width = window.innerWidth
		canvas.height = window.innerHeight
		viewport[0] = canvas.width
		viewport[1] = canvas.height
		gl.viewport(0, 0, canvas.width, canvas.height)
	})
	return gl
}

function respawn() {
	player.pos = vec3.create()
	player.vel = vec3.create()
	player.orientation = quat.create()
	cameraOrientation = quat.create()
	cameraPitch = 0
	player.gravity = true
	for (const e of entities) {
		if (e.type === EntityType.SPAWN) {
			vec3.copy(player.pos, e.pos)
			quat.copy(player.orientation, e.orientation)
			break
		}
	}
}

function setupUI() {
	Array.from(document.getElementsByClassName('bind-button')).forEach((button) => {
		button.textContent = settings.keybinds[button.id]
	});

	/** @type {HTMLInputElement} */
	(document.getElementById('invert-mouse')).checked = settings.invertMouse;

	const menu = document.getElementById('main-menu')

	let activeBinding = null

	menu.addEventListener('keyup', (event) => {
		event.stopPropagation()

		if (activeBinding) {
			event.preventDefault()
			activeBinding = null
		}
	})

	menu.addEventListener('keydown', (event) => {
		event.stopPropagation()

		if (!activeBinding) {
			return;
		}
		activeBinding.textContent = event.code;
		activeBinding.classList.remove('listening');
		settings.keybinds[activeBinding.id] = event.code;
		localStorage.setItem('gameSettings', JSON.stringify(settings))
	})

	menu.addEventListener('blur', (event) => {
		if (activeBinding && event.target == activeBinding) {
			activeBinding.textContent = settings.keybinds[activeBinding.id];
			activeBinding.classList.remove('listening');
			activeBinding = null;
		}
	}, true);

	menu.addEventListener('click', (event) => {
		event.stopPropagation();

		const button = /** @type {HTMLButtonElement} */ (event.target);
		if (button.classList?.contains('bind-button')) {
			activeBinding = button;
			activeBinding.classList.add('listening');
			activeBinding.textContent = 'Press a key...';
		}
	});

	if (showingMenu) {
		menu.hidden = false
	}

	document.addEventListener('keydown', onKeydown)

	document.addEventListener('keyup', (event) => {
		key_states.delete(event.code)
	})

	document.addEventListener('mousemove', (event) => {
		if (document.pointerLockElement) {
			mouseMoveX += event.movementX
			mouseMoveY += event.movementY
		}
	})

	document.addEventListener('click', () => {
		if (!document.pointerLockElement) {
			document.body.requestPointerLock()
		}
		if (showingMenu) {
			showingMenu = false
			menu.hidden = true
		}
	})

	document.addEventListener('visibilitychange', () => {
		lastTime = performance.now()
	})

	document.addEventListener('contextmenu', (event) => {
		event.preventDefault()
	})

	document.addEventListener('pointerlockchange', () => {
		if (!key_states.has('`')) {
			key_states.clear()
		}
	})
}

function onKeydown(event) {
	key_states.add(event.code)

	switch (event.code) {
		case 'Backquote': {
			const menu = document.getElementById('main-menu')
			showingMenu = !showingMenu
			menu.hidden = !showingMenu
			if (showingMenu) {
				document.exitPointerLock()
			} else {
				document.body.requestPointerLock()
			}
			break
		}
		case settings.keybinds.godMode: {
			godMode = !godMode
			break
		}
		case settings.keybinds.respawn: {
			respawn()
			break
		}
		default:
			break
	}
}

function processInput(elapsed) {
	const right = vec3.fromValues(1, 0, 0);
	vec3.transformQuat(right, right, cameraOrientation);

	const forward = vec3.fromValues(0, 1, 0);
	vec3.transformQuat(forward, forward, cameraOrientation);

	const up = vec3.fromValues(0, 0, 1);
	vec3.transformQuat(up, up, cameraOrientation);
	const speed = 10

	if (!godMode) {
		forward[2] = 0
		vec3.normalize(forward, forward)
		right[2] = 0
		vec3.normalize(right, right)
	} else {
		player.vel[2] = 0
	}

	player.vel[0] = 0
	player.vel[1] = 0

	if (key_states.has(settings.keybinds.forward)) {
		vec3.scaleAndAdd(player.vel, player.vel, forward, speed)
	}
	if (key_states.has(settings.keybinds.backward)) {
		vec3.scaleAndAdd(player.vel, player.vel, forward, -speed)
	}
	if (key_states.has(settings.keybinds.left)) {
		vec3.scaleAndAdd(player.vel, player.vel, right, -speed)
	}
	if (key_states.has(settings.keybinds.right)) {
		vec3.scaleAndAdd(player.vel, player.vel, right, speed)
	}
	if (godMode && key_states.has(settings.keybinds.up)) {
		vec3.scaleAndAdd(player.vel, player.vel, up, speed)
	}
	if (godMode && key_states.has(settings.keybinds.down)) {
		vec3.scaleAndAdd(player.vel, player.vel, up, -speed)
	}
	if (key_states.has(settings.keybinds.jump)) {
		if (player.gravity && !godMode && player.onGround(level)) {
			player.vel[2] += 5
		}
		key_states.delete(settings.keybinds.jump)
	}

	const dx = mouseMoveX
	const dy = settings.invertMouse ? -mouseMoveY : mouseMoveY

	const rotZ = quat.setAxisAngle(quat.create(), [0, 0, 1], -dx * elapsed / 2000)
	quat.multiply(player.orientation, player.orientation, rotZ)

	cameraPitch += dy * elapsed / 2000
	cameraPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraPitch))
	const rotX = quat.setAxisAngle(quat.create(), [1, 0, 0], cameraPitch)

	quat.multiply(cameraOrientation, player.orientation, rotX)

	mouseMoveX = 0
	mouseMoveY = 0
}

function draw() {
	gl.clearColor(.1, .1, .1, 1)
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
	gl.enable(gl.DEPTH_TEST)
	gl.enable(gl.CULL_FACE)
	gl.cullFace(gl.BACK)

	const viewMatrix = mat4.fromRotationTranslation(mat4.create(), cameraOrientation, cameraPosition)
	mat4.invert(viewMatrix, viewMatrix)

	// z-up
	const projectionMatrix = mat4.perspective(mat4.create(), Math.PI / 3, viewport[0] / viewport[1], .1, 1000)
	mat4.rotateX(projectionMatrix, projectionMatrix, -Math.PI / 2)

	const vp = mat4.multiply(mat4.create(), projectionMatrix, viewMatrix)
	level.draw(vp, mat4.create())

	for (const e of entities) {
		if (e.model) {
			const offsetMatrix = mat4.fromTranslation(mat4.create(), [-e.model.sizeX / 2, -e.model.sizeY / 2, 0])
			const modelMatrix = mat4.fromRotationTranslationScale(mat4.create(), e.orientation, e.pos, vec3.scale(vec3.create(), e.scale, 1 / 32))
			mat4.multiply(modelMatrix, modelMatrix, offsetMatrix)
			const mvp = mat4.multiply(mat4.create(), vp, modelMatrix)
			e.model.draw(mvp, modelMatrix)
		}
		e.animationFrame++
		if (e.animationFrame > 16) {
			if (e.model == models['fatta']) {
				e.model = models['fattb']
			} else if (e.model == models['fattb']) {
				e.model = models['fattc']
			} else if (e.model == models['fattc']) {
				e.model = models['fattd']
			} else if (e.model == models['fattd']) {
				e.model = models['fatta']
			}
			e.animationFrame = 0
		}
	}
}

function loop() {
	const elapsed = performance.now() - lastTime
	lastTime = performance.now()

	localStorage.setItem('gameState', JSON.stringify({
		playerPos: Array.from(player.pos),
		playerOrientation: Array.from(player.orientation),
		cameraPitch: cameraPitch,
		showingMenu: showingMenu,
		godMode: godMode
	}))

	processInput(elapsed)
	timeLabel.innerHTML = `cam_pos: ${cameraPosition[0].toFixed(2)}, ${cameraPosition[1].toFixed(2)}, ${cameraPosition[2].toFixed(2)}
		${godMode ? '<span style="color: #FFD700;">{ God Mode }</span>' : ' { Peon Mode }'}`


	for (const e of entities) {
		if (e.gravity && e.type != EntityType.PLAYER || !godMode) {
			if (!e.onGround(level)) {
				e.vel[2] -= 9.8 * elapsed / 1000
			}
		}

		if (vec3.length(e.vel) > 100) {
			vec3.normalize(e.vel, e.vel)
			vec3.scale(e.vel, e.vel, Math.min(vec3.length(e.vel), 100))
		}

		vec3.scaleAndAdd(e.pos, e.pos, e.vel, elapsed / 1000)

		if (e.type == EntityType.PLAYER && !godMode) {

			for (const ee of entities) {
				if (e == ee) {
					continue
				}
				if (ee.type == EntityType.SPAWN) {
					continue
				}

				const s = vec3.sub(vec3.create(), ee.pos, e.pos)
				const d = vec3.length(s)

				if (d < e.radius + ee.radius) {
					const pushback = e.radius + ee.radius - d
					const t = vec3.add(vec3.create(), s, e.vel)
					vec3.normalize(t, t)
					vec3.scaleAndAdd(e.pos, e.pos, t, -pushback)
					if (e.radius >= ee.radius) {
						vec3.scaleAndAdd(ee.pos, e.vel, t, pushback)
					}
				}

			}

			if (level.getVoxel(e.pos[0] + e.radius, e.pos[1], e.pos[2] + e.height / 2)) {
				e.pos[0] = Math.floor(e.pos[0] + e.radius) - e.radius
			}
			if (level.getVoxel(e.pos[0] - e.radius, e.pos[1], e.pos[2] + e.height / 2)) {
				e.pos[0] = Math.ceil(e.pos[0] - e.radius) + e.radius
			}
			if (level.getVoxel(e.pos[0], e.pos[1] + e.radius, e.pos[2] + e.height / 2)) {
				e.pos[1] = Math.floor(e.pos[1] + e.radius) - e.radius
			}
			if (level.getVoxel(e.pos[0], e.pos[1] - e.radius, e.pos[2] + e.height / 2)) {
				e.pos[1] = Math.ceil(e.pos[1] - e.radius) + e.radius
			}
			if (level.getVoxel(e.pos[0], e.pos[1], e.pos[2] + e.height)) {
				e.pos[2] = Math.floor(e.pos[2] + e.height) - e.height
				e.vel[2] = 0
			}
			if (level.getVoxel(e.pos[0], e.pos[1], e.pos[2])) {
				e.pos[2] = Math.ceil(e.pos[2])
				e.vel[2] = 0
			}
		}

		if (e.type === EntityType.PLAYER) {
			player = e
			vec3.copy(cameraPosition, e.pos)
			cameraPosition[2] += .8 * e.height
		}
	}

	draw()
	requestAnimationFrame(loop)
}

async function main() {
	player = new Entity()
	player.type = EntityType.PLAYER
	player.gravity = true
	player.height = .5
	player.radius = .25
	entities.push(player)

	let savedState = localStorage.getItem('gameState')
	if (savedState) {
		const state = JSON.parse(savedState)
		player.pos = vec3.fromValues(state.playerPos[0], state.playerPos[1], state.playerPos[2])
		player.orientation = quat.fromValues(state.playerOrientation[0], state.playerOrientation[1], state.playerOrientation[2], state.playerOrientation[3])
		cameraPitch = state.cameraPitch
		godMode = state.godMode
		showingMenu = state.showingMenu
	}

	let savedSettings = localStorage.getItem('gameSettings')
	if (savedSettings) {
		let obj = JSON.parse(savedSettings)
		if (obj.version === settings.version) {
			settings = obj
		} else {
			localStorage.setItem('gameSettings', JSON.stringify(settings))
		}
	}

	setupUI()
	gl = createContext()

	modelShader = new Shader(V_SRC, MODEL_F_SRC)
	terrainShader = new Shader(V_SRC, TERRAIN_F_SRC)

	let modelNames = [
		'player',
		'portal',
		'fatta',
		'fattb',
		'fattc',
		'fattd',
		'maze',
		'wall'
	]
	modelNames.forEach((model) => {
		models[model] = new Model(`./models/${model}.vox`);
	})

	tileset = new Tileset()
	tileset.url = './tilesets/dcss_tiles.tsj'

	level = new Level();
	level.url = './maps/test.tmj'

	await Promise.all([
		tileset.load(),
		level.load(),
		Object.values(models).map((model) => model.load())
	])

	respawn()

	requestAnimationFrame(loop)
}
main()
