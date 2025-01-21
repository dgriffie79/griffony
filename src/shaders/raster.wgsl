struct FrameUniforms {
    projection: mat4x4f,
    view: mat4x4f,
    camera_position: vec3f,
};

struct ObjectUniforms {
    model_view_projection: mat4x4f,
    model: mat4x4f,
    camera_to_local: mat4x4f,
    model_id: u32,
};

@group(0) @binding(0) var<uniform> frame_uniforms: FrameUniforms;
@group(0) @binding(1) var tiles: texture_2d_array<f32>;
@group(0) @binding(2) var tile_sampler: sampler;

@group(1) @binding(0) var<uniform> object_uniforms: ObjectUniforms;
@group(1) @binding(1) var<uniform> palette: array<vec4u, 48>;

struct VertexInput {
    @location(0) vec4u: face,  
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
    @location(0) uv: vec2f,
    @location(1) @interpolate(flat) voxel: u32
}

@vertex
fn vs_main(in: VertexInput, @builtin(vertex_index) vertex_id) -> VertexOutput {
    var output: VertexOutput;

    let vertices = array<array<vec3f, 6>, 6>(
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
		
		array<vec3f, 6>( // -Y face
            vec3f(0,1,1), vec3f(1,1,0), vec3f(0,1,0),  // tri 1
            vec3f(1,1,1), vec3f(1,1,0), vec3f(0,1,1)   // tri 2
        ),
		array<vec3f, 6>( // -Z face (top)
            vec3f(0,1,0), vec3f(1,0,0), vec3f(0,0,0),  // tri 1
            vec3f(1,1,0), vec3f(1,0,0), vec3f(0,1,0)   // tri 2
        ),
        array<vec3f, 6>( // +Z face (top)
            vec3f(0,0,1), vec3f(1,0,1), vec3f(0,1,1),  // tri 1
            vec3f(0,1,1), vec3f(1,0,1), vec3f(1,1,1)   // tri 2
        )
    );

    let position = vec3f(in.face.xyz);
    let normal = in.face.w;
    let world_position = position + vertices[normal][in.vertex_id];
    output.position = object_uniforms * vec4f(world_position, 1.0);
    
    let local_position = vertices[normal][in.vertex_id];
    output.uv = select(
        select(
            vec2f(local_position.x, local_position.y),  // Z faces
            vec2f(local_position.y, local_position.x),  // Y faces
            normal == 2u || normal == 3u
        ),
        vec2f(local_position.z, local_position.y),      // X faces
        normal == 0u || normal == 1u
    );

    output.voxel = textureLoad(voxels, vec3i(position), 0).r;
    output.color = vec4f(palette[output.voxel].rgb, 1.0);

    return output;
}

@fragment
fn fs_terrain(in: RasterVertexOutput) -> @location(0) vec4f {
	return textureSample(tiles, tileSampler, in.uv, i32(in.voxel));
}
 

 @fragment
fn fs_model(in: RasterVertexOutput) -> @location(0) vec4f {
	return textureSample(tiles, tileSampler, in.uv, i32(in.voxel));
}
 