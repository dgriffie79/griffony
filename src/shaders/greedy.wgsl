struct FrameUniforms {
	projection: mat4x4f,
	view: mat4x4f,
	camera_position: vec3f,
}

struct ObjectUniforms {
	model: mat4x4f,
	model_view_projection: mat4x4f,
	camera_position_local: vec3f,
	palette_index: u32
}

@group(0) @binding(0) var<uniform> uniforms: FrameUniforms;
@group(0) @binding(1) var<uniform> object_uniforms: ObjectUniforms;
@group(0) @binding(2) var voxels: texture_3d<u32>;
@group(0) @binding(3) var palette: texture_2d<f32>;
@group(0) @binding(4) var tiles: texture_2d_array<f32>;
@group(0) @binding(5) var tileSampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) local_position: vec3f,
    @location(2) voxel_position: vec3f,
}

@vertex
fn vs_main(@location(0) face: vec4u, @location(1) size: vec2u, @builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var output: VertexOutput;
    
    // Extract face data: x, y, z, normal, width, height
    var position: vec3u;
    position.x = face.x;
    position.y = face.y;
    position.z = face.z;
    var normal = face.w;
    var width = f32(size.x);
    var height = f32(size.y);
      // Generate vertices for variable-sized quads with proper face orientation
    var world_offset: vec3f;    // Use the same vertex patterns as original quads.wgsl but scaled appropriately
    let unit_vertices = array<array<vec3f, 6>, 6>(
        array<vec3f, 6>( // -X face
            vec3f(0,1,0), vec3f(0,0,0), vec3f(0,1,1),  // tri 1
            vec3f(0,1,1), vec3f(0,0,0), vec3f(0,0,1)   // tri 2
        ),
        array<vec3f, 6>( // +X face
            vec3f(1,0,0), vec3f(1,1,0), vec3f(1,0,1),  // tri 1
            vec3f(1,0,1), vec3f(1,1,0), vec3f(1,1,1)   // tri 2
        ),
        array<vec3f, 6>( // -Y face
            vec3f(0,0,0), vec3f(1,0,0), vec3f(0,0,1),  // tri 1
            vec3f(0,0,1), vec3f(1,0,0), vec3f(1,0,1)   // tri 2
        ),
        array<vec3f, 6>( // +Y face
            vec3f(0,1,1), vec3f(1,1,0), vec3f(0,1,0),  // tri 1
            vec3f(1,1,1), vec3f(1,1,0), vec3f(0,1,1)   // tri 2
        ),
        array<vec3f, 6>( // -Z face
            vec3f(0,1,0), vec3f(1,0,0), vec3f(0,0,0),  // tri 1
            vec3f(1,1,0), vec3f(1,0,0), vec3f(0,1,0)   // tri 2
        ),
        array<vec3f, 6>( // +Z face
            vec3f(0,0,1), vec3f(1,0,1), vec3f(0,1,1),  // tri 1
            vec3f(0,1,1), vec3f(1,0,1), vec3f(1,1,1)   // tri 2
        )
    );
      // Get the unit vertex and scale it appropriately for each face direction
    let unit_vertex = unit_vertices[normal][vertex_index];
      switch (normal) {
        // -X face: width=Y-extent, height=Z-extent
        case 0u {
            world_offset = vec3f(unit_vertex.x, unit_vertex.y + (unit_vertex.y * (width - 1.0)), unit_vertex.z + (unit_vertex.z * (height - 1.0)));
            // Scale UV by width/height to repeat texture for each voxel
            output.uv = vec2f(-unit_vertex.y * width, -unit_vertex.z * height);
        }
        // +X face: width=Y-extent, height=Z-extent (same as -X)
        case 1u {
            world_offset = vec3f(unit_vertex.x, unit_vertex.y + (unit_vertex.y * (width - 1.0)), unit_vertex.z + (unit_vertex.z * (height - 1.0)));
            // Scale UV by width/height to repeat texture for each voxel
            output.uv = vec2f(unit_vertex.y * width, -unit_vertex.z * height);
        }
        // -Y face: width=Z-extent, height=X-extent
        case 2u {
            world_offset = vec3f(unit_vertex.x + (unit_vertex.x * (height - 1.0)), unit_vertex.y, unit_vertex.z + (unit_vertex.z * (width - 1.0)));
            // Scale UV by height/width to repeat texture for each voxel
            output.uv = vec2f(unit_vertex.x * height, -unit_vertex.z * width);
        }
        // +Y face: width=Z-extent, height=X-extent (same as -Y)
        case 3u {
            world_offset = vec3f(unit_vertex.x + (unit_vertex.x * (height - 1.0)), unit_vertex.y, unit_vertex.z + (unit_vertex.z * (width - 1.0)));
            // Scale UV by height/width to repeat texture for each voxel
            output.uv = vec2f(-unit_vertex.x * height, -unit_vertex.z * width);
        }
        // -Z face: width=X-extent, height=Y-extent
        case 4u {
            world_offset = vec3f(unit_vertex.x + (unit_vertex.x * (width - 1.0)), unit_vertex.y + (unit_vertex.y * (height - 1.0)), unit_vertex.z);
            // Scale UV by width/height to repeat texture for each voxel
            output.uv = vec2f(unit_vertex.x * width, unit_vertex.y * height);
        }
        // +Z face: width=X-extent, height=Y-extent (same as -Z)
        case 5u {
            world_offset = vec3f(unit_vertex.x + (unit_vertex.x * (width - 1.0)), unit_vertex.y + (unit_vertex.y * (height - 1.0)), unit_vertex.z);
            // Scale UV by width/height to repeat texture for each voxel
            output.uv = vec2f(unit_vertex.x * width, -unit_vertex.y * height);
        }
        default {
            world_offset = vec3f(0.0, 0.0, 0.0);
            output.uv = vec2f(0.0, 0.0);
        }
    }
	
	let world_position = vec3f(position) + world_offset;
    output.position = object_uniforms.model_view_projection * vec4f(world_position, 1.0);
    output.local_position = world_position;
    output.voxel_position = vec3f(position);  // Pass the original voxel position
    
    return output;
}

@fragment
fn fs_textured(in: VertexOutput) -> @location(0) vec4f {
    // For positive axis faces, vertices extend beyond the base voxel position
    // so we need to sample the original voxel position, not the extended position
    var sample_pos = floor(in.local_position);
    
    // Adjust for positive faces: if we're sampling at the extended position,
    // we need to sample the voxel one position back
    if (sample_pos.x > in.voxel_position.x) { sample_pos.x = in.voxel_position.x; }
    if (sample_pos.y > in.voxel_position.y) { sample_pos.y = in.voxel_position.y; }
    if (sample_pos.z > in.voxel_position.z) { sample_pos.z = in.voxel_position.z; }
    
    let voxel_value = textureLoad(voxels, vec3i(sample_pos), 0).r;
    return textureSample(tiles, tileSampler, in.uv, i32(voxel_value - 1u));
}
 
@fragment
fn fs_model(in: VertexOutput) -> @location(0) vec4f {
    // For the untextured model shader, simply use the original voxel position
    // without any position adjustment (similar to quads.wgsl approach)
    let voxel_value = textureLoad(voxels, vec3u(in.voxel_position), 0).r;
    return vec4f(textureLoad(palette, vec2u(voxel_value, object_uniforms.palette_index), 0).rgb, 1.0); 
}
