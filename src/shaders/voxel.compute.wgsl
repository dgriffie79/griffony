struct Uniforms {
    projection: mat4x4f,
    view: mat4x4f,
    model: mat4x4f,
    viewport: vec2f,
    camera_position: vec3f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var voxels: texture_3d<u32>;
@group(0) @binding(2) var<storage, read_write> output: array<Vertex>;
@group(0) @binding(3) var<storage, read_write> indirect: array<u32>;

struct Vertex {
    @location(0) position: vec4f,
    @location(1) world_pos: vec3f,
    @location(2) color: vec4f,
};

fn is_visible(world_pos: vec3f) -> bool {
    // Basic frustum culling
    let view_pos = uniforms.view * vec4f(world_pos, 1.0);
    if (view_pos.z > -0.1) { return false; }  // Behind camera
    
    let clip_pos = uniforms.projection * view_pos;
    let ndc = clip_pos.xyz / clip_pos.w;
    
    return all(ndc.xy >= vec2f(-1.2)) && all(ndc.xy <= vec2f(1.2));
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let voxel_dims = textureDimensions(voxels);
    
    // Skip if outside voxel grid
    if (any(global_id >= voxel_dims)) {
        return;
    }

    let voxel = textureLoad(voxels, global_id, 0).x;
    if (voxel == 0u) {  // Empty voxel
        return;
    }

    // Convert to world space
    let local_pos = vec3f(global_id) + 0.5;
    var world_pos = (uniforms.model * vec4f(local_pos, 1.0)).xyz;
    
    // Early frustum culling
    if (!is_visible(world_pos)) {
        return;
    }

    // Project to screen space
    let view_pos = uniforms.view * vec4f(world_pos, 1.0);
    let clip_pos = uniforms.projection * view_pos;
    let ndc = clip_pos.xyz / clip_pos.w;
    
    // Convert to screen space
    let screen_pos = (ndc.xy * 0.5 + 0.5) * uniforms.viewport;
    
    // Calculate point size in pixels (can be distance-based)
    let size = 20.0;
    
    // Get output index atomically
    let vertex_base = atomicAdd(&indirect[0], 6u) * 6u;
    
    // Generate quad vertices
    let corners = array<vec2f, 4>(
        screen_pos + vec2f(-size, -size),  // Top-left
        screen_pos + vec2f( size, -size),  // Top-right
        screen_pos + vec2f(-size,  size),  // Bottom-left
        screen_pos + vec2f( size,  size)   // Bottom-right
    );

    // First triangle (top-left, top-right, bottom-left)
    output[vertex_base + 0u].position = vec4f(corners[0], clip_pos.z, clip_pos.w);
    output[vertex_base + 1u].position = vec4f(corners[1], clip_pos.z, clip_pos.w);
    output[vertex_base + 2u].position = vec4f(corners[2], clip_pos.z, clip_pos.w);

    // Second triangle (bottom-left, top-right, bottom-right)
    output[vertex_base + 3u].position = vec4f(corners[2], clip_pos.z, clip_pos.w);
    output[vertex_base + 4u].position = vec4f(corners[1], clip_pos.z, clip_pos.w);
    output[vertex_base + 5u].position = vec4f(corners[3], clip_pos.z, clip_pos.w);
    
    // Store additional vertex data
    for (var i = 0u; i < 6u; i = i + 1u) {
        output[vertex_base + i].world_pos = world_pos;
        output[vertex_base + i].color = vec4f(1.0);  // Will be replaced with palette lookup
    }
}
