struct FrameUniforms {
	projection: mat4x4f,
	view: mat4x4f,
	camera_position: vec3f,
};

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
@group(0) @binding(6) var acceleration: texture_3d<u32>;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) rayDirection: vec3f,
    @location(1) rayOrigin: vec3f,
    @location(2) debugColor: vec3f,
}

@vertex
fn vs_main(@builtin(vertex_index) vertexID: u32) -> VertexOutput {
    var output: VertexOutput;
    
    let vertices = array<vec3f, 8>(
        vec3f(0.0, 0.0, 0.0),  // 0: left  front bottom
        vec3f(1.0, 0.0, 0.0),  // 1: right front bottom
        vec3f(0.0, 1.0, 0.0),  // 2: left  back  bottom
        vec3f(1.0, 1.0, 0.0),  // 3: right back  bottom
        vec3f(0.0, 0.0, 1.0),  // 4: left  front top
        vec3f(1.0, 0.0, 1.0),  // 5: right front top
        vec3f(0.0, 1.0, 1.0),  // 6: left  back  top
        vec3f(1.0, 1.0, 1.0)   // 7: right back  top
    );

    // Debug colors
    let faceColors = array<vec3f, 6>(
        vec3f(0.0, 0.0, 1.0),  // bottom (-Z) - blue
        vec3f(0.0, 1.0, 1.0),  // top (+Z) - cyan
        vec3f(1.0, 1.0, 0.0),  // back (+Y) - yellow
        vec3f(1.0, 0.0, 0.0),  // front (-Y) - red
        vec3f(0.0, 1.0, 0.0),  // left (-X) - green
        vec3f(1.0, 0.0, 1.0),   // right (+X) - magenta
    );

    let indices = array<u32, 36>(
        0u, 1u, 2u, 2u, 1u, 3u,   // bottom (-Z)
        6u, 5u, 4u, 7u, 5u, 6u,   // top    (+Z)
        2u, 3u, 6u, 6u, 3u, 7u,   // back   (+Y)
        4u, 1u, 0u, 5u, 1u, 4u,   // front  (-Y)
        0u, 2u, 4u, 4u, 2u, 6u,   // left   (-X)
        5u, 3u, 1u, 7u, 3u, 5u,    // right  (+X)
    );

    let textureSize = vec3f(textureDimensions(voxels));
    let position = vertices[indices[vertexID]] * textureSize;
    
	
	let scale = vec3f(
		length(object_uniforms.model[0].xyz),
		length(object_uniforms.model[1].xyz),
		length(object_uniforms.model[2].xyz)
	);
	let invModel = transpose(mat3x3f(
		object_uniforms.model[0].xyz / scale.x,
		object_uniforms.model[1].xyz / scale.y,
		object_uniforms.model[2].xyz / scale.z
	));
	output.rayOrigin = invModel * (uniforms.camera_position - object_uniforms.model[3].xyz) / scale;

    output.rayDirection = position - output.rayOrigin;
    output.debugColor = faceColors[vertexID / 6u];
    output.position = object_uniforms.model_view_projection * vec4f(position, 1.0);
    
    return output;
}

struct Hit {
	pos: vec3f,
	voxel: vec3i,
	normal: vec3f,
	val: u32,
	steps: u32,
};

fn march(raypos: vec3f, raydir: vec3f, empty: u32) -> Hit {
	var hit: Hit;
	hit.val = empty;
	hit.steps = 0;

	let step = vec3i(sign(raydir));
	let eps = raydir * 1e-4;
	
	let voxel_dims = vec3i(textureDimensions(voxels));
	let region_dims = vec3i(textureDimensions(acceleration));
	const region_size = vec3i(4, 4, 2);

	let voxel_tdelta = abs(1.0 / raydir);
	let region_tdelta = voxel_tdelta * vec3f(region_size);

	let t1 = -raypos / raydir;
	let t2 = (vec3f(voxel_dims) - raypos) / raydir;
	let t_min = min(t1, t2);
	let t_near = max(max(t_min.x, t_min.y), t_min.z);

	let start = raypos + max(0, t_near) * raydir;

	hit.voxel = vec3i(floor(start + eps));
	var region = vec3i(hit.voxel.x >> 2, hit.voxel.y >> 2, hit.voxel.z >> 1);

	var region_bounds = vec3f((region + max(step, vec3i(0))) * region_size);
	var region_tnext = abs((region_bounds - start) / raydir);

	var tprev = 0.0;

	
	loop {
		hit.steps++;

		if (any(region < vec3i(0)) || any(region >= region_dims)) {
			return hit;
		}

		let region_bits = textureLoad(acceleration, region, 0).x;

		if (region_bits != 0u) 
		{
			hit.voxel = vec3i(floor(start + tprev * raydir + eps));
			let voxel_bounds = vec3f(hit.voxel + max(step, vec3i(0)));
			var voxel_tnext = abs((voxel_bounds - start) / raydir);
			let voxel_min = region * region_size;
			let voxel_max = min(voxel_min + region_size, voxel_dims);

			loop {
				if (any(hit.voxel < voxel_min) || any(hit.voxel >= voxel_max)) {
					break;
				}
				let local_x = hit.voxel.x & 3;
				let local_y = hit.voxel.y & 3;
				let local_z = hit.voxel.z & 1;
				let bit_index = local_x + (local_y * 4) + (local_z * 16);

				if (((region_bits >> u32(bit_index)) & 1u) != 0u) {
					hit.val = textureLoad(voxels, hit.voxel, 0).x; 
					hit.pos = start + tprev * raydir;
					return hit;
				}

				tprev = min(voxel_tnext.x, min(voxel_tnext.y, voxel_tnext.z));
				let mask = voxel_tnext == vec3f(tprev);
				voxel_tnext += vec3f(mask) * voxel_tdelta;
				hit.voxel += vec3i(mask) * step;
			}
		}
		
		tprev = min(region_tnext.x, min(region_tnext.y, region_tnext.z));
		let mask = region_tnext == vec3f(tprev);
		hit.normal = vec3f(mask) * -vec3f(step);
		region_tnext += vec3f(mask) * region_tdelta;
		region += vec3i(mask) * step;
	}
}


