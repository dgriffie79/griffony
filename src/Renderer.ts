import { mat4 } from 'gl-matrix';
import type { Model } from './Model';
import type { Tileset } from './Tileset';
import type { Level } from './Level';
import { greedyMesh, optimizedGreedyMesh } from './utils';
import { Logger } from './Logger';
import { getConfig } from './Config';
import { errorHandler, GPUError, ValidationError, ResourceLoadError, Result } from './ErrorHandler.js';
import { gpuResourceManager, resourceManager, ResourceType, AutoCleanup, ManagedResource } from './ResourceManager.js';

export class Renderer {
  private logger = Logger.getInstance();
  private config = getConfig();
  device!: GPUDevice;
  context!: GPUCanvasContext;
  viewport: [number, number] = [0, 0];
    shaders: Record<string, GPUShaderModule> = {};
  terrainPipeline!: GPURenderPipeline;
  modelPipeline!: GPURenderPipeline;
  greedyTerrainPipeline!: GPURenderPipeline;
  greedyModelPipeline!: GPURenderPipeline;
  bindGroupLayout!: GPUBindGroupLayout;
  greedyBindGroupLayout!: GPUBindGroupLayout;  depthTexture!: ManagedResource<GPUTexture>;
    frameTimes: number[] = [];
  lastTimePrint: number = 0;  querySet!: ManagedResource<GPUQuerySet>;
  queryResolve!: ManagedResource<GPUBuffer>;
  queryResult!: ManagedResource<GPUBuffer>;
  
  // Track mesh statistics for each frame
  renderedFacesCount: number = 0;
  renderedOriginalFacesCount: number = 0;
  renderedGreedyFacesCount: number = 0;
  
  frameUniforms!: ManagedResource<GPUBuffer>;
  objectUniforms!: ManagedResource<GPUBuffer>;
  objectUniformsOffset: number = 0;
  paletteTexture!: ManagedResource<GPUTexture>;
  transferBuffer!: ArrayBuffer;
  floatView!: Float32Array;  uintView!: Uint32Array;
  nextPaletteIndex: number = 0;
  tileSampler!: ManagedResource<GPUSampler>;
  resourceMap = new Map<Model | Level, any>();
  async init(): Promise<Result<void>> {
    return errorHandler.safeAsync(async () => {
      await this.initializeWebGPU();
      await this.initializeResources();
      
      // Register cleanup handlers
      AutoCleanup.register(() => this.cleanup());
      
      this.logger.info('RENDERER', 'Renderer initialized successfully');
    }, 'Renderer.init');
  }

  private setupCanvas(): HTMLCanvasElement {
    // Create or get existing canvas
    let canvas = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'webgpu-canvas';
      canvas.style.cssText = 'width: 100%; height: 100%; margin: 0; padding: 0; display: block;';
    }
    
    // Register canvas with resource manager
    const managedCanvas = resourceManager.register(
      canvas,
      ResourceType.Canvas,
      'main-webgpu-canvas'
    );
    
    // Make canvas globally available
    (globalThis as any).canvas = managedCanvas.resource;
    
