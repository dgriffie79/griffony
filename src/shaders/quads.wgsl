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
    @location(0) color: vec4f,
    @location(1) uv: vec2f,
    @location(2) @interpolate(flat) voxel: u32
}

@vertex
fn vs_main (@location(0) face: vec4u, @builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var output: VertexOutput;
    
	var position: vec3u;
	position.x = face.x;
	position.y = face.y;
	position.z = face.z;
	var normal = face.w;
	
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
    
    let world_position = vec3f(position) + vertices[normal][vertex_index];
    output.position = object_uniforms.model_view_projection * vec4f(world_position, 1.0);

	let localPos = vertices[normal][vertex_index];

    switch (normal) {
         // -X
        case 0u {
            output.uv = vec2f(-localPos.y, -localPos.z);
        }
        // +X
        case 1u {
            output.uv = vec2f(localPos.y, -localPos.z);
        }
        // -Y
        case 2u {
            output.uv = vec2f(localPos.x, -localPos.z);
        }
        // +Y
        case 3u {
            output.uv = vec2f(-localPos.x, -localPos.z);
        }
        // -Z
        case 4u {
            output.uv = vec2f(localPos.x, localPos.y);
        }
        // +Z
        case 5u {
            output.uv = vec2f(localPos.x, -localPos.y);
        }
        default {
            output.uv = vec2f(0.0, 0.0);
        }
    }

	let voxel = textureLoad(voxels, position, 0).r;
	output.voxel = voxel;
	output.color = vec4(textureLoad(palette, vec2<u32>(voxel, object_uniforms.palette_index), 0).rgb, 1);
    return output;
}

@fragment
fn fs_textured(in: VertexOutput) -> @location(0) vec4f {
	return textureSample(tiles, tileSampler, in.uv, i32(in.voxel - 1));
}
 
@fragment
fn fs_model(in: VertexOutput) -> @location(0) vec4f {
	return in.color;
}
