import { mat4, quat, vec3 } from 'gl-matrix'
import { Peer } from 'peerjs'

class Entity {
	/** @type {Entity[]} */ static all = []
	static nextId = 1

	id = 0
	/** @type {Entity} */ parent = null
	/** @type {Entity[]} */ children = []

	dirty = true
	localPosition = vec3.create()
	localRotation = quat.create()
	localScale = vec3.fromValues(1, 1, 1)
	localToWorldTransform = mat4.create()

	worldPosition = vec3.create()
	worldRotation = quat.create()
	worldScale = vec3.fromValues(1, 1, 1)
	worldToLocalTransform = mat4.create()

	/** @type {Model} */ model = null
	model_id = -1
	frame = 0
	frame_time = 0
	animationFrame = 0

	height = 0
	radius = 0
	vel = vec3.create()
	gravity = false
	collision = false
	spawn = false

	constructor() {
		Entity.all.push(this)
	}

	/**
	 * 
	 * @param {mat4} parentTransform 
	 */
	updateTransforms(parentTransform) {
		if (this.dirty) {
			mat4.fromRotationTranslationScale(this.localToWorldTransform, this.localRotation, this.localPosition, this.localScale)

			if (parentTransform) {
				mat4.multiply(this.localToWorldTransform, parentTransform, this.localToWorldTransform)
			}

			mat4.getTranslation(this.worldPosition, this.localToWorldTransform)
			mat4.getRotation(this.worldRotation, this.localToWorldTransform)
			mat4.getScaling(this.worldScale, this.localToWorldTransform)
			this.dirty = false
		}

		for (const child of this.children) {
			child.dirty = true
			child.updateTransforms(this.localToWorldTransform)
		}
	}