struct FragmentOutput {
	@location(0) color: vec4f,
    @builtin(frag_depth) depth: f32
}

@fragment
fn fs_textured(in: VertexOutput) -> FragmentOutput {
	var output: FragmentOutput;

	let hit = march(in.rayOrigin, normalize(in.rayDirection), 0u);

	if(hit.val == 0) {
		discard;
	}

	let clipPos = object_uniforms.model_view_projection * vec4f(hit.pos, 1.0);
	output.depth = (clipPos.z / clipPos.w);

	var hitUV: vec2f;
	if (abs(hit.normal.x) > 0.0) {
		hitUV = vec2f(hit.normal.x * hit.pos.y, -hit.pos.z);
	} else if (abs(hit.normal.y) > 0.0) {
		hitUV = vec2f(-hit.normal.y * hit.pos.x, -hit.pos.z);
	} else {
		hitUV = vec2f(hit.pos.x, -hit.pos.y);
	}
	output.color = textureSample(tiles, tileSampler, hitUV, i32(hit.val - 1u));
	return output;
}


fn getAO(vpos: vec3i, normal: vec3f) -> f32 {
    var ao = 0.0;
    let dims = vec3i(textureDimensions(voxels));
    
    // Check each cardinal direction except normal direction
    if (abs(normal.x) < 0.1) {
        let right = vpos + vec3i(1,0,0);
        let left = vpos + vec3i(-1,0,0);
        if (all(right >= vec3i(0)) && all(right < dims)) {
            ao += f32(textureLoad(voxels, right, 0).x != 255u) * 0.1;
        }
        if (all(left >= vec3i(0)) && all(left < dims)) {
            ao += f32(textureLoad(voxels, left, 0).x != 255u) * 0.1;
        }
    }
    if (abs(normal.y) < 0.1) {
        let up = vpos + vec3i(0,1,0);
        let down = vpos + vec3i(0,-1,0);
        if (all(up >= vec3i(0)) && all(up < dims)) {
            ao += f32(textureLoad(voxels, up, 0).x != 255u) * 0.1;
        }
        if (all(down >= vec3i(0)) && all(down < dims)) {
            ao += f32(textureLoad(voxels, down, 0).x != 255u) * 0.1;
        }
    }
    if (abs(normal.z) < 0.1) {
        let front = vpos + vec3i(0,0,1);
        let back = vpos + vec3i(0,0,-1);
        if (all(front >= vec3i(0)) && all(front < dims)) {
            ao += f32(textureLoad(voxels, front, 0).x != 255u) * 0.1;
        }
        if (all(back >= vec3i(0)) && all(back < dims)) {
            ao += f32(textureLoad(voxels, back, 0).x != 255u) * 0.1;
        }
    }
    return 1.0 - ao;
}


@fragment
fn fs_model(in: VertexOutput) -> FragmentOutput {
    var output: FragmentOutput;

	let hit = march(in.rayOrigin, normalize(in.rayDirection), 255u);

	let clipPos = object_uniforms.model_view_projection * vec4f(hit.pos, 1.0);
    output.depth = (clipPos.z / clipPos.w);

    // Debug visualization
    var stepHeat = 0.0;
	if (hit.steps > 32) {
	 	stepHeat = 1.0;
	}
	//stepHeat = f32(hit.region.z)  / 32.0;
    let debugColor = vec3f(stepHeat, 0.0, 1.0 - stepHeat);
	

	if (hit.val == 255u) {
		discard;
	}

    //let ao = getAO(hit.voxel, hit.normal);
    let color = textureLoad(palette, vec2<u32>(hit.val, object_uniforms.palette_index), 0);
	output.color = vec4f(color.rgb, 1.0);

    return output;
}