import { mat4 } from 'gl-matrix';
import type { Model } from './Model';
import type { Tileset } from './Tileset';
import type { Level } from './Level';
import { greedyMesh, optimizedGreedyMesh } from './utils';

export class Renderer {
  device!: GPUDevice;
  context!: GPUCanvasContext;
  viewport: [number, number] = [0, 0];
    shaders: Record<string, GPUShaderModule> = {};
  terrainPipeline!: GPURenderPipeline;
  modelPipeline!: GPURenderPipeline;
  greedyTerrainPipeline!: GPURenderPipeline;
  greedyModelPipeline!: GPURenderPipeline;
  bindGroupLayout!: GPUBindGroupLayout;
  greedyBindGroupLayout!: GPUBindGroupLayout;
  depthTexture!: GPUTexture;
    frameTimes: number[] = [];
  lastTimePrint: number = 0;  querySet!: GPUQuerySet;
  queryResolve!: GPUBuffer;
  queryResult!: GPUBuffer;
  
  // Track mesh statistics for each frame
  renderedFacesCount: number = 0;
  renderedOriginalFacesCount: number = 0;
  renderedGreedyFacesCount: number = 0;
  
  frameUniforms!: GPUBuffer;
  objectUniforms!: GPUBuffer;
  objectUniformsOffset: number = 0;
  paletteTexture!: GPUTexture;
  transferBuffer!: ArrayBuffer;
  floatView!: Float32Array;  uintView!: Uint32Array;
  nextPaletteIndex: number = 0;
  tileSampler!: GPUSampler;

  resourceMap = new Map<Model | Level, any>();

