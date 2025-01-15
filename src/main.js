import { mat4, quat, vec3 } from 'gl-matrix'
import { Peer } from 'peerjs'

import V_SRC from './shaders/V.glsl.js'
import MODEL_F_SRC from './shaders/model_F.glsl.js'
import TERRAIN_F_SRC from './shaders/terrain_F.glsl.js'

class Entity {
	/** @type {Entity[]} */
	static all = []
	static nextId = 1

	constructor() {
		this.id = 0
		/** @type {Entity} */
		this.parent = null
		/** @type {Entity[]} */
		this.children = []

		this.position = vec3.create()
		this.rotation = quat.create()
		this.scale = vec3.fromValues(1, 1, 1)
		this.transform = mat4.create()

		this.worldPosition = vec3.create()
		this.worldRotation = quat.create()
		this.worldScale = vec3.fromValues(1, 1, 1)
		this.worldTransform = mat4.create()

		/** @type {Model} */
		this.model = null
		this.model_id = -1
		this.frame = 0
		this.frame_time = 0
		this.animationFrame = 0

		this.height = 0
		this.radius = 0
		this.vel = vec3.create()
		this.gravity = false

		Entity.all.push(this)
	}

	/**
	 * 
	 * @param {mat4} parentTransform 
	 */
	updateTransform(parentTransform) {
		mat4.fromRotationTranslationScale(this.transform, this.rotation, this.position, this.scale)
		if (parentTransform) {
			mat4.multiply(this.worldTransform, parentTransform, this.transform)
		} else {
			mat4.copy(this.worldTransform, this.transform)
		}

		mat4.getTranslation(this.worldPosition, this.worldTransform);
		mat4.getRotation(this.worldRotation, this.worldTransform);
		mat4.getScaling(this.worldScale, this.worldTransform);

		for (const child of this.children) {
			child.updateTransform(this.worldTransform)
		}
	}

	/**
	 * 
	 * @param {*} data 
	 */
	static deserialize(data) {
		let entity

		switch (data.type.toUpperCase()) {
			case 'PLAYER':
				return null
			case 'SPAWN':
				entity = new Spawn()
				break
			default:
				entity = new Entity()
				break
		}

		entity.position = vec3.fromValues(data.x / 32, data.y / 32, 1)

		for (const property of data.properties ?? []) {
			switch (property.name) {
				case 'rotation':
					quat.fromEuler(entity.rotation, 0, 0, property.value)
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
		if (terrain.getVoxel(this.position[0], this.position[1], this.position[2] - Number.EPSILON)) {
			return true
		}
		if (terrain.getVoxel(this.position[0] + r, this.position[1], this.position[2] - Number.EPSILON)) {
			return true
		}
		if (terrain.getVoxel(this.position[0] - r, this.position[1], this.position[2] - Number.EPSILON)) {
			return true
		}
		if (terrain.getVoxel(this.position[0], this.position[1] + r, this.position[2] - Number.EPSILON)) {
			return true
		}
		if (terrain.getVoxel(this.position[0], this.position[1] - r, this.position[2] - Number.EPSILON)) {
			return true
		}
		return false
	}


	/** 
	 * @param {number} elapsed 
	 */
	update(elapsed) { }
}

class Camera extends Entity {
	constructor(fov = Math.PI / 3, aspect = 1, near = .1, far = 1000) {
		super()
		this.fov = fov
		this.aspect = aspect
		this.near = near
		this.far = far
		this.worldTransform = mat4.create()
		this.worldInverseMatrix = mat4.create()
		this.projectionMatrix = mat4.create()

	}

	updateWorldMatrix() {
		mat4.fromRotationTranslation(this.worldTransform, this.rotation, this.position)
	}

	updateWorldInverseMatrix() {
		mat4.invert(this.worldInverseMatrix, this.worldTransform)
	}

	updateProjectionMatrix() {
		this.aspect = renderer.viewport[0] / renderer.viewport[1]
		mat4.perspective(this.projectionMatrix, Math.PI / 3, this.aspect, .1, 1000)
		mat4.rotateX(this.projectionMatrix, this.projectionMatrix, -Math.PI / 2)
	}

	update() {
		mat4.invert(this.worldInverseMatrix, this.worldTransform)
		this.updateProjectionMatrix()
	}
}


class Player extends Entity {
	constructor(id = Entity.nextId++) {
		super()
		this.id = id
		this.gravity = true
		this.height = .5
		this.radius = .25
		this.model = models['player']
		/** @type {Entity} */
		this.head = new Entity()
		this.head.id = Entity.nextId++
		this.head.parent = this
		this.head.position = vec3.fromValues(0, 0, .8 * this.height)
		this.children.push(this.head)
	}
}

class Spawn extends Entity {
	constructor() {
		super()
		this.gravity = false
		this.height = 0
		this.radius = 0
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

		this.palette = new Uint8Array(dataView.buffer, 12 + numVoxels, 256 * 3).slice()
		for (let i = 0; i < this.palette.length; i++) {
			this.palette[i] = this.palette[i] << 2
		}

		renderer.createModelTexture(this)
	}
}

class Tileset {
	constructor(url = '') {
		this.url = url
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
			this.texture = renderer.createTextureArray(tileWidth, tileHeight, tileCount, img)
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
			this.texture = renderer.createTextureArray(tileWidth, tileHeight, tileCount, imageData)
		} else {
			throw new Error('Invalid tileset')
		}
	}
}

class Level {
	constructor(url = '') {
		this.url = url
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
					entity.position[1] = this.sizeY - entity.position[1]
					if (entity != null) {
						Entity.all.push(entity)
					}
				}
			}
		})

		renderer.createLevelTexture(this)
	}
}