    return managedCanvas.resource;
  }

  private async initializeResources(): Promise<void> {
    // Create and register GPU resources
    const gpuConfig = this.config.getGPUConfig();
      // Frame uniforms buffer
    this.frameUniforms = gpuResourceManager.createBuffer({
      size: gpuConfig.uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'frame-uniforms'
    });
    
    // Object uniforms buffer  
    this.objectUniforms = gpuResourceManager.createBuffer({
      size: gpuConfig.transferBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'object-uniforms'
    });
    
    // Transfer buffer (CPU side)
    this.transferBuffer = new ArrayBuffer(gpuConfig.transferBufferSize);
    this.floatView = new Float32Array(this.transferBuffer);
    this.uintView = new Uint32Array(this.transferBuffer);
      // Palette texture
    this.paletteTexture = gpuResourceManager.createTexture({
      format: 'rgba8unorm',
      size: [256, 256, 1],
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: 'palette-texture'
    });
    
    // Tile sampler
    this.tileSampler = gpuResourceManager.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      addressModeW: 'repeat',
      label: 'tile-sampler'
    });    // Query resources for performance monitoring
    this.querySet = gpuResourceManager.createQuerySet({
      type: "timestamp",
      count: 2,
      label: 'performance-queries'
    });
    
    this.queryResolve = gpuResourceManager.createBuffer({
      size: 16,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      label: 'query-resolve'
    });
    
    this.queryResult = gpuResourceManager.createBuffer({
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: 'query-result'
    });

    // Initialize frame timing
    this.frameTimes = [];
    this.lastTimePrint = performance.now();
  }

  private cleanup(): void {
    this.logger.info('RENDERER', 'Cleaning up renderer resources');
    
    // Clear resource map
    this.resourceMap.clear();
    
    // Reset face counters
    this.renderedFacesCount = 0;
    this.renderedOriginalFacesCount = 0;
    this.renderedGreedyFacesCount = 0;
    
    // Clear frame timing data
    this.frameTimes = [];
    
    // GPU resources will be cleaned up by gpuResourceManager
    this.logger.info('RENDERER', 'Renderer cleanup completed');
  }
  private async initializeWebGPU(): Promise<void> {
    if (!navigator.gpu) {
      throw new GPUError('WebGPU not supported in this browser', 'initializeWebGPU');
    }
    
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new GPUError('No suitable GPU adapter found', 'requestAdapter');
    }

    try {
      this.device = await adapter.requestDevice({
        requiredFeatures: ['timestamp-query']
      });
    } catch (error) {
      throw new GPUError(
        `Failed to request GPU device: ${(error as Error).message}`,
        'requestDevice'
      );
    }

    // Initialize GPU resource manager
    gpuResourceManager.setDevice(this.device);

    // Setup canvas and context
    const canvas = this.setupCanvas();
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    // Add canvas to DOM if not already present
    if (!canvas.parentElement) {
      document.body.appendChild(canvas);
    }
    
    this.viewport = [canvas.width, canvas.height];
    
    this.context = canvas.getContext('webgpu')!;
    if (!this.context) {
      throw new GPUError('Failed to get WebGPU context from canvas', 'getContext');
    }
    
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
        alphaMode: 'premultiplied',
      });
      
      // Update camera aspect ratio
      if (globalThis.camera) {
        globalThis.camera.aspect = this.viewport[0] / this.viewport[1];
        mat4.perspective(globalThis.camera.projection, globalThis.camera.fov, globalThis.camera.aspect, globalThis.camera.near, globalThis.camera.far);
      }
    });

    this.createDepthTexture();
    
    // Compile shaders and create pipelines
    await this.compileShaders();
    const quadsShader = this.shaders['quads'];
    const greedyShader = this.shaders['greedy'];
    
    this.createBindGroupLayouts();
    this.createPipelines(quadsShader, greedyShader);
  }
  async compileShaders(): Promise<void> {
    const sources = await this.loadShaderSources();
    const modules: Record<string, GPUShaderModule> = {};
    const compilationResults: Promise<void>[] = [];

    for (const name in sources) {
      try {
        const module = this.device.createShaderModule({
          label: name,
          code: sources[name],
        });

        // Check compilation info and log results
        compilationResults.push(
          module.getCompilationInfo().then(info => {
            const hasErrors = info.messages.some(msg => msg.type === 'error');
            if (hasErrors) {
              const errors = info.messages.filter(msg => msg.type === 'error');
              throw new GPUError(
                `Shader compilation failed for ${name}: ${errors.map(e => e.message).join(', ')}`,
                'compileShaders'
              );
            }
            
            this.logger.shaderCompilation(name, !hasErrors, Array.from(info.messages));
          })
        );
        
        modules[name] = module;
      } catch (error) {
        throw new GPUError(
          `Failed to create shader module ${name}: ${(error as Error).message}`,
          'createShaderModule'
        );
      }
    }

    await Promise.all(compilationResults);
    this.logger.info('RENDERER', 'All shader modules compiled successfully');
    this.shaders = modules;
  }  async loadShaderSources(): Promise<Record<string, string>> {
    try {
      const shaders: Record<string, string> = {};
      const shaderModules = (import.meta as any).glob('./shaders/*.wgsl', { query: '?raw', import: 'default' });

      for (const path in shaderModules) {
        const name = path.split('/').pop()!.replace('.wgsl', '');
        try {
          shaders[name] = await shaderModules[path]() as string;
        } catch (error) {
          throw new ResourceLoadError(
            `Failed to load shader source: ${path}`,
            'shader',
            path
          );
        }
      }

      if (Object.keys(shaders).length === 0) {
        throw new ValidationError('No shader files found', 'loadShaderSources');
      }

      return shaders;
    } catch (error) {
      if (error instanceof GPUError || error instanceof ValidationError) {
        throw error;
      }
      throw new ResourceLoadError(
        `Failed to load shader sources: ${(error as Error).message}`,
        'shaders',
        './shaders/*.wgsl'
      );
    }
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
      },      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
        frontFace: 'ccw',
      },
      depthStencil: {
        format: this.depthTexture.resource.format,
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
      },      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
        frontFace: 'ccw',
      },
      depthStencil: {
        format: this.depthTexture.resource.format,
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
      },      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
        frontFace: 'ccw',
      },
      depthStencil: {
        format: this.depthTexture.resource.format,
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
      },      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
        frontFace: 'ccw',
      },
      depthStencil: {
        format: this.depthTexture.resource.format,
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    };

    this.terrainPipeline = this.device.createRenderPipeline(terrainPipelineDescriptor!);
    this.modelPipeline = this.device.createRenderPipeline(modelPipelineDescriptor!);
    this.greedyTerrainPipeline = this.device.createRenderPipeline(greedyTerrainPipelineDescriptor!);
    this.greedyModelPipeline = this.device.createRenderPipeline(greedyModelPipelineDescriptor!);
  }  /**
   * Register a model with the renderer by creating GPU resources
   * @param model The model to register
   */
  registerModel(model: Model): void {
    const resources = this.resourceMap.get(model) || {};
    
    // Create GPU texture and upload voxel data
    this.createModelTexture(model, resources);
    
    // Upload palette data to GPU
    this.uploadModelPalette(model, resources);
    
    // Generate both original and greedy mesh data
    const meshData = this.generateModelMeshes(model);
    
    // Create GPU buffers for mesh data
    this.createModelBuffers(meshData, resources);
    
    // Configure resource mapping and active buffers
    this.configureModelResources(model, resources);
    
    // Log performance statistics and debugging info
    this.logModelStatistics(model, meshData);
  }
  /**
   * Create GPU texture for model voxels and upload voxel data
   * @param model The model containing voxel data
   * @param resources The resource container to store texture
   */
  private createModelTexture(model: Model, resources: any): void {
    const volume = model.volume;
      resources.texture = gpuResourceManager.createTexture({
      size: [volume.sizeX, volume.sizeY, volume.sizeZ],
      dimension: '3d',
      format: 'r8uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      mipLevelCount: 1,
      label: `model-texture-${model.url}`
    });
    
    this.device.queue.writeTexture(
      { texture: resources.texture.resource, mipLevel: 0 },
      volume.voxels,
      {
        bytesPerRow: volume.sizeX,
        rowsPerImage: volume.sizeY
      },
      [volume.sizeX, volume.sizeY, volume.sizeZ]
    );
  }

  /**
   * Upload model palette data to GPU palette texture
   * @param model The model containing palette data
   * @param resources The resource container to store palette index
   */
  private uploadModelPalette(model: Model, resources: any): void {
    const gpuConfig = this.config.getGPUConfig();
      this.device.queue.writeTexture(
      {
        texture: this.paletteTexture.resource,
        aspect: 'all',
        origin: [0, this.nextPaletteIndex, 0],
        mipLevel: 0,
      },
      model.palette!,
      { bytesPerRow: gpuConfig.paletteBufferStride },
      [255, 1, 1]
    );
    
    resources.paletteIndex = this.nextPaletteIndex++;
  }

  /**
   * Generate both original and greedy mesh data for the model
   * @param model The model to generate meshes for
   * @returns Object containing both mesh data arrays
   */
  private generateModelMeshes(model: Model): { originalFaces: Uint8Array | Uint32Array, greedyFaces: Uint8Array | Uint32Array } {
    const volume = model.volume;
    
    const originalFaces = model.volume.generateFaces();
    const greedyFaces = optimizedGreedyMesh(volume.voxels, volume.sizeX, volume.sizeY, volume.sizeZ, volume.emptyValue);
    
    return { originalFaces, greedyFaces };
  }
  /**
   * Create GPU buffers for mesh data and upload to GPU
   * @param meshData Object containing original and greedy mesh data
   * @param resources The resource container to store buffers
   */
  private createModelBuffers(meshData: { originalFaces: Uint8Array | Uint32Array, greedyFaces: Uint8Array | Uint32Array }, resources: any): void {    // Create and upload original mesh buffer
    resources.originalBuffer = gpuResourceManager.createBuffer({
      size: meshData.originalFaces.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: `model-original-buffer-${Date.now()}`
    });
    this.device.queue.writeBuffer(resources.originalBuffer.resource, 0, meshData.originalFaces);
    
    // Create and upload greedy mesh buffer
    resources.greedyBuffer = gpuResourceManager.createBuffer({
      size: meshData.greedyFaces.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: `model-greedy-buffer-${Date.now()}`
    });
    this.device.queue.writeBuffer(resources.greedyBuffer.resource, 0, meshData.greedyFaces);
  }

  /**
   * Configure resource mapping and set active buffer based on current settings
   * @param model The model being registered
   * @param resources The resource container with buffers
   */
  private configureModelResources(model: Model, resources: any): void {
    // Set the active buffer based on current setting
    const useGreedy = (globalThis as any).useGreedyMesh || false;
    resources.rasterBuffer = useGreedy ? resources.greedyBuffer : resources.originalBuffer;

    // Store resources in the resource map
    this.resourceMap.set(model, resources);
  }

  /**
   * Log performance statistics and debugging information for the model
   * @param model The model that was processed
   * @param meshData Object containing mesh data for statistics
   */
  private logModelStatistics(model: Model, meshData: { originalFaces: Uint8Array | Uint32Array, greedyFaces: Uint8Array | Uint32Array }): void {
    const volume = model.volume;
    
    // Log mesh statistics using centralized logger
    this.logger.meshStats(model.url, meshData.originalFaces.length / 4, meshData.greedyFaces.length / 8, {
      originalFaces: meshData.originalFaces.length / 4,
      greedyFaces: meshData.greedyFaces.length / 8,
      dimensions: `${volume.sizeX}x${volume.sizeY}x${volume.sizeZ}`
    });

    // Count faces by direction for debugging
    this.logger.debug('RENDERER', 'Face distribution analysis', {
      originalFaces: this.getFaceCountsByDirection(meshData.originalFaces, 4),
      greedyFaces: this.getFaceCountsByDirection(meshData.greedyFaces, 8)
    });
  }

  /**
   * Helper method for analyzing face distribution by direction for debugging
   * @param faces The face data array to analyze
   * @param stride The stride between face elements
   * @returns Object with face counts by direction (+X, -X, +Y, -Y, +Z, -Z)
   */
  private getFaceCountsByDirection(faces: Uint8Array | Uint32Array, stride: number): { [key: string]: number } {
  const normalNames = ['-X', '+X', '-Y', '+Y', '-Z', '+Z'];
  const counts = [0, 0, 0, 0, 0, 0];
  
  for (let i = 0; i < faces.length; i += stride) {
    const normal = faces[i + 3];
    if (normal >= 0 && normal < 6) {
      counts[normal]++;
    }
  }
  
  const result: { [key: string]: number } = {};
  normalNames.forEach((name, i) => {
    result[name] = counts[i];
  });
  
  return result;
}
  registerTileset(tileset: Tileset): void {
    const width = tileset.tileWidth;
    const height = tileset.tileHeight;
    const count = tileset.numTiles;    const texture = gpuResourceManager.createTexture({
      size: [width, height, count],
      format: 'rgba8unorm',
      dimension: '2d',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      label: `tileset-texture-${tileset.url}`
    });

    this.device.queue.writeTexture(
      { texture: texture.resource },
      tileset.imageData!.data,
      {
        bytesPerRow: width * 4,
        rowsPerImage: height
      },
      [width, height, count]
    );
    tileset.texture = texture.resource;
  }
  registerLevel(level: Level): void {
    const volume = level.volume;
    const resources = this.resourceMap.get(level) || {};
      resources.texture = gpuResourceManager.createTexture({
      size: [volume.sizeX, volume.sizeY, volume.sizeZ],
      dimension: '3d',
      format: 'r16uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: `level-texture-${level.url}`
    });
    
    this.device.queue.writeTexture(
      { texture: resources.texture.resource },
      volume.voxels,
      {
        bytesPerRow: volume.sizeX * 2,
        rowsPerImage: volume.sizeY
      },
      [volume.sizeX, volume.sizeY, volume.sizeZ]
    );

    // Generate both original and greedy mesh data
    const meshStartTime = performance.now();
    const originalFaces = volume.generateFaces();
    const greedyFaces = optimizedGreedyMesh(volume.voxels, volume.sizeX, volume.sizeY, volume.sizeZ, volume.emptyValue);
    const meshEndTime = performance.now();
    
    this.logger.performance('Level mesh generation', meshEndTime - meshStartTime, 
      `Generated ${originalFaces.length / 4} original faces, ${greedyFaces.length / 4} greedy faces`);
      // Store both mesh types in resources using GPU resource manager
    const bufferStartTime = performance.now();
    resources.originalBuffer = gpuResourceManager.createBuffer({
      size: originalFaces.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: `level-original-buffer-${level.url}`
    });
    this.device.queue.writeBuffer(resources.originalBuffer.resource, 0, originalFaces);
    
    resources.greedyBuffer = gpuResourceManager.createBuffer({
      size: greedyFaces.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: `level-greedy-buffer-${level.url}`
    });
    this.device.queue.writeBuffer(resources.greedyBuffer.resource, 0, greedyFaces);
    
    // Set the active buffer based on current setting
    const useGreedy = (globalThis as any).useGreedyMesh || false;
    resources.rasterBuffer = useGreedy ? resources.greedyBuffer : resources.originalBuffer;
    
    const bufferEndTime = performance.now();
    this.logger.performance('Buffer creation and upload', bufferEndTime - bufferStartTime);

    this.resourceMap.set(level, resources);
    this.logger.info('RENDERER', 'Level terrain mesh registered with renderer');
  }  createDepthTexture(): void {
    // Dispose of existing depth texture if it exists
    if (this.depthTexture) {
      gpuResourceManager.disposeResource(this.depthTexture);
    }

    this.depthTexture = gpuResourceManager.createTexture({
      size: [this.viewport[0], this.viewport[1], 1],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      label: 'depth-texture'
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
      }],      depthStencilAttachment: {
        view: this.depthTexture.resource.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
      timestampWrites: {
        querySet: this.querySet.resource,
        beginningOfPassWriteIndex: 0,
        endOfPassWriteIndex: 1,
      }
    });    const camera = globalThis.camera;
    this.device.queue.writeBuffer(this.frameUniforms.resource, 0, camera.projection as Float32Array);
    this.device.queue.writeBuffer(this.frameUniforms.resource, 64, camera.view as Float32Array);
    if (camera.entity) {
      this.device.queue.writeBuffer(this.frameUniforms.resource, 128, camera.entity.worldPosition as Float32Array);
    }
    this.device.queue.writeBuffer(this.frameUniforms.resource, 144, new Float32Array(this.viewport));

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
      // - That are the first-person weapon      // - That are any entity parented to the player (like third-person weapons)
      const isWeaponAttachedToPlayer = e.parent === player || isChildOf(e, player);
      
      // Get rendering configuration
      const renderingConfig = this.config.getRenderingConfig();
      
      if (e.model && 
          e !== player && 
          e !== player.fpWeapon && 
          !isWeaponAttachedToPlayer) {const offsetMatrix = mat4.fromTranslation(mat4.create(), [-e.model.volume.sizeX / 2, -e.model.volume.sizeY / 2, 0]);
        const modelMatrix = mat4.fromRotationTranslationScale(mat4.create(), e.worldRotation, e.worldPosition, [renderingConfig.modelScale, renderingConfig.modelScale, renderingConfig.modelScale]);
        mat4.multiply(modelMatrix, modelMatrix, offsetMatrix);
        const modelViewProjectionMatrix = mat4.multiply(mat4.create(), viewProjectionMatrix, modelMatrix);
        this.drawModel(e.model, modelViewProjectionMatrix, modelMatrix, renderPass);      }      // Update animation frames
      e.animationFrame++;
      if (e.animationFrame > renderingConfig.maxAnimationFrame) {
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
    }    this.device.queue.writeBuffer(this.objectUniforms.resource, 0, this.transferBuffer, 0, this.objectUniformsOffset);

    renderPass.end();
    commandEncoder.resolveQuerySet(this.querySet.resource, 0, 2, this.queryResolve.resource, 0);
    if (this.queryResult.resource.mapState === 'unmapped') {
      commandEncoder.copyBufferToBuffer(this.queryResolve.resource, 0, this.queryResult.resource, 0, this.queryResult.resource.size);
    }    this.device.queue.submit([commandEncoder.finish()]);

    if (this.queryResult.resource.mapState === 'unmapped') {
      await this.queryResult.resource.mapAsync(GPUMapMode.READ);
      const queryData = new BigUint64Array(this.queryResult.resource.getMappedRange());
      const delta = queryData[1] - queryData[0];
      this.queryResult.resource.unmap();
      const frameTimeMs = Number(delta) / 1e6;
      this.frameTimes.push(frameTimeMs);
      const now = performance.now();      if (now - this.lastTimePrint >= 1000) {
        const sum = this.frameTimes.reduce((a, b) => a + b, 0);
        const avgFrameTime = sum / this.frameTimes.length;
        this.logger.performance('Average frame time', avgFrameTime, 
          `Over last ${this.frameTimes.length} frames`);
        this.frameTimes.length = 0;
        this.lastTimePrint = now;
      }
    }
  }  drawLevel(level: Level, modelViewProjectionMatrix: mat4, renderPass: GPURenderPassEncoder): void {
    const gpuConfig = this.config.getGPUConfig();
    const resources = this.resourceMap.get(level);
    const floatView = new Float32Array(this.transferBuffer, this.objectUniformsOffset);
    floatView.set(modelViewProjectionMatrix, 0);
    floatView.set(modelViewProjectionMatrix, 16);
    
    const useGreedy = (globalThis as any).useGreedyMesh || false;
    
    // Update the active buffer and bind group based on current setting
    if (useGreedy && resources.greedyBuffer) {
      resources.rasterBuffer = resources.greedyBuffer;
      
      // Create greedy bind group if needed
      if (!resources.greedyBindGroup) {        resources.greedyBindGroup = this.device.createBindGroup({
          layout: this.greedyBindGroupLayout,
          entries: [
            {
              binding: 0,
              resource: { buffer: this.frameUniforms.resource, size: gpuConfig.uniformBufferSize }
            },
            {
              binding: 1,
              resource: { buffer: this.objectUniforms.resource, size: gpuConfig.uniformBufferSize }
            },
            {
              binding: 2,
              resource: resources.texture.resource.createView()
            },
            {
              binding: 3,
              resource: this.paletteTexture.resource.createView()
            },
            {
              binding: 4,
              resource: globalThis.tileset.texture!.createView()
            },
            {
              binding: 5,
              resource: this.tileSampler.resource
            }
          ],
        });
      }
      
      renderPass.setPipeline(this.greedyTerrainPipeline);
      renderPass.setBindGroup(0, resources.greedyBindGroup, [this.objectUniformsOffset]);
    } else {
      resources.rasterBuffer = resources.originalBuffer || resources.rasterBuffer;
        // Create original bind group if needed
      if (!resources.bindGroup) {        resources.bindGroup = this.device.createBindGroup({
          layout: this.bindGroupLayout,
          entries: [
            {
              binding: 0,
              resource: { buffer: this.frameUniforms.resource, size: gpuConfig.uniformBufferSize }
            },
            {
              binding: 1,
              resource: { buffer: this.objectUniforms.resource, size: gpuConfig.uniformBufferSize }
            },
            {
              binding: 2,
              resource: resources.texture.resource.createView()
            },
            {
              binding: 3,
              resource: this.paletteTexture.resource.createView()
            },
            {
              binding: 4,
              resource: globalThis.tileset.texture!.createView()
            },
            {
              binding: 5,
              resource: this.tileSampler.resource
            }
          ],
        });
      }
      
      renderPass.setPipeline(this.terrainPipeline);
      renderPass.setBindGroup(0, resources.bindGroup, [this.objectUniformsOffset]);
    }
      renderPass.setVertexBuffer(0, resources.rasterBuffer.resource);    // Count the faces in the level
    const levelFaceCount = useGreedy ? resources.rasterBuffer.resource.size / 32 : resources.rasterBuffer.resource.size / 4;
    this.renderedFacesCount += levelFaceCount;
      // Update face counts based on which pipeline we're using
    if (useGreedy) {
      this.renderedGreedyFacesCount += levelFaceCount;
      // If we have original buffer, get its actual size for comparison
      if (resources.originalBuffer) {
        this.renderedOriginalFacesCount += resources.originalBuffer.resource.size / 4;
      } else {
        this.renderedOriginalFacesCount += Math.floor(levelFaceCount * 2);
      }
    } else {
      this.renderedOriginalFacesCount += levelFaceCount;      // If we have greedy buffer, get its actual size for comparison
      if (resources.greedyBuffer) {
        this.renderedGreedyFacesCount += resources.greedyBuffer.resource.size / 32;
      } else {
        this.renderedGreedyFacesCount += Math.floor(levelFaceCount * 0.5);
      }
    }
    
    renderPass.draw(6, levelFaceCount, 0, 0);
    this.objectUniformsOffset += 256;
  }  drawModel(model: Model, modelViewProjectionMatrix: mat4, modelMatrix: mat4, renderPass: GPURenderPassEncoder): void {
    const gpuConfig = this.config.getGPUConfig();
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
      if (!resources.greedyBindGroup) {        resources.greedyBindGroup = this.device.createBindGroup({          label: 'greedy-model',
          layout: this.greedyBindGroupLayout,
          entries: [
            {
              binding: 0,
              resource: { buffer: this.frameUniforms.resource, size: gpuConfig.uniformBufferSize }
            },
            {
              binding: 1,
              resource: { buffer: this.objectUniforms.resource, size: gpuConfig.uniformBufferSize }
            },
            {
              binding: 2,
              resource: resources.texture.resource.createView()
            },
            {
              binding: 3,
              resource: this.paletteTexture.resource.createView()
            },
            {
              binding: 4,
              resource: globalThis.tileset.texture!.createView()
            },
            {
              binding: 5,
              resource: this.tileSampler.resource
            }
          ],
        });
      }
      
      renderPass.setBindGroup(0, resources.greedyBindGroup, [this.objectUniformsOffset]);
    } else {
      resources.rasterBuffer = resources.originalBuffer || resources.rasterBuffer;
      
      // Create original bind group if needed
      if (!resources.bindGroup) {        const descriptor: GPUBindGroupDescriptor = {
          label: 'model',
          layout: this.bindGroupLayout,
          entries: [            {
              binding: 0,
              resource: { buffer: this.frameUniforms.resource, size: gpuConfig.uniformBufferSize }
            },
            {
              binding: 1,
              resource: { buffer: this.objectUniforms.resource, size: gpuConfig.uniformBufferSize }
            },
            {
              binding: 2,
              resource: resources.texture.resource.createView()
            },
            {
              binding: 3,
              resource: this.paletteTexture.resource.createView()
            },
            {
              binding: 4,
              resource: globalThis.tileset.texture!.createView()
            },
            {
              binding: 5,
              resource: this.tileSampler.resource
            }
          ],
        };

        resources.bindGroup = this.device.createBindGroup(descriptor);
      }
      
      renderPass.setBindGroup(0, resources.bindGroup, [this.objectUniformsOffset]);
    }
      renderPass.setVertexBuffer(0, resources.rasterBuffer.resource);    // Count the faces in the model
    const modelFaceCount = useGreedy ? resources.rasterBuffer.resource.size / 32 : resources.rasterBuffer.resource.size / 4;
    this.renderedFacesCount += modelFaceCount;
    
    // Update face counts based on which pipeline we're using and available buffers
    if (useGreedy) {
      this.renderedGreedyFacesCount += modelFaceCount;
      // If we have original buffer, get its actual size for comparison
      if (resources.originalBuffer) {
        this.renderedOriginalFacesCount += resources.originalBuffer.resource.size / 4;
      } else {
        this.renderedOriginalFacesCount += Math.floor(modelFaceCount * 2);
      }
    } else {
      this.renderedOriginalFacesCount += modelFaceCount;
      // If we have greedy buffer, get its actual size for comparison
      if (resources.greedyBuffer) {
        this.renderedGreedyFacesCount += resources.greedyBuffer.resource.size / 6;
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
    }      // Also count level faces if available
    if (globalThis.level) {
      // If the level has a rasterBuffer in the resourceMap, use that
      if (this.resourceMap.has(globalThis.level)) {
        const resources = this.resourceMap.get(globalThis.level);
        if (resources && resources.rasterBuffer) {
          const levelFaceCount = resources.rasterBuffer.resource.size / 16; 
          totalFaces += levelFaceCount;
        }
      }
    }
      // Ensure we return at least 1 face if level is loaded
    if (totalFaces === 0 && globalThis.level) {
      this.logger.warn('RENDERER', 'No faces detected in getMeshStats, using default value');
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
    this.logger.info('RENDERER', `Switching to ${useGreedy ? 'greedy' : 'original'} mesh rendering`);
    
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
