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
    @location(1) uvw: vec3f,
    @location(2) @interpolate(flat) voxel: u32
}

@vertex
fn vs_main (@builtin(vertex_index) vertex_index: u32, @builtin(instance_index) instance_index: u32 ) -> VertexOutput {
    var output: VertexOutput;
    var n = instance_index;

	const face = array<vec2f, 6>(
		vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
		vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)
	);

	let dims = textureDimensions(voxels);
	
	// +x
	if (n < dims.x) {
		let p = vec3f(f32(dims.x) - f32(n), face[vertex_index].xy * vec2f(dims.yz));
		output.position = object_uniforms.model_view_projection * vec4f(p, 1.0);
		output.uvw = p;
		output.uvw.x -= 1;
		//output.color = vec4f(1.0, 0, 0, 1.0);
		return output;
	} 
	n -= dims.x;

	// -x
	if (n < dims.x) {
		let p = vec3f(f32(n), face[vertex_index].yx * vec2f(dims.yz));
		output.position = object_uniforms.model_view_projection * vec4f(p, 1.0);
		output.uvw = p;
		//output.color = vec4f(0.0, 1, 0, 1.0);
		return output;
	}
	n -= dims.x;

	// +y
	if (n < dims.y) {
		let p = vec3f(face[vertex_index].x * f32(dims.x), f32(n), face[vertex_index].y * f32(dims.z));
		output.position = object_uniforms.model_view_projection * vec4f(p, 1.0);
		output.uvw = p;
		//output.color = vec4f(0.0, 0, 1, 1.0);
		return output;
	}
	n -= dims.y;
	
	// -y
	if (n < dims.y) {
		let p = vec3f(face[vertex_index].y * f32(dims.x), f32(dims.y) - f32(n), face[vertex_index].x * f32(dims.z));
		output.position = object_uniforms.model_view_projection * vec4f(p, 1.0);
		output.uvw = p;
		output.uvw.y -= 1;
		// /output.color = vec4f(1.0, 1, 0, 1.0);
		return output;
	}
	n -= dims.y;

	// +z
	if (n < dims.z) {
		let p = vec3f(face[vertex_index].xy * vec2f(dims.xy), f32(dims.z) - f32(n));
		output.position = object_uniforms.model_view_projection * vec4f(p, 1.0);
		output.uvw = p;
		output.uvw.z -= 1;
		return output;
	}
	n -= dims.z;

	// -z
	{
		let p = vec3f(face[vertex_index].yx * vec2f(dims.xy), f32(n));
		output.position = object_uniforms.model_view_projection * vec4f(p, 1.0);
		output.uvw = p;
		return output;
	}

}

@fragment
fn fs_model(in: VertexOutput) -> @location(0) vec4f {
	let voxel = textureLoad(voxels, vec3u(in.uvw), 0).r;

	if (voxel == 255u) {
		discard;
	}

	let color = vec4f(textureLoad(palette, vec2u(voxel, object_uniforms.palette_index), 0).rgb, 1.0);
	return vec4f(color);
}

@fragment
fn fs_textured(in: VertexOutput) -> @location(0) vec4f {
	let voxel = textureLoad(voxels, vec3u(in.uvw), 0).r;

	if (voxel == 0u) {
		discard;
	}

	return textureSample(tiles, tileSampler, in.uvw.xy, i32(in.voxel - 1));
}