class Renderer {
	constructor() {
		this.gl = null
		this.viewport = [0, 0]
		this.modelShader = null
		this.terrainShader = null
	}

	init() {
		this.createContext()
		this.modelShader = this.createProgram(V_SRC, MODEL_F_SRC)
		this.terrainShader = this.createProgram(V_SRC, TERRAIN_F_SRC)
	}

	createContext() {
		const canvas = document.createElement('canvas')
		canvas.width = window.innerWidth
		canvas.height = window.innerHeight

		this.viewport = [canvas.width, canvas.height]

		document.body.appendChild(canvas)


		this.gl = canvas.getContext('webgl2', { antialias: false, failIfMajorPerformanceCaveat: true })
		if (!this.gl) {
			throw new Error('Failed to create WebGL2 context')
		}

		window.addEventListener('resize', () => {
			canvas.width = window.innerWidth
			canvas.height = window.innerHeight
			this.viewport[0] = canvas.width
			this.viewport[1] = canvas.height
			this.gl.viewport(0, 0, canvas.width, canvas.height)
		})
	}

	createProgram(vertexSource, fragmentSource) {
		let gl = this.gl

		let vertexShader = gl.createShader(gl.VERTEX_SHADER)
		if (!vertexShader) {
			throw new Error('Error creating vertex shader')
		}
		gl.shaderSource(vertexShader, vertexSource)
		gl.compileShader(vertexShader)
		if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
			console.error('Error compiling shader:', gl.getShaderInfoLog(vertexShader))
		}