  async init(): Promise<void> {
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported');
    }
    
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('No GPU adapter found');
    }
      this.device = await adapter.requestDevice({
      requiredFeatures: ['timestamp-query']
    });

    const canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    this.viewport = [canvas.width, canvas.height];
    
    this.context = canvas.getContext('webgpu')!;
    this.context.configure({
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: 'premultiplied',
    });

    // Handle window resizing
    window.addEventListener('resize', () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      this.viewport = [canvas.width, canvas.height];
      this.createDepthTexture();
      this.context.configure({
        device: this.device,
        format: navigator.gpu.getPreferredCanvasFormat(),
        alphaMode: 'opaque',
      });
      
      // Update camera aspect ratio
      if (globalThis.camera) {
        globalThis.camera.aspect = this.viewport[0] / this.viewport[1];
        mat4.perspective(globalThis.camera.projection, globalThis.camera.fov, globalThis.camera.aspect, globalThis.camera.near, globalThis.camera.far);
      }
    });

    this.createDepthTexture();
    
    // Create buffers
    this.frameUniforms = this.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    this.objectUniforms = this.device.createBuffer({
      size: 256 * 100000,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    this.transferBuffer = new ArrayBuffer(256 * 100000);
    
    this.paletteTexture = this.device.createTexture({
      format: 'rgba8unorm',
      size: [256, 256, 1],
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
      this.tileSampler = this.device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      addressModeW: 'repeat',
    });

    this.frameTimes = [];
    this.lastTimePrint = performance.now();
    
    this.querySet = this.device.createQuerySet({
      type: "timestamp",
      count: 2,
    });
    
    this.queryResolve = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    
    this.queryResult = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });    await this.compileShaders();
    const quadsShader = this.shaders['quads'];
    const greedyShader = this.shaders['greedy'];
    this.createBindGroupLayouts();
    this.createPipelines(quadsShader, greedyShader);
  }

  async compileShaders(): Promise<void> {
    const sources = await this.loadShaderSources();
    const modules: Record<string, GPUShaderModule> = {};
    const results: Promise<void>[] = [];

    for (const name in sources) {
      const module = this.device.createShaderModule({
        label: name,
        code: sources[name],
      });
      results.push(module.getCompilationInfo().then(info => {
        for (const message of info.messages) {
          console.log(message);
        }
      }));
      modules[name] = module;
    }
    
    await Promise.all(results);
    console.log('All shader modules compiled');
    this.shaders = modules;
  }  async loadShaderSources(): Promise<Record<string, string>> {
    const shaders: Record<string, string> = {};
    const shaderModules = (import.meta as any).glob('./shaders/*.wgsl', { query: '?raw', import: 'default' });

    for (const path in shaderModules) {
      const name = path.split('/').pop()!.replace('.wgsl', '');
      shaders[name] = await shaderModules[path]() as string;
    }

    return shaders;
  }
  createBindGroupLayouts(): void {
    const bindGroupDescriptor: GPUBindGroupLayoutDescriptor = {
      label: 'common',
      entries: [
        // frame uniforms
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' }
        },
        // object uniforms
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform', hasDynamicOffset: true }
        },
        // voxels
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'uint', viewDimension: '3d' }
        },
        // palette
        {
          binding: 3,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' }
        },
        // tiles
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d-array' }
        },
        // tile sampler
        {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'non-filtering' }
        },      ]
    };

    this.bindGroupLayout = this.device.createBindGroupLayout(bindGroupDescriptor);
    
    // Create greedy mesh bind group layout (same as original for now)
    this.greedyBindGroupLayout = this.device.createBindGroupLayout(bindGroupDescriptor);
  }  createPipelines(quadsShader: GPUShaderModule, greedyShader: GPUShaderModule): void {
    // Original quad rendering pipelines
    const terrainPipelineDescriptor: GPURenderPipelineDescriptor = {
      label: 'terrain-cubes',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout]
      }),
      vertex: {
        module: quadsShader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 4,
          stepMode: 'instance',
          attributes: [{
            shaderLocation: 0,
            offset: 0,
            format: 'uint8x4'
          }]
        }]
      },
      fragment: {
        module: quadsShader,
        entryPoint: 'fs_textured',
        targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
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
    };
    
    const modelPipelineDescriptor: GPURenderPipelineDescriptor = {
      label: 'model-cubes',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout]
      }),
      vertex: {
        module: quadsShader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 4,
          stepMode: 'instance',
          attributes: [{
            shaderLocation: 0,
            offset: 0,
            format: 'uint8x4'
          }]
        }],
      },
      fragment: {
        module: quadsShader,
        entryPoint: 'fs_model',
        targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
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
    };    // Greedy mesh pipelines - updated for variable-sized quads
    const greedyTerrainPipelineDescriptor: GPURenderPipelineDescriptor = {
      label: 'greedy-terrain',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.greedyBindGroupLayout]
      }),
      vertex: {
        module: greedyShader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 32, // 8 uint32 values per face: x, y, z, normal, width, height, pad1, pad2
          stepMode: 'instance',
          attributes: [
            {
              shaderLocation: 0,
              offset: 0,
              format: 'uint32x4' // x, y, z, normal as 32-bit values
            },
            {
              shaderLocation: 1,
              offset: 16,
              format: 'uint32x2' // width, height as 32-bit values (skip padding)
            }
          ]
        }]
      },
      fragment: {
        module: greedyShader,
        entryPoint: 'fs_textured',
        targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
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
    };
    
    const greedyModelPipelineDescriptor: GPURenderPipelineDescriptor = {
      label: 'greedy-model',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.greedyBindGroupLayout]
      }),      vertex: {
        module: greedyShader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 32, // 32 bytes per face: x, y, z, normal, width, height, pad1, pad2 (all as uint32)
          stepMode: 'instance',
          attributes: [
            {
              shaderLocation: 0,
              offset: 0,
              format: 'uint32x4' // x, y, z, normal as 32-bit values
            },
            {
              shaderLocation: 1,
              offset: 16,
              format: 'uint32x2' // width, height as 32-bit values (skip padding)
            }
          ]
        }]
      },
      fragment: {
        module: greedyShader,
        entryPoint: 'fs_model',
        targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
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
    };

    this.terrainPipeline = this.device.createRenderPipeline(terrainPipelineDescriptor!);
    this.modelPipeline = this.device.createRenderPipeline(modelPipelineDescriptor!);
    this.greedyTerrainPipeline = this.device.createRenderPipeline(greedyTerrainPipelineDescriptor!);
    this.greedyModelPipeline = this.device.createRenderPipeline(greedyModelPipelineDescriptor!);
  }

  registerModel(model: Model): void {
    const volume = model.volume;
    const resources = this.resourceMap.get(model) || {};

    resources.texture = this.device.createTexture({
      size: [volume.sizeX, volume.sizeY, volume.sizeZ],
      dimension: '3d',
      format: 'r8uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      mipLevelCount: 1,
    });
      this.device.queue.writeTexture(
      { texture: resources.texture, mipLevel: 0 },
      volume.voxels,
      {
        bytesPerRow: volume.sizeX,
        rowsPerImage: volume.sizeY
      },
      [volume.sizeX, volume.sizeY, volume.sizeZ]
    );
    
    this.device.queue.writeTexture(
      {
        texture: this.paletteTexture,
        aspect: 'all',
        origin: [0, this.nextPaletteIndex, 0],
        mipLevel: 0,
      },
      model.palette!,
      { bytesPerRow: 256 * 4 },
      [255, 1, 1]
    );
    
    resources.paletteIndex = this.nextPaletteIndex++;// Generate both original and greedy mesh data
    const originalFaces = model.volume.generateFaces();
    const greedyFaces = optimizedGreedyMesh(volume.voxels, volume.sizeX, volume.sizeY, volume.sizeZ, volume.emptyValue);
    
    // Store both mesh types in resources
    resources.originalBuffer = this.device.createBuffer({
      size: originalFaces.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(resources.originalBuffer, 0, originalFaces);
    
    resources.greedyBuffer = this.device.createBuffer({
      size: greedyFaces.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(resources.greedyBuffer, 0, greedyFaces);
    
    // Set the active buffer based on current setting
    const useGreedy = (globalThis as any).useGreedyMesh || false;
    resources.rasterBuffer = useGreedy ? resources.greedyBuffer : resources.originalBuffer;    // Log statistics for box_frame model
    if (model.url.includes('box_frame')) {
      console.log(`Box frame model - Original faces: ${originalFaces.length / 4}, Greedy mesh faces: ${greedyFaces.length / 8}`);
      
      // Debug face details for both algorithms
      if (originalFaces.length > 0) {
        console.log('Original first 5 faces:');
        for (let i = 0; i < Math.min(20, originalFaces.length); i += 4) {
          console.log(`  Face ${i/4}: [${originalFaces[i]}, ${originalFaces[i+1]}, ${originalFaces[i+2]}] normal=${originalFaces[i+3]}`);
        }
      }
      
      if (greedyFaces.length > 0) {        console.log('Greedy first 5 faces:');
        for (let i = 0; i < Math.min(40, greedyFaces.length); i += 8) {
          console.log(`  Face ${i/8}: [${greedyFaces[i]}, ${greedyFaces[i+1]}, ${greedyFaces[i+2]}] normal=${greedyFaces[i+3]} size=${greedyFaces[i+4]}x${greedyFaces[i+5]}`);
        }
      }
    }
    
    // DETAILED DEBUG: Log statistics specifically for fatta model (the one with artifact)
    if (model.url.includes('fatta')) {
      console.log(`🔍 FATTA MODEL DEBUG - Original faces: ${originalFaces.length / 4}, Greedy mesh faces: ${greedyFaces.length / 8}`);
      console.log(`Model dimensions: ${volume.sizeX}x${volume.sizeY}x${volume.sizeZ}`);
      
      // Debug face details for both algorithms - show more faces for fatta
      if (originalFaces.length > 0) {
        console.log('🟦 FATTA Original faces (first 10):');
        for (let i = 0; i < Math.min(40, originalFaces.length); i += 4) {
          console.log(`  Original Face ${i/4}: pos[${originalFaces[i]}, ${originalFaces[i+1]}, ${originalFaces[i+2]}] normal=${originalFaces[i+3]}`);
        }
      }
        if (greedyFaces.length > 0) {
        console.log('🟩 FATTA Greedy faces (first 10):');
        for (let i = 0; i < Math.min(80, greedyFaces.length); i += 8) {
          console.log(`  Greedy Face ${i/8}: pos[${greedyFaces[i]}, ${greedyFaces[i+1]}, ${greedyFaces[i+2]}] normal=${greedyFaces[i+3]} size[${greedyFaces[i+4]}x${greedyFaces[i+5]}]`);
        }
      }
      
      // Check for any unusual patterns in the greedy mesh
      let maxWidth = 0, maxHeight = 0;
      for (let i = 0; i < greedyFaces.length; i += 8) {
        maxWidth = Math.max(maxWidth, greedyFaces[i+4]);
        maxHeight = Math.max(maxHeight, greedyFaces[i+5]);
      }
      console.log(`🔍 FATTA max greedy quad size: ${maxWidth}x${maxHeight}`);
    }
    
    // Count faces by direction
    const normalNames = ['-X', '+X', '-Y', '+Y', '-Z', '+Z'];
    
    const originalCounts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < originalFaces.length; i += 4) {
      originalCounts[originalFaces[i + 3]]++;
    }
    console.log('Original face counts by direction:', originalCounts.map((count, i) => `${normalNames[i]}: ${count}`).join(', '));
    
    const greedyCounts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < greedyFaces.length; i += 8) {
      greedyCounts[greedyFaces[i + 3]]++;
    }    console.log('Greedy face counts by direction:', greedyCounts.map((count, i) => `${normalNames[i]}: ${count}`).join(', '));

    this.resourceMap.set(model, resources);
  }

    // Removed generateAccelerationData method as it's no longer needed

  registerTileset(tileset: Tileset): void {
    const width = tileset.tileWidth;
    const height = tileset.tileHeight;
    const count = tileset.numTiles;

    const texture = this.device.createTexture({
      size: [width, height, count],
      format: 'rgba8unorm',
      dimension: '2d',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });

    this.device.queue.writeTexture(
      { texture },
      tileset.imageData!.data,
      {
        bytesPerRow: width * 4,
        rowsPerImage: height
      },
      [width, height, count]
    );
    tileset.texture = texture;
  }

  registerLevel(level: Level): void {
    const volume = level.volume;
    const resources = this.resourceMap.get(level) || {};
    
    resources.texture = this.device.createTexture({
      size: [volume.sizeX, volume.sizeY, volume.sizeZ],
      dimension: '3d',
      format: 'r16uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
      this.device.queue.writeTexture(
      { texture: resources.texture },
      volume.voxels,
      {
        bytesPerRow: volume.sizeX * 2,
        rowsPerImage: volume.sizeY
      },
      [volume.sizeX, volume.sizeY, volume.sizeZ]    );    // Generate both original and greedy mesh data
    const meshStartTime = performance.now();
    const originalFaces = volume.generateFaces();
    const greedyFaces = optimizedGreedyMesh(volume.voxels, volume.sizeX, volume.sizeY, volume.sizeZ, volume.emptyValue);
    const meshEndTime = performance.now();
    
    console.log(`Level mesh generation took ${meshEndTime - meshStartTime}ms`);
    console.log(`Generated ${originalFaces.length / 4} original faces, ${greedyFaces.length / 4} greedy faces for level terrain`);
    
    // Store both mesh types in resources
    const bufferStartTime = performance.now();
    resources.originalBuffer = this.device.createBuffer({
      size: originalFaces.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(resources.originalBuffer, 0, originalFaces);
    
    resources.greedyBuffer = this.device.createBuffer({
      size: greedyFaces.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(resources.greedyBuffer, 0, greedyFaces);
    
    // Set the active buffer based on current setting
    const useGreedy = (globalThis as any).useGreedyMesh || false;
    resources.rasterBuffer = useGreedy ? resources.greedyBuffer : resources.originalBuffer;
    
    const bufferEndTime = performance.now();
    console.log(`Buffer creation and upload took ${bufferEndTime - bufferStartTime}ms`);

    this.resourceMap.set(level, resources);
    console.log('Level terrain mesh registered with renderer');
  }

  createDepthTexture(): void {
    if (this.depthTexture) {
      this.depthTexture.destroy();
    }

    this.depthTexture = this.device.createTexture({
      size: [this.viewport[0], this.viewport[1], 1],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }
  async draw(): Promise<void> {
    // Reset face counters at the start of each frame
    this.renderedFacesCount = 0;
    this.renderedOriginalFacesCount = 0;
    this.renderedGreedyFacesCount = 0;
    
    const commandEncoder = this.device.createCommandEncoder();
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
    });const camera = globalThis.camera;
    this.device.queue.writeBuffer(this.frameUniforms, 0, camera.projection as Float32Array);
    this.device.queue.writeBuffer(this.frameUniforms, 64, camera.view as Float32Array);
    if (camera.entity) {
      this.device.queue.writeBuffer(this.frameUniforms, 128, camera.entity.worldPosition as Float32Array);
    }
    this.device.queue.writeBuffer(this.frameUniforms, 144, new Float32Array(this.viewport));

    this.objectUniformsOffset = 0;    const viewProjectionMatrix = mat4.create();
    mat4.multiply(viewProjectionMatrix, camera.projection, camera.view);
    this.drawLevel(globalThis.level, viewProjectionMatrix, renderPass);

    // Set the appropriate model pipeline based on greedy mesh setting
    const useGreedy = (globalThis as any).useGreedyMesh || false;
    renderPass.setPipeline(useGreedy ? this.greedyModelPipeline : this.modelPipeline);
    
    const player = globalThis.player;    // First render the player's first-person weapon view if it has a model
    if (player.fpWeapon && player.fpWeapon.model) {
      const fpWeapon = player.fpWeapon;
      // Scale for first-person view - use weapon-specific scale
      const baseScale = 1/24;
      const weaponSpecificScale = fpWeapon.getWeaponScale();
      const weaponScale: [number, number, number] = [baseScale * weaponSpecificScale, baseScale * weaponSpecificScale, baseScale * weaponSpecificScale]; 
      
      const offsetMatrix = mat4.fromTranslation(mat4.create(), [-fpWeapon.model!.volume.sizeX / 2, -fpWeapon.model!.volume.sizeY / 2, 0]);      
      const modelMatrix = mat4.fromRotationTranslationScale(mat4.create(), fpWeapon.worldRotation, fpWeapon.worldPosition, weaponScale);
      mat4.multiply(modelMatrix, modelMatrix, offsetMatrix);
      const modelViewProjectionMatrix = mat4.multiply(mat4.create(), viewProjectionMatrix, modelMatrix);
      this.drawModel(fpWeapon.model!, modelViewProjectionMatrix, modelMatrix, renderPass);
    }// Then render all other entities except:
    // - The player (first-person view)
    // - The first-person weapon (already rendered above)
    // - Any weapon attached to the player (would be inside the player model)
    for (const e of globalThis.Entity.all) {      // Helper function to check if an entity is a child of another entity (directly or indirectly)
      const isChildOf = (entity: any, potentialParent: any): boolean => {
        let current = entity.parent;
        while (current) {
          if (current === potentialParent) return true;
          current = current.parent;
        }
        return false;
      };
        // Skip entities:
      // - Without models
      // - That are the player itself
      // - That are the first-person weapon
      // - That are any entity parented to the player (like third-person weapons)
      const isWeaponAttachedToPlayer = e.parent === player || isChildOf(e, player);
      
      if (e.model && 
          e !== player && 
          e !== player.fpWeapon && 
          !isWeaponAttachedToPlayer) {
        const offsetMatrix = mat4.fromTranslation(mat4.create(), [-e.model.volume.sizeX / 2, -e.model.volume.sizeY / 2, 0]);
        const modelMatrix = mat4.fromRotationTranslationScale(mat4.create(), e.worldRotation, e.worldPosition, [1/32, 1/32, 1/32]);
        mat4.multiply(modelMatrix, modelMatrix, offsetMatrix);
        const modelViewProjectionMatrix = mat4.multiply(mat4.create(), viewProjectionMatrix, modelMatrix);
        this.drawModel(e.model, modelViewProjectionMatrix, modelMatrix, renderPass);      }      // Update animation frames
      e.animationFrame++;
      if (e.animationFrame > 16) {
        const models = globalThis.models;
        if (e.model === models['fatta']) {
          e.model = models['fattb'];
        } else if (e.model === models['fattb']) {
          e.model = models['fattc'];
        } else if (e.model === models['fattc']) {
          e.model = models['fattd'];
        } else if (e.model === models['fattd']) {
          e.model = models['fatta'];
        }
        e.animationFrame = 0;
      }
    }

    this.device.queue.writeBuffer(this.objectUniforms, 0, this.transferBuffer, 0, this.objectUniformsOffset);

    renderPass.end();
    commandEncoder.resolveQuerySet(this.querySet, 0, 2, this.queryResolve, 0);
    if (this.queryResult.mapState === 'unmapped') {
      commandEncoder.copyBufferToBuffer(this.queryResolve, 0, this.queryResult, 0, this.queryResult.size);
    }

    this.device.queue.submit([commandEncoder.finish()]);

    if (this.queryResult.mapState === 'unmapped') {
      await this.queryResult.mapAsync(GPUMapMode.READ);
      const queryData = new BigUint64Array(this.queryResult.getMappedRange());
      const delta = queryData[1] - queryData[0];
      this.queryResult.unmap();
      const frameTimeMs = Number(delta) / 1e6;
      this.frameTimes.push(frameTimeMs);
      const now = performance.now();      if (now - this.lastTimePrint >= 1000) {
        const sum = this.frameTimes.reduce((a, b) => a + b, 0);
        const avgFrameTime = sum / this.frameTimes.length;
        console.debug(`Average frame time over last ${this.frameTimes.length} frames: ${avgFrameTime.toFixed(7)} ms`);
        this.frameTimes.length = 0;
        this.lastTimePrint = now;
      }
    }
  }  drawLevel(level: Level, modelViewProjectionMatrix: mat4, renderPass: GPURenderPassEncoder): void {
    const resources = this.resourceMap.get(level);
    const floatView = new Float32Array(this.transferBuffer, this.objectUniformsOffset);
    floatView.set(modelViewProjectionMatrix, 0);
    floatView.set(modelViewProjectionMatrix, 16);
    
    const useGreedy = (globalThis as any).useGreedyMesh || false;
    
    // Update the active buffer and bind group based on current setting
    if (useGreedy && resources.greedyBuffer) {
      resources.rasterBuffer = resources.greedyBuffer;
      
      // Create greedy bind group if needed
      if (!resources.greedyBindGroup) {
        resources.greedyBindGroup = this.device.createBindGroup({
          layout: this.greedyBindGroupLayout,
          entries: [
            {
              binding: 0,
              resource: { buffer: this.frameUniforms, size: 256 }
            },
            {
              binding: 1,
              resource: { buffer: this.objectUniforms, size: 256 }
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
              resource: globalThis.tileset.texture!.createView()
            },
            {
              binding: 5,
              resource: this.tileSampler
            }
          ],
        });
      }
      
      renderPass.setPipeline(this.greedyTerrainPipeline);
      renderPass.setBindGroup(0, resources.greedyBindGroup, [this.objectUniformsOffset]);
    } else {
      resources.rasterBuffer = resources.originalBuffer || resources.rasterBuffer;
      
      // Create original bind group if needed
      if (!resources.bindGroup) {
        resources.bindGroup = this.device.createBindGroup({
          layout: this.bindGroupLayout,
          entries: [
            {
              binding: 0,
              resource: { buffer: this.frameUniforms, size: 256 }
            },
            {
              binding: 1,
              resource: { buffer: this.objectUniforms, size: 256 }
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
              resource: globalThis.tileset.texture!.createView()
            },
            {
              binding: 5,
              resource: this.tileSampler
            }
          ],
        });
      }
      
      renderPass.setPipeline(this.terrainPipeline);
      renderPass.setBindGroup(0, resources.bindGroup, [this.objectUniformsOffset]);
    }
    
    renderPass.setVertexBuffer(0, resources.rasterBuffer);    // Count the faces in the level
    const levelFaceCount = useGreedy ? resources.rasterBuffer.size / 32 : resources.rasterBuffer.size / 4;
    this.renderedFacesCount += levelFaceCount;
      // Update face counts based on which pipeline we're using
    if (useGreedy) {
      this.renderedGreedyFacesCount += levelFaceCount;
      // If we have original buffer, get its actual size for comparison
      if (resources.originalBuffer) {
        this.renderedOriginalFacesCount += resources.originalBuffer.size / 4;
      } else {
        this.renderedOriginalFacesCount += Math.floor(levelFaceCount * 2);
      }
    } else {
      this.renderedOriginalFacesCount += levelFaceCount;      // If we have greedy buffer, get its actual size for comparison
      if (resources.greedyBuffer) {
        this.renderedGreedyFacesCount += resources.greedyBuffer.size / 32;
      } else {
        this.renderedGreedyFacesCount += Math.floor(levelFaceCount * 0.5);
      }
    }
    
    renderPass.draw(6, levelFaceCount, 0, 0);
    this.objectUniformsOffset += 256;
  }
  drawModel(model: Model, modelViewProjectionMatrix: mat4, modelMatrix: mat4, renderPass: GPURenderPassEncoder): void {
    const resources = this.resourceMap.get(model);
    const floatView = new Float32Array(this.transferBuffer, this.objectUniformsOffset);
    const uintView = new Uint32Array(this.transferBuffer, this.objectUniformsOffset);

    floatView.set(modelMatrix, 0);
    floatView.set(modelViewProjectionMatrix, 16);
    uintView[35] = resources.paletteIndex;
    
    const useGreedy = (globalThis as any).useGreedyMesh || false;
    
    // Update the active buffer and bind group based on current setting
    if (useGreedy && resources.greedyBuffer) {
      resources.rasterBuffer = resources.greedyBuffer;
      
      // Create greedy bind group if needed
      if (!resources.greedyBindGroup) {
        resources.greedyBindGroup = this.device.createBindGroup({
          label: 'greedy-model',
          layout: this.greedyBindGroupLayout,
          entries: [
            {
              binding: 0,
              resource: { buffer: this.frameUniforms, size: 256 }
            },
            {
              binding: 1,
              resource: { buffer: this.objectUniforms, size: 256 }
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
              resource: globalThis.tileset.texture!.createView()
            },
            {
              binding: 5,
              resource: this.tileSampler
            }
          ],
        });
      }
      
      renderPass.setBindGroup(0, resources.greedyBindGroup, [this.objectUniformsOffset]);
    } else {
      resources.rasterBuffer = resources.originalBuffer || resources.rasterBuffer;
      
      // Create original bind group if needed
      if (!resources.bindGroup) {
        const descriptor: GPUBindGroupDescriptor = {
          label: 'model',
          layout: this.bindGroupLayout,
          entries: [
            {
              binding: 0,
              resource: { buffer: this.frameUniforms, size: 256 }
            },
            {
              binding: 1,
              resource: { buffer: this.objectUniforms, size: 256 }
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
              resource: globalThis.tileset.texture!.createView()
            },
            {
              binding: 5,
              resource: this.tileSampler
            }
          ],
        };

        resources.bindGroup = this.device.createBindGroup(descriptor);
      }
      
      renderPass.setBindGroup(0, resources.bindGroup, [this.objectUniformsOffset]);
    }
    
    renderPass.setVertexBuffer(0, resources.rasterBuffer);    // Count the faces in the model
    const modelFaceCount = useGreedy ? resources.rasterBuffer.size / 32 : resources.rasterBuffer.size / 4;
    this.renderedFacesCount += modelFaceCount;
    
    // Update face counts based on which pipeline we're using and available buffers
    if (useGreedy) {
      this.renderedGreedyFacesCount += modelFaceCount;
      // If we have original buffer, get its actual size for comparison
      if (resources.originalBuffer) {
        this.renderedOriginalFacesCount += resources.originalBuffer.size / 4;
      } else {
        this.renderedOriginalFacesCount += Math.floor(modelFaceCount * 2);
      }
    } else {
      this.renderedOriginalFacesCount += modelFaceCount;
      // If we have greedy buffer, get its actual size for comparison
      if (resources.greedyBuffer) {
        this.renderedGreedyFacesCount += resources.greedyBuffer.size / 6;
      } else {
        this.renderedGreedyFacesCount += Math.floor(modelFaceCount * 0.5);
      }
    }
    
    renderPass.draw(6, modelFaceCount, 0, 0);

    this.objectUniformsOffset += 256;
  }  /**
   * Get face/vertex statistics for displaying in the UI
   * This now returns the actual count of faces rendered in the current frame
   */
  public getMeshStats(): { faces: number, originalFaces: number, greedyFaces: number } {
    // If we have rendered face data from the current frame, use that
    if (this.renderedFacesCount > 0) {
      return {
        faces: this.renderedFacesCount,
        originalFaces: this.renderedOriginalFacesCount,
        greedyFaces: this.renderedGreedyFacesCount
      };
    }
    
    // Fallback to static counting if we haven't rendered anything yet
    let totalFaces = 0;
    let totalOriginalFaces = 0;
    let totalGreedyFaces = 0;
    
    // Count faces in models that have been loaded
    for (const modelName in globalThis.models) {
      const model = globalThis.models[modelName];
      if (model && model.facesBuffer) {
        const faceCount = model.facesBuffer.size / 16; // 4 bytes per element, 4 elements per face
        totalFaces += faceCount;
        
        // If we've computed both types of meshes for comparison
        if (model.originalFaceCount) {
          totalOriginalFaces += model.originalFaceCount;
        }
        if (model.greedyFaceCount) {
          totalGreedyFaces += model.greedyFaceCount;
        }
      }
    }
      // Also count level faces if available
    if (globalThis.level) {
      // If the level has a rasterBuffer in the resourceMap, use that
      if (this.resourceMap.has(globalThis.level)) {
        const resources = this.resourceMap.get(globalThis.level);
        if (resources && resources.rasterBuffer) {
          const levelFaceCount = resources.rasterBuffer.size / 16; 
          totalFaces += levelFaceCount;
        }
      }
    }
    
    // Ensure we return at least 1 face if level is loaded
    if (totalFaces === 0 && globalThis.level) {
      console.warn('No faces detected in getMeshStats, using default value');
      totalFaces = 1000; // Default fallback value
    }
    
    return {
      faces: totalFaces,
      originalFaces: totalOriginalFaces > 0 ? totalOriginalFaces : totalFaces,
      greedyFaces: totalGreedyFaces > 0 ? totalGreedyFaces : Math.floor(totalFaces * 0.4) // Estimate if not computed
    };
  }

  /**
   * Update the mesh rendering mode for all registered models and levels
   * This should be called when the useGreedyMesh toggle is changed
   */
  updateMeshRenderingMode(): void {
    const useGreedy = (globalThis as any).useGreedyMesh || false;
    console.log(`Switching to ${useGreedy ? 'greedy' : 'original'} mesh rendering`);
    
    // Update all models
    for (const [entity, resources] of this.resourceMap.entries()) {
      if (resources.originalBuffer && resources.greedyBuffer) {
        resources.rasterBuffer = useGreedy ? resources.greedyBuffer : resources.originalBuffer;
        
        // Clear bind groups to force recreation with new pipeline
        resources.bindGroup = null;
        resources.greedyBindGroup = null;
      }
    }
  }
}
