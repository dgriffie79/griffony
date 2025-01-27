struct FrameUniforms {
	projection: mat4x4f,
	view: mat4x4f,
	camera_position: vec3f,
	viewport: vec2f,
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

struct VertexInput {
	@builtin(vertex_index) vertex_index: u32,
	@location(0) position: vec4u
}

struct VertexOutput {
	@builtin(position) position: vec4f,
	@location(0) @interpolate(flat) voxel: u32,
	@location(1) color: vec4f,
}

struct QuadricProjOutput {
	@location(0) position: vec4f,
	@location(1) point_size: f32,
}

fn quadricProj(os_position: vec3f, voxel_size: f32, object_to_screen_matrix: mat4x4f, half_screen_size: vec2<f32>, position_w: f32) -> QuadricProjOutput {
    let quadric_mat = vec4f(1.0, 1.0, 1.0, -1.0);
    let sphere_radius = voxel_size * 1.732051;
    let sphere_center = vec4f(os_position.xyz, 1.0);
    let model_view_proj = transpose(object_to_screen_matrix);
    
    let projection_basis = mat3x3<f32>(
        model_view_proj[0].xyz, 
        model_view_proj[1].xyz, 
        model_view_proj[3].xyz
    ) * sphere_radius;
    
    let mat_t = mat3x4<f32>(
        vec4<f32>(projection_basis[0], dot(sphere_center, model_view_proj[0])),
        vec4<f32>(projection_basis[1], dot(sphere_center, model_view_proj[1])),
        vec4<f32>(projection_basis[2], dot(sphere_center, model_view_proj[3]))
    );  

    let mat_d = mat3x4<f32>(
        mat_t[0] * quadric_mat, 
        mat_t[1] * quadric_mat, 
        mat_t[2] * quadric_mat
    );
    
    let eq_coefs = vec4f(
        dot(mat_d[0], mat_t[2]), 
        dot(mat_d[1], mat_t[2]), 
        dot(mat_d[0], mat_t[0]), 
        dot(mat_d[1], mat_t[1])) / dot(mat_d[2], mat_t[2]);
        
    var aabb = sqrt(eq_coefs.xy*eq_coefs.xy - eq_coefs.zw);
    aabb *= half_screen_size * 2.0;
    let position = vec4<f32>(eq_coefs.xy * position_w, 0, position_w);
    let point_size = max(aabb.x, aabb.y);
    
    return QuadricProjOutput(position, point_size);
}
/*
void quadricProj(in vec3 osPosition, in float voxelSize, in mat4 objectToScreenMatrix, in vec2 halfScreenSize, inout vec4 position, inout float pointSize) {
	const vec4 quadricMat = vec4(1.0, 1.0, 1.0, -1.0);
	
	float sphereRadius = voxelSize * 1.732051;
	
	vec4 sphereCenter = vec4(osPosition.xyz, 1.0);
	
	mat4 modelViewProj = transpose(objectToScreenMatrix);

	mat3x4 matT = mat3x4( mat3(modelViewProj[0].xyz, modelViewProj[1].xyz, modelViewProj[3].xyz) * sphereRadius);
	
	matT[0].w = dot(sphereCenter, modelViewProj[0]);
	matT[1].w = dot(sphereCenter, modelViewProj[1]);
	matT[2].w = dot(sphereCenter, modelViewProj[3]);
	
	mat3x4 matD = mat3x4(matT[0] * quadricMat, matT[1] * quadricMat, matT[2] * quadricMat);
	
	vec4 eqCoefs =
	
	vec4(dot(matD[0], matT[2]), dot(matD[1], matT[2]), dot(matD[0], matT[0]), dot(matD[1], matT[1])) / dot(matD[2], matT[2]);
	vec4 outPosition = vec4(eqCoefs.x, eqCoefs.y, 0.0, 1.0);

	vec2 AABB = sqrt(eqCoefs.xy*eqCoefs.xy - eqCoefs.zw);
	AABB *= halfScreenSize * 2.0f;

	position.xy = outPosition.xy * position.w;

	pointSize = max(AABB.x, AABB.y);
}
*/

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let corner_offsets = array<vec2f, 4>(
        vec2f(-1.0, -1.0),
        vec2f( 1.0, -1.0),
        vec2f(-1.0,  1.0),
        vec2f( 1.0,  1.0)
    );	
    let indices = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u);
    let corner = corner_offsets[indices[in.vertex_index]];
    
    // Extract clip_pos.w directly
	let position = vec3<f32>(in.position.xyz);
    let clip_pos_w = dot(object_uniforms.model_view_projection[3], vec4f(position, 1.0));
    
	var viewport = uniforms.viewport;
	//viewport = vec2f(1745, 859);

    // Pass clip_pos.w to quadricProj
    let proj = quadricProj(
        position, 
        1.0 / 32, 
        object_uniforms.model_view_projection, 
        viewport * 0.5,
        clip_pos_w
    );
    
    let screen_offset = corner * proj.point_size * 0.5;
    output.position = proj.position + vec4f(screen_offset * clip_pos_w, 0.0, clip_pos_w);

	let offset = corner_offsets[indices[in.vertex_index]];
	var test_position = vec4f(position.x, position.y + offset.y, position.z + offset.x, 1.0);
	test_position = object_uniforms.model_view_projection * test_position;
	//output.position = test_position;
	output.color = vec4f(position * 4 / 255, 1.0);
   	//output.uv = (corner + vec2f(1.0)) * 0.5;
    return output;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    //return vec4f(1.0, 0.0, 0.0, 1.0); // Red color for each billboard
	return in.color;
}