		let fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)
		if (!fragmentShader) {
			throw new Error('Error creating fragment shader')
		}
		gl.shaderSource(fragmentShader, fragmentSource)
		gl.compileShader(fragmentShader)
		if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
			console.error('Error compiling shader:', gl.getShaderInfoLog(fragmentShader))
		}

		const program = gl.createProgram()
		gl.attachShader(program, vertexShader)
		gl.attachShader(program, fragmentShader)
		gl.linkProgram(program)
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			console.error('Error linking program:', gl.getProgramInfoLog(program))
		}

		const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
		const uniforms = {}
		for (let i = 0; i < numUniforms; i++) {
			const info = gl.getActiveUniform(program, i);
			uniforms[info.name] = gl.getUniformLocation(program, info.name);
		}

		return { program, uniforms }
	}

	/**
	 * 
	 * @param {number} width 
	 * @param {number} height 
	 * @param {number} count 
	 * @param {HTMLImageElement | ImageData} source 
	 * @returns 
	 */
	createTextureArray(width, height, count, source) {
		const gl = this.gl
		const texture = gl.createTexture()
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture)
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT)
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT)
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
		gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, width, height, count, 0, gl.RGBA, gl.UNSIGNED_BYTE, source)
		return texture
	}

	createLevelTexture(level) {
		const gl = this.gl
		const texture = gl.createTexture()
		gl.bindTexture(gl.TEXTURE_3D, texture)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

		gl.texImage3D(gl.TEXTURE_3D, 0, gl.RG8UI, level.sizeX, level.sizeY, level.sizeZ, 0, gl.RG_INTEGER, gl.UNSIGNED_BYTE, new Uint8Array(level.voxels.buffer))
		level.texture = texture
	}

	drawLevel(level, mvpMatrix) {
		const gl = this.gl
		gl.useProgram(this.terrainShader.program)
		const uniforms = this.terrainShader.uniforms

		gl.uniformMatrix4fv(uniforms.mvpMatrix, false, mvpMatrix)
		gl.uniformMatrix4fv(uniforms.modelMatrix, false, mat4.create())
		gl.uniform3fv(uniforms.cameraPosition, camera.worldPosition)

		gl.activeTexture(gl.TEXTURE0)
		gl.bindTexture(gl.TEXTURE_3D, level.texture)
		gl.uniform1i(uniforms.voxels, 0)

		gl.activeTexture(gl.TEXTURE1)
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, tileset.texture)
		gl.uniform1i(uniforms.tiles, 1)
		gl.drawArrays(gl.TRIANGLES, 0, 36)
	}

	createModelTexture(model) {
		const gl = this.gl
		const texture = gl.createTexture()
		gl.bindTexture(gl.TEXTURE_3D, texture)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
		gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8UI, model.sizeX, model.sizeY, model.sizeZ, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, model.voxels)
		model.texture = texture
	}

	/**
	 * 
	 * @param {Model} model 
	 * @param {mat4} mvpMatrix 
	 * @param {mat4} modelMatrix 
	 */
	drawModel(model, mvpMatrix, modelMatrix) {
		const gl = this.gl
		gl.useProgram(this.modelShader.program)
		const uniforms = this.modelShader.uniforms

		gl.uniformMatrix4fv(uniforms.mvpMatrix, false, mvpMatrix)
		gl.uniformMatrix4fv(uniforms.modelMatrix, false, modelMatrix)
		gl.uniform3fv(uniforms.cameraPosition, camera.worldPosition)

		gl.activeTexture(gl.TEXTURE0)
		gl.bindTexture(gl.TEXTURE_3D, model.texture)
		gl.uniform1i(uniforms.voxels, 0)

		gl.uniform1uiv(uniforms['palette[0]'], new Uint32Array(model.palette.buffer))
		gl.drawArrays(gl.TRIANGLES, 0, 36)
	}

	draw() {
		const gl = this.gl
		gl.clearColor(.1, .1, .1, 1)
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
		gl.enable(gl.DEPTH_TEST)
		gl.enable(gl.CULL_FACE)
		gl.cullFace(gl.BACK)

		const viewMatrix = camera.worldInverseMatrix
		const projectionMatrix = camera.projectionMatrix

		const vp = mat4.multiply(mat4.create(), projectionMatrix, viewMatrix)
		this.drawLevel(level, vp)

		for (const e of Entity.all) {
			if (e.model && e !== player) {
				const offsetMatrix = mat4.fromTranslation(mat4.create(), [-e.model.sizeX / 2, -e.model.sizeY / 2, 0])
				const modelMatrix = mat4.fromRotationTranslationScale(mat4.create(), e.rotation, e.position, vec3.scale(vec3.create(), e.scale, 1 / 32))
				mat4.multiply(modelMatrix, modelMatrix, offsetMatrix)
				const mvp = mat4.multiply(mat4.create(), vp, modelMatrix)
				this.drawModel(e.model, mvp, modelMatrix)
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
}

const MessageType = {
	PLAYER_JOIN: 0,
	PLAYER_LEAVE: 1,
	CHAT: 2,
	ENTITY_UPDATE: 3,
}

class Net {
	constructor() {
		this.peer = null
		this.connections = []
		this.isHost = false
	}

	host(id) {
		this.peer = new Peer(id)
		this.isHost = true

		this.peer.on('open', (id) => {
			console.log('Host ID:', id)
		})

		this.peer.on('connection', (conn) => {
			this.connections.push(conn)
			conn.on('open', () => {
				conn.send('Hello!')
			})
			conn.on('data', (data) => {
				this.onData(conn, data)
			})
		})
	}

	join(hostid) {
		this.isHost = false
		this.peer = new Peer()
		this.peer.on('open', (id) => {
			console.log('Client ID:', id)
			const conn = this.peer.connect(hostid)
			conn.on('open', () => {
				conn.send({ msg: MessageType.PLAYER_JOIN })
			})
			conn.on('data', (data) => {
				this.onData(conn, data)
			})
		})
	}



	onData(conn, data) {
		switch (data.msg) {
			case MessageType.PLAYER_JOIN:
				console.log('Player joined')
				if (this.isHost) {
					for (const conn of this.connections) {
						conn.send(data)
					}
				}
				break
			case MessageType.PLAYER_LEAVE:
				break
			case MessageType.CHAT:
				break
			case MessageType.ENTITY_UPDATE:
				if (!this.isHost) {
					for (const e of Entity.all) {
						if (e.id === data.id) {
							e.position[0] = data.pos[0]
							e.position[1] = data.pos[1]
							e.position[2] = data.pos[2]
							e.rotation[0] = data.ori[0]
							e.rotation[1] = data.ori[1]
							e.rotation[2] = data.ori[2]
							e.rotation[3] = data.ori[3]
						}
					}
					break
				}
				break
		}
	}

	update() {
		if (!this.isHost) {
			return
		}

		for (const e of Entity.all) {
			if (e.id > 0) {
				for (const conn of this.connections) {
					conn.send({
						msg: MessageType.ENTITY_UPDATE,
						id: e.id,
						pos: [e.position[0], e.position[1], e.position[2]],
						ori: [e.rotation[0], e.rotation[1], e.rotation[2], e.rotation[3]]
					})
				}
			}
		}
	}
}


function respawn() {
	vec3.zero(player.position)
	vec3.zero(player.vel)
	quat.identity(player.rotation)
	quat.identity(player.head.rotation)

	for (const e of Entity.all) {
		if (e instanceof Spawn) {
			vec3.copy(player.position, e.position)
			quat.copy(player.rotation, e.rotation)
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
			return
		}

		if (button.id === 'host') {
			net.isHost = true
			const hostId = /** @type {HTMLInputElement} */ (document.getElementById('hostid')).value
			net.host(hostId)
		}

		if (button.id === 'join') {
			const hostId = /** @type {HTMLInputElement} */ (document.getElementById('hostid')).value
			net.join(hostId)
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

	timeLabel = document.createElement('div')
	timeLabel.style.position = 'fixed'
	timeLabel.style.top = '0px'
	timeLabel.style.color = 'white'
	document.body.appendChild(timeLabel)
}

function onKeydown(event) {
	key_states.add(event.code)

	switch (event.code) {
		case 'Backquote': {
			showingMenu = !showingMenu
			document.getElementById('main-menu').hidden = !showingMenu
			if (showingMenu) {
				document.exitPointerLock()
			} else {
				document.body.requestPointerLock()
			}
			break
		}
		case 'Escape': {
			if (showingMenu) {
				showingMenu = false
				document.getElementById('main-menu').hidden = true
				setTimeout(() => document.body.requestPointerLock(), 150)
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
	vec3.transformQuat(right, right, player.rotation);

	const forward = vec3.fromValues(0, 1, 0);
	vec3.transformQuat(forward, forward, player.rotation);

	const up = vec3.fromValues(0, 0, 1);
	vec3.transformQuat(up, up, player.rotation);
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

	quat.rotateZ(player.rotation, player.rotation, -dx * elapsed / 1000)
	quat.rotateX(player.head.rotation, player.head.rotation, dy * elapsed / 1000)

	const angle = quat.getAxisAngle(vec3.create(), player.head.rotation)
	if (angle > Math.PI / 2) {
		if (dy > 0) {
			quat.setAxisAngle(player.head.rotation, vec3.fromValues(1, 0, 0), Math.PI / 2)
		} else {
			quat.setAxisAngle(player.head.rotation, vec3.fromValues(1, 0, 0), -Math.PI / 2)
		}

	}

	mouseMoveX = 0
	mouseMoveY = 0
}

function loop() {
	const elapsed = performance.now() - lastTime
	lastTime = performance.now()

	localStorage.setItem('gameState', JSON.stringify({
		playerPos: Array.from(player.position),
		playerOrientation: Array.from(player.rotation),
		playerHeadRotation: Array.from(player.head.rotation),
		showingMenu: showingMenu,
		godMode: godMode
	}))

	timeLabel.innerHTML = `cam_pos: ${camera.position[0].toFixed(2)}, ${camera.position[1].toFixed(2)}, ${camera.position[2].toFixed(2)}
		${godMode ? '<span style="color: #FFD700;">{ God Mode }</span>' : ' { Peon Mode }'}`

	processInput(elapsed)

	for (const e of Entity.all) {
		e.update(elapsed)
		if (e.gravity && !(e instanceof Player && godMode)) {
			if (!e.onGround(level)) {
				e.vel[2] -= 9.8 * elapsed / 1000
			}
		}

		if (vec3.length(e.vel) > 100) {
			vec3.normalize(e.vel, e.vel)
			vec3.scale(e.vel, e.vel, Math.min(vec3.length(e.vel), 100))
		}
		vec3.scaleAndAdd(e.position, e.position, e.vel, elapsed / 1000)

		if (e instanceof Player && !godMode) {
			for (const ee of Entity.all) {
				if (e == ee) {
					continue
				}
				if (ee instanceof Spawn) {
					continue
				}

				if (ee === e.head) {
					continue
				}
				const s = vec3.sub(vec3.create(), ee.position, e.position)
				const d = vec3.length(s)

				if (d < e.radius + ee.radius) {
					const pushback = e.radius + ee.radius - d
					const t = vec3.add(vec3.create(), s, e.vel)
					vec3.normalize(t, t)
					vec3.scaleAndAdd(e.position, e.position, t, -pushback)
					if (e.radius >= ee.radius) {
						vec3.scaleAndAdd(ee.position, e.vel, t, pushback)
					}
				}

			}

			if (level.getVoxel(e.position[0] + e.radius, e.position[1], e.position[2] + e.height / 2)) {
				e.position[0] = Math.floor(e.position[0] + e.radius) - e.radius
			}
			if (level.getVoxel(e.position[0] - e.radius, e.position[1], e.position[2] + e.height / 2)) {
				e.position[0] = Math.ceil(e.position[0] - e.radius) + e.radius
			}
			if (level.getVoxel(e.position[0], e.position[1] + e.radius, e.position[2] + e.height / 2)) {
				e.position[1] = Math.floor(e.position[1] + e.radius) - e.radius
			}
			if (level.getVoxel(e.position[0], e.position[1] - e.radius, e.position[2] + e.height / 2)) {
				e.position[1] = Math.ceil(e.position[1] - e.radius) + e.radius
			}
			if (level.getVoxel(e.position[0], e.position[1], e.position[2] + e.height)) {
				e.position[2] = Math.floor(e.position[2] + e.height) - e.height
				e.vel[2] = 0
			}
			if (level.getVoxel(e.position[0], e.position[1], e.position[2])) {
				e.position[2] = Math.ceil(e.position[2])
				e.vel[2] = 0
			}
		}
	}

	for (const e of Entity.all) {
		if (!e.parent) {
			e.updateTransform(null)
		}
	}

	camera.update()
	renderer.draw()
	net.update()
	requestAnimationFrame(loop)
}

async function main() {
	camera.parent = player.head
	player.head.children.push(camera)

	let savedState = localStorage.getItem('gameState')
	if (savedState) {
		const state = JSON.parse(savedState)
		player.position = vec3.fromValues(state.playerPos[0], state.playerPos[1], state.playerPos[2])
		player.rotation = quat.fromValues(state.playerOrientation[0], state.playerOrientation[1], state.playerOrientation[2], state.playerOrientation[3])
		player.head.rotation = state.playerHeadRotation
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
	renderer.init()

	await Promise.all([
		tileset.load(),
		level.load(),
		...Object.values(models).map((model) => model.load())
	])

	requestAnimationFrame(loop)
}


let lastTime = 0
let timeLabel

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

const models = Object.fromEntries(
	[
		'player',
		'portal',
		'fatta',
		'fattb',
		'fattc',
		'fattd',
		'maze',
		'wall',
	].map((model) => [model, new Model(`./models/${model}.vox`)])
)

let tileset = new Tileset('./tilesets/dcss_tiles.tsj')
let level = new Level('./maps/test.tmj');
let player = new Player()

const renderer = new Renderer()
const camera = new Camera()
let net = new Net()

main()