	/**
	 * 
	 * @param {*} data
	 * @returns {Entity}
	 */
	static deserialize(data) {
		let entity

		switch (data.type.toUpperCase()) {
			case 'PLAYER':
				return null
			case 'SPAWN':
				entity = new Entity()
				entity.spawn = true
				entity.model = models['spawn']
				break
			default:
				entity = new Entity()
				break
		}

		entity.localPosition = vec3.fromValues(data.x / 32, data.y / 32, 1)

		for (const property of data.properties ?? []) {
			switch (property.name) {
				case 'rotation':
					quat.fromEuler(entity.localRotation, 0, 0, property.value)
					break
				case 'scale':
					entity.localScale = vec3.fromValues(property.value, property.value, property.value)
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
		let x = this.worldPosition[0]
		let y = this.worldPosition[1]
		let z = this.worldPosition[2] - Number.EPSILON

		return terrain.volume.getVoxelFloor(x, y, z) ||
			terrain.volume.getVoxelFloor(x + r, y, z) ||
			terrain.volume.getVoxelFloor(x - r, y, z) ||
			terrain.volume.getVoxelFloor(x, y + r, z) ||
			terrain.volume.getVoxelFloor(x, y - r, z)
	}


	/** 
	 * @param {number} elapsed 
	 */
	update(elapsed) { }
}

class Camera {
	static main = new Camera()

	/** @type {Entity} */
	entity = null

	fov = Math.PI / 3
	aspect = 1
	near = .001
	far = 1000
	projection = mat4.create()
	view = mat4.create()

	update() {
		this.aspect = renderer.viewport[0] / renderer.viewport[1]
		mat4.perspective(this.projection, this.fov, this.aspect, this.near, this.far)
		mat4.rotateX(this.projection, this.projection, -Math.PI / 2)
		mat4.invert(this.view, this.entity.localToWorldTransform)
	}
}

class Player extends Entity {
	gravity = true
	height = .5
	radius = .25
	model = models['player']
	head = new Entity()

	constructor(id = Entity.nextId++) {
		super()
		this.id = id
		this.head.id = Entity.nextId++
		this.head.parent = this
		this.head.localPosition = vec3.fromValues(0, 0, .8 * this.height)
		this.children.push(this.head)
	}

	respawn() {
		vec3.zero(this.localPosition)
		vec3.zero(this.vel)
		quat.identity(this.localRotation)
		quat.identity(this.head.localRotation)
		this.dirty = true

		for (const e of Entity.all) {
			if (e.spawn) {
				vec3.copy(this.localPosition, e.worldPosition)
				quat.copy(this.localRotation, e.worldRotation)
				break
			}
		}
	}
}


class Model {
	constructor(url = '') {
		this.url = url
	}

	async load() {
		const response = await fetch(this.url)
		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`)
		}
		if (response.headers.get('Content-Type') === 'text/html') {
			throw new Error('Invalid model: ' + this.url)
		}

		const buffer = await response.arrayBuffer()
		const dataView = new DataView(buffer)

		let sizeX = dataView.getInt32(0, true)
		let sizeY = dataView.getInt32(4, true)
		let sizeZ = dataView.getInt32(8, true)

		this.volume = new Volume(sizeX, sizeY, sizeZ, 255)

		const numVoxels = sizeX * sizeY * sizeZ
		const sourceVoxels = new Uint8Array(dataView.buffer, 12, numVoxels)

		// Transform from [x][y][z] to [z][y][x]
		for (let x = 0; x < sizeX; x++) {
			for (let y = 0; y < sizeY; y++) {
				for (let z = 0; z < sizeZ; z++) {
					const srcIdx = x * sizeY * sizeZ + y * sizeZ + z
					this.volume.setVoxel(x, sizeY - y - 1, sizeZ - z - 1, sourceVoxels[srcIdx])
				}
			}
		}

		this.palette = new Uint8Array(256 * 4)

		for (let i = 0; i < 256; i++) {
			this.palette[i * 4 + 0] = dataView.getUint8(12 + numVoxels + i * 3 + 0) << 2
			this.palette[i * 4 + 1] = dataView.getUint8(12 + numVoxels + i * 3 + 1) << 2
			this.palette[i * 4 + 2] = dataView.getUint8(12 + numVoxels + i * 3 + 2) << 2
			this.palette[i * 4 + 3] = 255
		}

		renderer.registerModel(this)
	}
}

class Tileset {
	tileWidth = 0
	tileHeight = 0
	numTiles = 0
	imageData = null
	texture = null

	constructor(url = '') {
		this.url = url
	}

	/**
	 * @param {string} url
	 * @returns {Promise<HTMLImageElement>}
	 */
	async #loadImage(url) {
		return new Promise((resolve, reject) => {
			const img = new Image()
			img.src = url
			img.onload = () => resolve(img)
			img.onerror = reject
		})
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
		const numTiles = data.tilecount

		const baseUrl = new URL(this.url, window.location.href).href

		const canvas = document.createElement('canvas')
		canvas.width = tileWidth
		canvas.height = tileHeight * numTiles
		const ctx = canvas.getContext('2d')

		if (!ctx) {
			throw new Error('Failed to create 2d context')
		}
		if (data.image) {
			const img = await this.#loadImage(new URL(data.image, baseUrl).href)
			ctx.drawImage(img, 0, 0)
		} else if (data.tiles) {
			await Promise.all(data.tiles.map(async (tile) => {
				const img = await this.#loadImage(new URL(tile.image, baseUrl).href)
				ctx.drawImage(img, 0, tileHeight * tile.id, tileWidth, tileHeight)
			}))
		} else {
			throw new Error('Invalid tileset')
		}

		this.imageData = ctx.getImageData(0, 0, tileWidth, tileHeight * numTiles)
		this.tileWidth = tileWidth
		this.tileHeight = tileHeight
		this.numTiles = numTiles
		renderer.registerTileset(this)
	}
}

class Level {
	url = ''
	/** @type {Volume} */
	volume = null
	buffer = null
	bindGroup = null



	constructor(url = '') {
		this.url = url
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

		let sizeX = data.width
		let sizeY = data.height
		let sizeZ = 3

		this.volume = new Volume(sizeX, sizeY, sizeZ, { emptyValue: 0, arrayType: Uint16Array })


		for (const layer of data.layers) {
			if (layer.type === 'tilelayer') {
				const layerIndex = ['Floor', 'Walls', 'Ceiling'].indexOf(layer.name)
				if (layerIndex === -1) {
					console.log(`Unknown tilelayer name: ${layer.name}`)
					continue
				}
				for (let i = 0; i < layer.data.length; i++) {
					const x = i % sizeX
					const y = sizeY - Math.floor(i / sizeX) - 1
					const z = layerIndex
					this.volume.setVoxel(x, y, z, layer.data[i])
				}
			} else if (layer.type === 'objectgroup') {
				for (const object of layer.objects) {
					for (let i = 0; i < 1; i++) {
						const entity = Entity.deserialize(object)
						entity.localPosition[1] = sizeY - entity.localPosition[1]
						entity.localPosition[0] += .5 + 2 * i
					}
				}
			}
		}

		renderer.registerLevel(this)
	}
}

class Renderer {
	/** @type {number} */ RENDERMODE = 0
    /** @type {GPUDevice} */ device = null;
    /** @type {GPUCanvasContext} */ context = null;
    /** @type {number[]} */ viewport = [0, 0];

	shaders = {}
	/** @type {GPUBindGroupLayout} */ bindGroupLayout = null;
	/** @type {GPUBindGroup} */ bindGroup = null;
    /** @type {GPURenderPipeline} */ terrainPipeline = null;
    /** @type {GPURenderPipeline} */ modelPipeline = null;
    /** @type {GPUTexture} */ depthTexture = null;
    /** @type {GPUBuffer} */ frameUniforms = null;
	/** @type {GPUBuffer} */ objectUniforms = null;
	/** @type {number} */ objectUniformsOffset = 0;
    /** @type {GPUTexture} */ paletteTexture = null;
    /** @type {ArrayBuffer} */ transferBuffer = null;
    /** @type {Float32Array} */ floatView = null;
    /** @type {Uint32Array} */ uintView = null;
	/** @type {number} */ nextPaletteIndex = 0;
	/** @type {GPUSampler} */ tileSampler = null;
	resourceMap = new Map()

	async init() {
		if (!navigator.gpu) {
			throw new Error('WebGPU not supported')
		}
		const adapter = await navigator.gpu.requestAdapter()
		if (!adapter) {
			throw new Error('No GPU adapter found')
		}
		this.device = await adapter.requestDevice({
			requiredFeatures: ['timestamp-query']
		})
		const canvas = document.createElement('canvas')
		canvas.width = window.innerWidth
		canvas.height = window.innerHeight
		document.body.appendChild(canvas)
		this.viewport = [canvas.width, canvas.height]
		this.context = canvas.getContext('webgpu')
		this.context.configure({
			device: this.device,
			format: navigator.gpu.getPreferredCanvasFormat(),
			alphaMode: 'premultiplied',
		})

		// Handle window resizing
		window.addEventListener('resize', () => {
			// Update canvas size
			canvas.width = window.innerWidth
			canvas.height = window.innerHeight
			this.viewport = [canvas.width, canvas.height]

			// Recreate depth texture for new size
			this.createDepthTexture()

			// Reconfigure context
			this.context.configure({
				device: this.device,
				format: navigator.gpu.getPreferredCanvasFormat(),
				alphaMode: 'opaque',
			})

			// Update camera aspect ratio
			if (camera) {
				camera.aspect = this.viewport[0] / this.viewport[1]
				mat4.perspective(camera.projection, camera.fov, camera.aspect, camera.near, camera.far)
			}
		})

		this.createDepthTexture()
		this.frameUniforms = this.device.createBuffer({
			size: 256,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		})
		this.objectUniforms = this.device.createBuffer({
			size: (256) * 100000,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		})
		this.transferBuffer = new ArrayBuffer(256 * 100000)
		this.paletteTexture = this.device.createTexture({
			format: 'rgba8unorm',
			size: [256, 256, 1],
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		})
		this.tileSampler = this.device.createSampler({
			magFilter: 'nearest',
			minFilter: 'nearest',
			addressModeU: 'repeat',
			addressModeV: 'repeat',
			addressModeW: 'repeat',
		})

		this.frameTimes = []
		this.lastTimePrint = performance.now()
		this.querySet = this.device.createQuerySet({
			type: "timestamp",
			count: 2,
		})
		this.queryResolve = this.device.createBuffer({
			size: 16, // 2 * 8-byte timestamps
			usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
		})
		this.queryResult = this.device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		})
		await this.compileShaders()
		const shader = this.shaders[['dda', 'quads', 'slices'][this.RENDERMODE]]

		this.createBindGroupLayout()
		this.createPipelines(shader)
	}

	async compileShaders() {
		const sources = await this.loadShaderSources()
		const modules = {}
		const results = []

		for (const name in sources) {
			const module = this.device.createShaderModule({
				label: name,
				code: sources[name],
			})
			results.push(module.getCompilationInfo().then(info => {
				for (const message of info.messages) {
					console.log(message)
				}
			}))
			modules[name] = module
		}
		Promise.all(results).then(() => console.log('All shader modules compiled'))
		this.shaders = modules
	}


	async loadShaderSources() {
		const shaders = {}
		const shaderModules = import.meta.glob('./shaders/*.wgsl', { as: 'raw' })

		for (const path in shaderModules) {
			const name = path.split('/').pop().replace('.wgsl', '')
			shaders[name] = await shaderModules[path]()
		}

		return shaders
	}

	createBindGroupLayout() {
		/** @type {GPUBindGroupLayoutDescriptor} */const bindGroupDescriptor = {
			label: 'common',
			entries: [
				// frame uniforms
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: {
						type: 'uniform',
					}
				},
				// object uniforms
				{
					binding: 1,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: {
						type: 'uniform',
						hasDynamicOffset: true,
					}
				},
				// voxels
				{
					binding: 2,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: 'uint',
						viewDimension: '3d',
					}
				},
				// palette
				{
					binding: 3,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: 'float',
						viewDimension: '2d',
					}
				},
				// tiles
				{
					binding: 4,
					visibility: GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: 'float',
						viewDimension: '2d-array',
					}
				},
				// tile sampler
				{
					binding: 5,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: {
						type: 'non-filtering',
					}
				},
			]
		}


		if (this.RENDERMODE === 0) {
			bindGroupDescriptor.entries = [...bindGroupDescriptor.entries, {
				binding: 6,
				visibility: GPUShaderStage.FRAGMENT,
				texture: {
					sampleType: 'uint',
					viewDimension: '3d',
				}
			},
			{
				binding: 7,
				visibility: GPUShaderStage.FRAGMENT,
				buffer: {
					type: 'read-only-storage',
				}
			}]
		}

		this.bindGroupLayout = this.device.createBindGroupLayout(bindGroupDescriptor)
	}

	createPipelines(shader) {
		/** @type {GPURenderPipelineDescriptor} */ let terrainPipelineDescriptor
		/** @type {GPURenderPipelineDescriptor} */ let modelPipelineDescriptor

		switch (this.RENDERMODE) {
			case 0:
			case 2:
				terrainPipelineDescriptor = {
					layout: this.device.createPipelineLayout({
						bindGroupLayouts: [this.bindGroupLayout]
					}),
					vertex: {
						module: shader,
						entryPoint: 'vs_main',
					},
					fragment: {
						module: shader,
						entryPoint: 'fs_textured',
						targets: [
							{
								format: navigator.gpu.getPreferredCanvasFormat(),
							}
						],
					},
					primitive: {
						topology: 'triangle-list',
						cullMode: 'back',
					},
					depthStencil: {
						format: 'depth24plus',
						depthWriteEnabled: true,
						depthCompare: 'less',
					},
				}
				modelPipelineDescriptor = {
					layout: this.device.createPipelineLayout({
						bindGroupLayouts: [this.bindGroupLayout]
					}),
					vertex: {
						module: shader,
						entryPoint: 'vs_main',
					},
					fragment: {
						module: shader,
						entryPoint: 'fs_model',
						targets: [
							{
								format: navigator.gpu.getPreferredCanvasFormat(),
							}
						],

					},
					primitive: {
						topology: 'triangle-list',
						cullMode: 'back',
					},
					depthStencil: {
						format: 'depth24plus',
						depthWriteEnabled: true,
						depthCompare: 'less',
					},
				}
				break
			case 1:
				terrainPipelineDescriptor = {
					label: 'terrain-cubes',
					layout: this.device.createPipelineLayout({
						bindGroupLayouts: [this.bindGroupLayout]
					}),
					vertex: {
						module: shader,
						entryPoint: 'vs_main',
						buffers: [
							{
								arrayStride: 4,
								stepMode: 'instance',
								attributes: [
									{
										shaderLocation: 0,
										offset: 0,
										format: 'uint8x4'
									}
								]
							}
						]
					},
					fragment: {
						module: shader,
						entryPoint: 'fs_textured',
						targets: [
							{
								format: navigator.gpu.getPreferredCanvasFormat(),
							}
						],
					},
					primitive: {
						topology: 'triangle-list',
						cullMode: 'back',
						frontFace: 'ccw',
					},
					depthStencil: {
						format: this.depthTexture.format,
						depthWriteEnabled: true,
						depthCompare: 'less',
					},
				}
				modelPipelineDescriptor = {
					label: 'model-cubes',
					layout: this.device.createPipelineLayout({
						bindGroupLayouts: [this.bindGroupLayout]
					}),
					vertex: {
						module: shader,
						entryPoint: 'vs_main',
						buffers: [
							{
								arrayStride: 4,
								stepMode: 'instance',
								attributes: [
									{
										shaderLocation: 0,
										offset: 0,
										format: 'uint8x4'
									}
								]
							}
						],
					},
					fragment: {
						module: shader,
						entryPoint: 'fs_model',
						targets: [
							{
								format: navigator.gpu.getPreferredCanvasFormat(),
							}
						],
					},
					primitive: {
						topology: 'triangle-list',
						cullMode: 'back',
						frontFace: 'ccw',
					},
					depthStencil: {
						format: this.depthTexture.format,
						depthWriteEnabled: true,
						depthCompare: 'less',

					},
				}
				break
		}

		this.terrainPipeline = this.device.createRenderPipeline(terrainPipelineDescriptor)
		this.modelPipeline = this.device.createRenderPipeline(modelPipelineDescriptor)
	}

	/**
	 * @param {Model} model
	 */
	registerModel(model) {

		let volume = model.volume
		const resources = this.resourceMap.get(model) || {}

		resources.texture = this.device.createTexture({
			size: [volume.sizeX, volume.sizeY, volume.sizeZ],
			dimension: '3d',
			format: 'r8uint',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			mipLevelCount: 1,
		})
		this.device.queue.writeTexture(
			{
				texture: resources.texture,
				mipLevel: 0
			},
			volume.voxels,
			{
				bytesPerRow: volume.sizeX,
				rowsPerImage: volume.sizeY
			},
			[volume.sizeX, volume.sizeY, volume.sizeZ]
		)

		this.device.queue.writeTexture(
			{
				texture: this.paletteTexture,
				aspect: 'all',
				origin: [0, this.nextPaletteIndex, 0],
				mipLevel: 0,
			},
			model.palette, {
			bytesPerRow: 256 * 4,
		}, [255, 1, 1]
		)
		resources.paletteIndex = this.nextPaletteIndex++

		if (this.RENDERMODE == 0) {
			const accelerationData = this.generateAccelerationData(volume.voxels, volume.sizeX, volume.sizeY, volume.sizeZ)
			let regionSizeX = volume.sizeX + 3 >> 2
			let regionSizeY = volume.sizeY + 3 >> 2
			let regionSizeZ = volume.sizeZ + 1 >> 1

			resources.acceleration = this.device.createTexture({
				size: [regionSizeX, regionSizeY, regionSizeZ],
				dimension: '3d',
				format: 'r32uint',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			})

			const accelerationData2 = this.generateAccelerationData(volume.voxels, volume.sizeX, volume.sizeY, volume.sizeZ)
			resources.accelerateBuffer = this.device.createBuffer({
				size: accelerationData2.byteLength,
				usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE,
			})
			this.device.queue.writeBuffer(resources.accelerateBuffer, 0, accelerationData2)

			this.device.queue.writeTexture(
				{ texture: resources.acceleration },
				accelerationData,
				{
					bytesPerRow: regionSizeX * 4,
					rowsPerImage: regionSizeY,
				},
				{
					width: regionSizeX,
					height: regionSizeY,
					depthOrArrayLayers: regionSizeZ
				}
			)
		}

		if (model.url.includes('box_frame')) {
			greedyMesh(volume.voxels, volume.sizeX, volume.sizeY, volume.sizeZ, volume.emptyValue)
		}

		if (this.RENDERMODE == 1) {
			const faces = model.volume.generateFaces()
			resources.rasterBuffer = this.device.createBuffer({
				size: faces.byteLength,
				usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
			})
			this.device.queue.writeBuffer(resources.rasterBuffer, 0, faces)
		}

		this.resourceMap.set(model, resources)
	}

	generateAccelerationData(voxels, sizeX, sizeY, sizeZ) {
		const regionSizeX = sizeX + 3 >> 2
		const regionSizeY = sizeY + 3 >> 2
		const regionSizeZ = sizeZ + 1 >> 1
		const data = new Uint32Array(regionSizeX * regionSizeY * regionSizeZ)

		for (let z = 0; z < sizeZ; z++) {
			for (let y = 0; y < sizeY; y++) {
				for (let x = 0; x < sizeX; x++) {
					const voxel = voxels[z * sizeY * sizeX + y * sizeX + x]
					if (voxel !== 255) {
						const regionX = x >> 2
						const regionY = y >> 2
						const regionZ = z >> 1
						const localX = x & 3
						const localY = y & 3
						const localZ = z & 1
						const bitIndex = localX + (localY * 4) + (localZ * 16)
						const regionIndex = regionZ * regionSizeY * regionSizeX +
							regionY * regionSizeX + regionX
						data[regionIndex] |= 1 << bitIndex
					}
				}
			}
		}
		return data
	}

	generateAccelerationDataZ(voxels, sizeX, sizeY, sizeZ) {
		function expandBits(x) {
			// Take a 10-bit number and spread its bits out to 30 bits
			x = x & 0x3FF                   // Get lowest 10 bits
			x = (x | (x << 16)) & 0xFF0000FF    // 0000 0000 1111 1111 0000 0000 1111 1111
			x = (x | (x << 8)) & 0x0F00F00F    // 0000 1111 0000 0000 1111 0000 0000 1111
			x = (x | (x << 4)) & 0xC30C30C3    // 1100 0011 0000 1100 0011 0000 1100 0011
			x = (x | (x << 2)) & 0x49249249    // 0100 1001 0010 0100 1001 0010 0100 1001
			return x
		}


		function mortonEncode(x, y, z) {
			return (expandBits(x) |
				(expandBits(y) << 1) |
				(expandBits(z) << 2)) >>> 0
		}

		const regionSizeX = sizeX + 3 >> 2
		const regionSizeY = sizeY + 3 >> 2
		const regionSizeZ = sizeZ + 1 >> 1
		const data = new Uint32Array(mortonEncode(regionSizeX - 1, regionSizeY - 1, regionSizeZ - 1))




		for (let z = 0; z < sizeZ; z++) {
			for (let y = 0; y < sizeY; y++) {
				for (let x = 0; x < sizeX; x++) {
					const voxel = voxels[z * sizeY * sizeX + y * sizeX + x]
					if (voxel !== 255) {
						const regionX = x >> 2
						const regionY = y >> 2
						const regionZ = z >> 1
						const localX = x & 3
						const localY = y & 3
						const localZ = z & 1
						const bitIndex = localX + (localY * 4) + (localZ * 16)
						const regionIndex = mortonEncode(regionX, regionY, regionZ)
						data[regionIndex] |= 1 << bitIndex
					}
				}
			}
		}
		return data
	}

	/**
	 * @param {Tileset} tileset
	 */
	registerTileset(tileset) {
		const width = tileset.tileWidth
		const height = tileset.tileHeight
		const count = tileset.numTiles

		const texture = this.device.createTexture({
			size: [width, height, count],
			format: 'rgba8unorm',
			dimension: '2d',
			usage: GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_DST |
				GPUTextureUsage.RENDER_ATTACHMENT
		})

		this.device.queue.writeTexture(
			{ texture },
			tileset.imageData.data,
			{
				bytesPerRow: width * 4,
				rowsPerImage: height
			},
			[width, height, count]
		)
		tileset.texture = texture
	}

	/**
	 * 
	 * @param {Level} level 
	 */
	registerLevel(level) {
		let volume = level.volume
		const resources = this.resourceMap.get(level) || {}
		resources.texture = this.device.createTexture({
			size: [volume.sizeX, volume.sizeY, volume.sizeZ],
			dimension: '3d',
			format: 'r16uint',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
		})
		this.device.queue.writeTexture(
			{ texture: resources.texture },
			volume.voxels,
			{
				bytesPerRow: volume.sizeX * 2,
				rowsPerImage: volume.sizeY
			},
			[volume.sizeX, volume.sizeY, volume.sizeZ]
		)

		if (this.RENDERMODE == 0) {
			const accelerationData = this.generateAccelerationData(volume.voxels, volume.sizeX, volume.sizeY, volume.sizeZ)
			let regionSizeX = volume.sizeX + 3 >> 2
			let regionSizeY = volume.sizeY + 3 >> 2
			let regionSizeZ = volume.sizeZ + 1 >> 1

			resources.acceleration = this.device.createTexture({
				size: [regionSizeX, regionSizeY, regionSizeZ],
				dimension: '3d',
				format: 'r32uint',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			})

			this.device.queue.writeTexture(
				{ texture: resources.acceleration },
				accelerationData,
				{
					bytesPerRow: regionSizeX * 4,
					rowsPerImage: regionSizeY,
				},
				{
					width: regionSizeX,
					height: regionSizeY,
					depthOrArrayLayers: regionSizeZ
				}
			)

			const accelerationData2 = this.generateAccelerationDataZ(volume.voxels, volume.sizeX, volume.sizeY, volume.sizeZ)
			resources.accelerateBuffer = this.device.createBuffer({
				size: accelerationData.byteLength,
				usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE,
			})
			this.device.queue.writeBuffer(resources.accelerateBuffer, 0, accelerationData2)
		}

		if (this.RENDERMODE == 1) {
			const faces = volume.generateFaces()
			resources.rasterBuffer = this.device.createBuffer({
				size: faces.byteLength,
				usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
			})
			this.device.queue.writeBuffer(resources.rasterBuffer, 0, faces)
		}

		this.resourceMap.set(level, resources)
	}

	createDepthTexture() {
		if (this.depthTexture) {
			this.depthTexture.destroy()
		}

		this.depthTexture = this.device.createTexture({
			size: [this.viewport[0], this.viewport[1], 1],
			format: 'depth24plus',
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		})
	}

	async draw() {
		const commandEncoder = this.device.createCommandEncoder()
		const renderPass = commandEncoder.beginRenderPass({
			colorAttachments: [{
				view: this.context.getCurrentTexture().createView(),
				clearValue: { r: 0, g: 0, b: 0, a: 1 },
				loadOp: 'clear',
				storeOp: 'store',
			}],
			depthStencilAttachment: {
				view: this.depthTexture.createView(),
				depthClearValue: 1.0,
				depthLoadOp: 'clear',
				depthStoreOp: 'store',
			},
			timestampWrites: {
				querySet: this.querySet,
				beginningOfPassWriteIndex: 0,
				endOfPassWriteIndex: 1,
			}
		})

		this.device.queue.writeBuffer(this.frameUniforms, 0, /** @type {Float32Array} */(camera.projection))
		this.device.queue.writeBuffer(this.frameUniforms, 64, /** @type {Float32Array} */(camera.view))
		this.device.queue.writeBuffer(this.frameUniforms, 128, /** @type {Float32Array} */(camera.entity.worldPosition))
		this.device.queue.writeBuffer(this.frameUniforms, 144, new Float32Array(this.viewport))

		this.objectUniformsOffset = 0

		const viewProjectionMatrix = mat4.create()
		mat4.multiply(viewProjectionMatrix, camera.projection, camera.view)
		this.drawLevel(level, viewProjectionMatrix, renderPass)


		renderPass.setPipeline(this.modelPipeline)
		for (const e of Entity.all) {
			if (e.model && e !== player) {
				const offsetMatrix = mat4.fromTranslation(mat4.create(), [-e.model.volume.sizeX / 2, -e.model.volume.sizeY / 2, 0])
				const modelMatrix = mat4.fromRotationTranslationScale(mat4.create(), e.localRotation, e.localPosition, vec3.scale(vec3.create(), e.localScale, 1 / 32))
				mat4.multiply(modelMatrix, modelMatrix, offsetMatrix)
				const modelViewProjectionMatrix = mat4.multiply(mat4.create(), viewProjectionMatrix, modelMatrix)
				this.drawModel(e.model, modelViewProjectionMatrix, modelMatrix, renderPass)
			}
			e.animationFrame++
			if (e.animationFrame > 16) {
				if (e.model == models['fatta']) {
					e.model = models['fatta']
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

		this.device.queue.writeBuffer(this.objectUniforms, 0, this.transferBuffer, 0, this.objectUniformsOffset)

		renderPass.end()
		commandEncoder.resolveQuerySet(this.querySet, 0, 2, this.queryResolve, 0)
		if (this.queryResult.mapState === 'unmapped') {
			commandEncoder.copyBufferToBuffer(this.queryResolve, 0, this.queryResult, 0, this.queryResult.size)
		}

		this.device.queue.submit([commandEncoder.finish()])

		if (this.queryResult.mapState === 'unmapped') {
			await this.queryResult.mapAsync(GPUMapMode.READ)
			const queryData = new BigUint64Array(this.queryResult.getMappedRange())
			const delta = queryData[1] - queryData[0]
			this.queryResult.unmap()
			const frameTimeMs = Number(delta) / 1e6
			this.frameTimes.push(frameTimeMs)
			const now = performance.now()
			if (now - this.lastTimePrint >= 1000) {
				const sum = this.frameTimes.reduce((a, b) => a + b, 0)
				const avgFrameTime = sum / this.frameTimes.length
				console.log(`Average frame time over last ${this.frameTimes.length} frames: ${avgFrameTime.toFixed(7)} ms`)
				this.frameTimes.length = 0
				this.lastTimePrint = now
			}
		}
	}

	/**
	* @param {Level} level
	* @param {mat4} modelViewProjectionMatrix
	* @param {GPURenderPassEncoder} renderPass
	* @returns {void}
	*/
	drawLevel(level, modelViewProjectionMatrix, renderPass) {
		const resources = this.resourceMap.get(level)
		const floatView = new Float32Array(this.transferBuffer, this.objectUniformsOffset)
		floatView.set(modelViewProjectionMatrix, 0)
		floatView.set(modelViewProjectionMatrix, 16)

		if (!resources.bindGroup) {
			const additionalEntries = []
			if (this.RENDERMODE === 0) {
				additionalEntries.push({
					binding: 6,
					resource: resources.acceleration.createView()
				})
				additionalEntries.push({
					binding: 7,
					resource: {
						buffer: resources.accelerateBuffer,
					}
				})
			}

			resources.bindGroup = this.device.createBindGroup({
				layout: this.bindGroupLayout,
				entries: [
					{
						binding: 0,
						resource: {
							buffer: this.frameUniforms,
							size: 256,
						},
					},
					{
						binding: 1,
						resource: {
							buffer: this.objectUniforms,
							size: 256,
						}
					},
					{
						binding: 2,
						resource: resources.texture.createView()
					},
					{
						binding: 3,
						resource: this.paletteTexture.createView()
					},
					{
						binding: 4,
						resource: tileset.texture.createView()
					},
					{
						binding: 5,
						resource: this.tileSampler
					},
					...additionalEntries
				],
			})
		}

		renderPass.setPipeline(this.terrainPipeline)
		renderPass.setBindGroup(0, resources.bindGroup, [this.objectUniformsOffset])

		switch (this.RENDERMODE) {
			case 0:
				//renderPass.draw(36, 1, 0, 0)
				break
			case 1:
				renderPass.setVertexBuffer(0, resources.rasterBuffer)
				renderPass.draw(6, resources.rasterBuffer.size / 4, 0, 0)
				break
		}
		this.objectUniformsOffset += 256
	}

	/**
	 * 
	 * @param {Model} model 
	 * @param {mat4} modelViewProjectionMatrix 
	 * @param {mat4} modelMatrix 
	 * @param {GPURenderPassEncoder} renderPass
	 */
	drawModel(model, modelViewProjectionMatrix, modelMatrix, renderPass) {
		const resources = this.resourceMap.get(model)
		const floatView = new Float32Array(this.transferBuffer, this.objectUniformsOffset)
		const uintView = new Uint32Array(this.transferBuffer, this.objectUniformsOffset)

		floatView.set(modelMatrix, 0)
		floatView.set(modelViewProjectionMatrix, 16)
		uintView[35] = resources.paletteIndex

		if (!resources.bindGroup) {
			/** @type {GPUBindGroupDescriptor} */const descriptor = {
				label: 'model',
				layout: this.bindGroupLayout,
				entries: [
					{
						binding: 0,
						resource: {
							buffer: this.frameUniforms,
							size: 256,
						},
					},
					{
						binding: 1,
						resource: {
							buffer: this.objectUniforms,
							size: 256,
						}
					},
					{
						binding: 2,
						resource: resources.texture.createView()
					},
					{
						binding: 3,
						resource: this.paletteTexture.createView()
					},
					{
						binding: 4,
						resource: tileset.texture.createView()
					},
					{
						binding: 5,
						resource: this.tileSampler
					}
				],
			}
			if (this.RENDERMODE === 0) {
				descriptor.entries = [...descriptor.entries, {
					binding: 6,
					resource: resources.acceleration.createView()
				},
				{
					binding: 7,
					resource: {
						buffer: resources.accelerateBuffer,
					}
				}]
			}

			resources.bindGroup = this.device.createBindGroup(descriptor)
		}

		renderPass.setBindGroup(0, resources.bindGroup, [this.objectUniformsOffset])

		switch (this.RENDERMODE) {
			case 0:
				renderPass.draw(36, 1, 0, 0)
				break
			case 1:
				renderPass.setVertexBuffer(0, resources.rasterBuffer)
				renderPass.draw(6, resources.rasterBuffer.size / 4, 0, 0)
				break
			case 2:
				renderPass.draw(6, 2 * model.volume.sizeX + 2 * model.volume.sizeY + 2 * model.volume.sizeZ)
				break
		}

		this.objectUniformsOffset += 256
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
							e.localPosition[0] = data.pos[0]
							e.localPosition[1] = data.pos[1]
							e.localPosition[2] = data.pos[2]
							e.localRotation[0] = data.ori[0]
							e.localRotation[1] = data.ori[1]
							e.localRotation[2] = data.ori[2]
							e.localRotation[3] = data.ori[3]
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
						pos: [e.localPosition[0], e.localPosition[1], e.localPosition[2]],
						ori: [e.localRotation[0], e.localRotation[1], e.localRotation[2], e.localRotation[3]]
					})
				}
			}
		}
	}
}


class Volume {
	constructor(sizeX, sizeY, sizeZ, config = {}) {
		this.sizeX = sizeX
		this.sizeY = sizeY
		this.sizeZ = sizeZ
		this.emptyValue = config.emptyValue ?? 255
		this.voxels = new (config.arrayType ?? Uint8Array)(sizeX * sizeY * sizeZ)
		this.dirty = true
	}

	/**
	 * 
	 * @param {*} x 
	 * @param {*} y 
	 * @param {*} z 
	 * @returns number
	 */
	getVoxel(x, y, z) {
		if (x < 0 || y < 0 || z < 0 ||
			x >= this.sizeX || y >= this.sizeY || z >= this.sizeZ) {
			return this.emptyValue
		}
		return this.voxels[z * this.sizeY * this.sizeX + y * this.sizeX + x]
	}

	getVoxelFloor(x, y, z) {
		x = Math.floor(x)
		y = Math.floor(y)
		z = Math.floor(z)

		if (x < 0 || y < 0 || z < 0 ||
			x >= this.sizeX || y >= this.sizeY || z >= this.sizeZ) {
			return this.emptyValue
		}
		return this.voxels[z * this.sizeY * this.sizeX + y * this.sizeX + x]
	}

	setVoxel(x, y, z, value) {
		if (x < 0 || y < 0 || z < 0 ||
			x >= this.sizeX || y >= this.sizeY || z >= this.sizeZ) {
			return
		}
		this.voxels[z * this.sizeY * this.sizeX + y * this.sizeX + x] = value
		this.dirty = true
	}

	/**
	 * 
	 * @param {*} x
	 * @param {*} y
	 * @param {*} z
	 * @returns boolean
	 */
	isSurface(x, y, z) {
		let sizeX = this.sizeX
		let sizeY = this.sizeY
		let sizeZ = this.sizeZ

		const idx = z * sizeX * sizeY + y * sizeX + x
		if (this.voxels[idx] === this.emptyValue) {
			return false
		}
		const neighbors = [
			[x - 1, y, z], [x + 1, y, z],
			[x, y - 1, z], [x, y + 1, z],
			[x, y, z - 1], [x, y, z + 1],
		]
		for (let i = 0; i < neighbors.length; i++) {
			const [nx, ny, nz] = neighbors[i]
			if (nx < 0 || nx >= sizeX || ny < 0 || ny >= sizeY || nz < 0 || nz >= sizeZ) {
				return true
			}
			const nIdx = nz * sizeX * sizeY + ny * sizeX + nx
			if (this.voxels[nIdx] === this.emptyValue) {
				return true
			}
		}
		return false
	}


	generateColumns() {
		let sizeX = this.sizeX
		let sizeY = this.sizeY
		let sizeZ = this.sizeZ

		const numColumns = sizeX * sizeY
		const columnMap = new Uint32Array(numColumns)
		const columnData = []
		let currentOffset = 0
		let totalVisible = 0

		for (let y = 0; y < sizeY; y++) {
			for (let x = 0; x < sizeX; x++) {
				const colIndex = y * sizeX + x
				columnMap[colIndex] = currentOffset

				let z = 0
				while (z < sizeZ) {
					// Skip non-surface voxels
					while (z < sizeZ && !this.isSurface(x, y, z)) {
						z++
					}
					if (z >= sizeZ) break

					// Found surface voxel, start interval
					const start = z
					const val = this.voxels[z * sizeX * sizeY + y * sizeX + x]

					while (z < sizeZ &&
						this.isSurface(x, y, z) &&
						this.voxels[z * sizeX * sizeY + y * sizeX + x] === val) {
						z++
					}

					// Store interval
					columnData.push(start & 0xFF)        // start z
					columnData.push((z - start) & 0xFF)  // length
					totalVisible += z - start
					currentOffset += 2
				}
			}
		}
		console.log('Encoded', columnData.length + numColumns * 4, 'bytes for', numColumns, 'columns', (columnData.length + numColumns * 4) / numColumns, 'bytes per column', totalVisible, 'visible voxels')

		return {
			columnMap,
			columnData: new Uint8Array(columnData)
		}
	}

	generateFaces() {
		let sizeX = this.sizeX
		let sizeY = this.sizeY
		let sizeZ = this.sizeZ

		const maxFaces = 4 * (
			sizeX * sizeY * sizeZ
		)

		const faces = new Uint8Array(maxFaces * 6)
		let faceCount = 0

		for (let x = 0; x < sizeX; x++) {
			for (let y = 0; y < sizeY; y++) {
				for (let z = 0; z < sizeZ; z++) {
					const idx = z * sizeY * sizeX + y * sizeX + x

					if (this.voxels[idx] === this.emptyValue) continue

					// Check -X face
					if (x === 0 || this.voxels[z * sizeY * sizeX + y * sizeX + (x - 1)] === this.emptyValue) {
						faces[faceCount * 4 + 0] = x
						faces[faceCount * 4 + 1] = y
						faces[faceCount * 4 + 2] = z
						faces[faceCount * 4 + 3] = 0
						faceCount++
					}
					// Check +X face
					if (x === sizeX - 1 || this.voxels[z * sizeY * sizeX + y * sizeX + (x + 1)] === this.emptyValue) {
						faces[faceCount * 4 + 0] = x
						faces[faceCount * 4 + 1] = y
						faces[faceCount * 4 + 2] = z
						faces[faceCount * 4 + 3] = 1
						faceCount++
					}
					// Check -Y face
					if (y === 0 || this.voxels[z * sizeY * sizeX + (y - 1) * sizeX + x] === this.emptyValue) {
						faces[faceCount * 4 + 0] = x
						faces[faceCount * 4 + 1] = y
						faces[faceCount * 4 + 2] = z
						faces[faceCount * 4 + 3] = 2
						faceCount++
					}
					// Check +Y face
					if (y === sizeY - 1 || this.voxels[z * sizeY * sizeX + (y + 1) * sizeX + x] === this.emptyValue) {

						faces[faceCount * 4 + 0] = x
						faces[faceCount * 4 + 1] = y
						faces[faceCount * 4 + 2] = z
						faces[faceCount * 4 + 3] = 3
						faceCount++
					}
					// Check -Z face
					if (z === 0 || this.voxels[(z - 1) * sizeY * sizeX + y * sizeX + x] === this.emptyValue) {

						faces[faceCount * 4 + 0] = x
						faces[faceCount * 4 + 1] = y
						faces[faceCount * 4 + 2] = z
						faces[faceCount * 4 + 3] = 4
						faceCount++
					}
					// Check +Z face
					if (z === sizeZ - 1 || this.voxels[(z + 1) * sizeY * sizeX + y * sizeX + x] === this.emptyValue) {

						faces[faceCount * 4 + 0] = x
						faces[faceCount * 4 + 1] = y
						faces[faceCount * 4 + 2] = z
						faces[faceCount * 4 + 3] = 5
						faceCount++
					}
				}
			}
		}
		return faces.subarray(0, faceCount * 4)
	}


}


/**
 * 
 * @param {ArrayBufferLike} voxels 
 * @param {number} sizeX 
 * @param {number} sizeY 
 * @param {number} sizeZ 
 * @param {number} emptyValue 
 */
function greedyMesh(voxels, sizeX, sizeY, sizeZ, emptyValue = 255) {
	let occupancyData = new BigUint64Array(sizeZ * sizeY * ((sizeX + 63) >> 6))

	for (let z = 0; z < sizeZ; z++) {
		for (let y = 0; y < sizeY; y++) {
			for (let x = 0; x < sizeX; x++) {
				if (voxels[z * sizeY * sizeX + y * sizeX + x] !== emptyValue) {
					let maskIndex = z * sizeY + y + (x >> 6)
					let bitIndex = x & 63
					occupancyData[maskIndex] |= 1n << BigInt(bitIndex)
				}
			}
		}
	}

	for (let z = 0; z < sizeZ; z++) {
		for (let y = 0; y < sizeY; y++) {
			let maskIndex = z * sizeY + y
			let mask = occupancyData[maskIndex]
			let left = ~(mask >> 1n) & mask
			let right = ~(mask << 1n) & mask
			if (z == 0) {
				//console.log('mask: ', mask.toString(2).padStart(sizeX, '0'))
				//console.log('left: ', left.toString(2).padStart(sizeX, '0'))
				//console.log('right:', right.toString(2).padStart(sizeX, '0'))
			}

		}
	}

	return occupancyData
}

function setupUI() {

	for (const button of document.getElementsByClassName('bind-button')) {
		button.textContent = settings.keybinds[button.id]
	}

	/** @type {HTMLInputElement} */
	(document.getElementById('invert-mouse')).checked = settings.invertMouse

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
			return
		}
		activeBinding.textContent = event.code
		activeBinding.classList.remove('listening')
		settings.keybinds[activeBinding.id] = event.code
		localStorage.setItem('gameSettings', JSON.stringify(settings))
	})

	menu.addEventListener('blur', (event) => {
		if (activeBinding && event.target == activeBinding) {
			activeBinding.textContent = settings.keybinds[activeBinding.id]
			activeBinding.classList.remove('listening')
			activeBinding = null
		}
	}, true)


	menu.addEventListener('click', (event) => {
		event.stopPropagation()

		const button = /** @type {HTMLButtonElement} */ (event.target)
		if (button.classList?.contains('bind-button')) {
			activeBinding = button
			activeBinding.classList.add('listening')
			activeBinding.textContent = 'Press a key...'
			return
		}

		if (button.id === 'close-menu') {
			showingMenu = false
			menu.hidden = true
			//document.body.requestPointerLock()
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
	})

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

	document.addEventListener('click', (event) => {
		if (event.target instanceof HTMLButtonElement) {
			if (event.target.id === 'toggle-menu') {
				showingMenu = !showingMenu
				document.getElementById('main-menu').hidden = !showingMenu
				if (showingMenu) {
					document.exitPointerLock()
				} else {
					document.body.requestPointerLock()
				}
				return
			}
		}

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

	window.addEventListener('error', (event) => {
		const debug = document.getElementById('debug')
		debug.innerHTML = `${event.error} at ${event.filename}:${event.lineno}<br>${debug.innerHTML}`

	})

	window.addEventListener('unhandledrejection', (event) => {
		const debug = document.getElementById('debug')

		debug.innerHTML = `${event.reason}<br>${debug.innerHTML}`
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
			player.respawn()
			break
		}
		default:
			break
	}
}

function processInput(elapsed) {
	const right = vec3.fromValues(1, 0, 0)
	vec3.transformQuat(right, right, player.localRotation)

	const forward = vec3.fromValues(0, 1, 0)
	vec3.transformQuat(forward, forward, player.localRotation)

	const up = vec3.fromValues(0, 0, 1)
	vec3.transformQuat(up, up, player.localRotation)
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

	quat.rotateZ(player.localRotation, player.localRotation, -dx * elapsed / 1000)
	quat.rotateX(player.head.localRotation, player.head.localRotation, dy * elapsed / 1000)


	const angle = quat.getAxisAngle(vec3.create(), player.head.localRotation)
	if (angle > Math.PI / 2) {
		if (dy > 0) {
			quat.setAxisAngle(player.head.localRotation, vec3.fromValues(1, 0, 0), Math.PI / 2)
		} else {
			quat.setAxisAngle(player.head.localRotation, vec3.fromValues(1, 0, 0), -Math.PI / 2)
		}
	}

	player.dirty = true
	player.head.dirty = true

	mouseMoveX = 0
	mouseMoveY = 0
}

function loop() {
	const elapsed = performance.now() - lastTime
	lastTime = performance.now()

	localStorage.setItem('gameState', JSON.stringify({
		playerPos: Array.from(player.localPosition),
		playerOrientation: Array.from(player.localRotation),
		playerHeadRotation: Array.from(player.head.localRotation),
		showingMenu: showingMenu,
		godMode: godMode
	}))

	timeLabel.innerHTML = `<span style="color: #FFD700;">cam_pos: ${camera.entity.worldPosition[0].toFixed(2)}, ${camera.entity.worldPosition[1].toFixed(2)}, ${camera.entity.worldPosition[2].toFixed(2)}
		${godMode ? '<span style="color: #FFD700;">{ God Mode }</span>' : ' { Peon Mode }'}`

	processInput(elapsed)

	for (const e of Entity.all) {
		e.update(elapsed)
		if (e.gravity && !(e instanceof Player && godMode)) {
			if (!e.onGround(level)) {
				e.vel[2] -= 9.8 * elapsed / 1000
			}
		}


		let speed = vec3.length(e.vel)
		vec3.scaleAndAdd(e.localPosition, e.localPosition, e.vel, elapsed / 1000)
		if (speed > 100) {
			speed = 100
			vec3.normalize(e.vel, e.vel)
			vec3.scale(e.vel, e.vel, speed)
		}
		if (speed > 0) {
			vec3.scaleAndAdd(e.localPosition, e.localPosition, e.vel, elapsed / 1000)
			e.dirty = true
		}

		if (e instanceof Player && !godMode) {
			for (const ee of Entity.all) {
				if (e == ee) {
					continue
				}
				if (ee.spawn) {
					continue
				}

				if (ee === e.head) {
					continue
				}
				const s = vec3.sub(vec3.create(), ee.localPosition, e.localPosition)
				const d = vec3.length(s)

				if (d < e.radius + ee.radius) {
					const pushback = e.radius + ee.radius - d
					const t = vec3.add(vec3.create(), s, e.vel)
					vec3.normalize(t, t)
					vec3.scaleAndAdd(e.localPosition, e.localPosition, t, -pushback)
					e.dirty = true
					if (e.radius >= ee.radius) {
						vec3.scaleAndAdd(ee.localPosition, e.vel, t, pushback)
						ee.dirty = true
					}
				}
			}

			if (level.volume.getVoxelFloor(e.localPosition[0] + e.radius, e.localPosition[1], e.localPosition[2] + e.height / 2)) {
				e.localPosition[0] = Math.floor(e.localPosition[0] + e.radius) - e.radius
				e.dirty = true
			}
			if (level.volume.getVoxelFloor(e.localPosition[0] - e.radius, e.localPosition[1], e.localPosition[2] + e.height / 2)) {
				e.localPosition[0] = Math.ceil(e.localPosition[0] - e.radius) + e.radius
				e.dirty = true
			}
			if (level.volume.getVoxelFloor(e.localPosition[0], e.localPosition[1] + e.radius, e.localPosition[2] + e.height / 2)) {
				e.localPosition[1] = Math.floor(e.localPosition[1] + e.radius) - e.radius
				e.dirty = true
			}
			if (level.volume.getVoxelFloor(e.localPosition[0], e.localPosition[1] - e.radius, e.localPosition[2] + e.height / 2)) {
				e.localPosition[1] = Math.ceil(e.localPosition[1] - e.radius) + e.radius
				e.dirty = true
			}
			if (level.volume.getVoxelFloor(e.localPosition[0], e.localPosition[1], e.localPosition[2] + e.height)) {
				e.localPosition[2] = Math.floor(e.localPosition[2] + e.height) - e.height
				e.vel[2] = 0
				e.dirty = true
			}
			if (level.volume.getVoxelFloor(e.localPosition[0], e.localPosition[1], e.localPosition[2])) {
				e.localPosition[2] = Math.ceil(e.localPosition[2])
				e.vel[2] = 0
				e.dirty = true
			}
		}
	}

	for (const e of Entity.all) {
		if (!e.parent) {
			e.updateTransforms(null)
		}
	}

	camera.update()
	renderer.draw()
	net.update()
	requestAnimationFrame(loop)
}

async function main() {
	camera.entity = player.head

	let savedState = localStorage.getItem('gameState')
	if (savedState) {
		const state = JSON.parse(savedState)
		player.localPosition = vec3.fromValues(state.playerPos[0], state.playerPos[1], state.playerPos[2])
		player.localRotation = quat.fromValues(state.playerOrientation[0], state.playerOrientation[1], state.playerOrientation[2], state.playerOrientation[3])
		player.head.localRotation = state.playerHeadRotation
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
	await renderer.init()

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
		'box_frame',
	].map((model) => [model, new Model(`/models/${model}.vox`)])
)

let tileset = new Tileset('/tilesets/dcss_tiles.tsj')
let level = new Level('/maps/test.tmj')
let player = new Player()
let renderer = new Renderer()
let net = new Net()
let camera = new Camera()

main()	
