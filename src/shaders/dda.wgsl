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
	voxelpos: vec3i,
	normal: vec3f,
	voxel: u32,
	steps: u32,
	region: vec3i,
};

fn march(raypos: vec3f, raydir: vec3f, empty: u32) -> Hit {
	var hit: Hit;
	hit.voxel = empty;
	hit.steps = 0;

	let dims = vec3i(textureDimensions(voxels));
	let tmin = -raypos / raydir;
	let tmax = (vec3f(dims) - raypos) / raydir;
	let t1 = min(tmin, tmax);
	let t2 = max(tmin, tmax);
	let tnear = max(max(t1.x, t1.y), t1.z);

	let step = vec3i(sign(raydir));

	let startpos = raypos + max(0.0, tnear - 1e-4) * raydir;
	var voxelpos = vec3i(floor(startpos));
	let startbounds = vec3f(voxelpos + max(step, vec3i(0)));

	let tdelta = abs(1.0 / raydir);
	var tnext = abs((startbounds - startpos) / raydir);

	for(;;) {
		hit.steps++;
		var axis: i32;
		var tprev: f32;
		var mask: vec3<bool>;

		mask = tnext.xyz <= min(tnext.yzx, tnext.zxy);
		tprev = min(tnext.x, min(tnext.y, tnext.z));
		tnext += vec3f(mask) * tdelta;
		voxelpos += vec3i(mask) * step;

		if (any(voxelpos < vec3i(0)) || any(voxelpos >= dims)) {
			return hit;
		}

		hit.voxel = textureLoad(voxels, voxelpos, 0).x;
		if (hit.voxel != empty) {
			hit.normal = vec3f(mask) * -vec3f(step);
			hit.voxelpos = voxelpos;
			hit.pos = startpos + tprev * raydir;
			return hit;
		}
	}
}



fn march_2(raypos: vec3f, raydir: vec3f, empty: u32) -> Hit {
	var hit: Hit;
	hit.voxel = empty;
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

	var current_voxel = vec3i(floor(start + eps));
	var current_region = vec3i(current_voxel.x >> 2, current_voxel.y >> 2, current_voxel.z >> 1);

	var region_bounds = vec3f((current_region + max(step, vec3i(0))) * region_size);
	var region_tnext = abs((region_bounds - start) / raydir);

	var tprev = 0.0;

	
	for(;;) {
		hit.steps++;
		hit.region = current_region;

		if (any(current_region < vec3i(0)) || any(current_region >= region_dims)) {
			return hit;
		}

		let region_bits = textureLoad(acceleration, current_region, 0).x;

		if (region_bits != 0u) 
		{
			current_voxel = vec3i(floor(start + tprev * raydir + eps));
			let voxel_bounds = vec3f(current_voxel + max(step, vec3i(0)));
			var voxel_tnext = abs((voxel_bounds - start) / raydir);
			let voxel_min = current_region * region_size;
			let voxel_max = min(voxel_min + region_size, voxel_dims);

			for(;;) {
				if (any(current_voxel < voxel_min) || any(current_voxel >= voxel_max)) {
					break;
				}
				let local_x = current_voxel.x & 3;
				let local_y = current_voxel.y & 3;
				let local_z = current_voxel.z & 1;
				let bit_index = local_x + (local_y * 4) + (local_z * 16);

				if (((region_bits >> u32(bit_index)) & 1u) != 0u) {
					hit.voxel = textureLoad(voxels, current_voxel, 0).x; 
					hit.normal = vec3f(step) * -1.0;
					hit.voxelpos = current_voxel;
					hit.pos = start + tprev * raydir;
					return hit;
				}

				let mask = voxel_tnext.xyz <= min(voxel_tnext.yzx, voxel_tnext.zxy);
				tprev = min(voxel_tnext.x, min(voxel_tnext.y, voxel_tnext.z));
				voxel_tnext += vec3f(mask) * voxel_tdelta;
				current_voxel += vec3i(mask) * step;
			}
		}
		
		tprev = min(region_tnext.x, min(region_tnext.y, region_tnext.z));
		let mask = region_tnext == vec3f(tprev);
		region_tnext += vec3f(mask) * region_tdelta;
		current_region += vec3i(mask) * step;
	}
}


fn march_3(raypos: vec3f, raydir: vec3f, empty: u32) -> Hit {
	var hit: Hit;
	hit.voxel = empty;
	hit.steps = 0;

	let step = vec3i(sign(raydir));
	let eps = raydir * 1e-4;

	let voxel_dims = vec3i(textureDimensions(voxels));
	//let region_dims = vec3i(textureDimensions(voxels, 1)) / 2 + 1;
	let region_dims = (voxel_dims + vec3i(3)) / 4;
	let region_size = vec3i(4);

	let voxel_tdelta = abs(1.0 / raydir);
	let region_tdelta = voxel_tdelta * vec3f(region_size);

	let t1 = -raypos / raydir;
	let t2 = (vec3f(voxel_dims) - raypos) / raydir;
	let t_min = min(t1, t2);
	let t_near = max(max(t_min.x, t_min.y), t_min.z);

	let start = raypos + max(0, t_near) * raydir;

	var current_voxel = vec3i(floor(start + eps));
	var current_region = vec3i(current_voxel.x >> 2, current_voxel.y >> 2, current_voxel.z >> 2);

	var region_bounds = vec3f((current_region + max(step, vec3i(0))) * region_size);
	var region_tnext = abs((region_bounds - start) / raydir);

	var tprev = 0.0;
	for(;;) {
		hit.steps++;
		hit.region = current_region;

		if (any(current_region < vec3i(0)) || any(current_region >= region_dims)) {
			return hit;
		}
		let mip = textureLoad(voxels, current_region / 2, 1u).x;
		let bit_index = u32((current_region.x & 1) + ((current_region.y & 1) << 1) + ((current_region.z & 1) << 2));	

		if (((mip >> bit_index) & 1u) != 0) {
			current_voxel = vec3i(floor(start + tprev * raydir + eps));
			let voxel_bounds = vec3f(current_voxel + max(step, vec3i(0)));
			var voxel_tnext = abs((voxel_bounds - start) / raydir);
			
			//let voxel_min = vec3i(0);
			//let voxel_max = voxel_dims;
			let voxel_min = current_region * region_size;
			let voxel_max = min(voxel_min + region_size, voxel_dims);
			for(;;) {
				if (any(current_voxel < voxel_min) || any(current_voxel >= voxel_max)) {
					break;
				}
				hit.voxel = textureLoad(voxels, current_voxel, 0).x;
				if (hit.voxel != empty) {
					hit.normal = vec3f(step) * -1.0;
					hit.voxelpos = current_voxel;
					hit.pos = start + tprev * raydir;
					return hit;
				}
				let mask = voxel_tnext.xyz <= min(voxel_tnext.yzx, voxel_tnext.zxy);
				tprev = min(voxel_tnext.x, min(voxel_tnext.y, voxel_tnext.z));
				voxel_tnext += vec3f(mask) * voxel_tdelta;
				current_voxel += vec3i(mask) * step;
			}		
		}

		tprev = min(region_tnext.x, min(region_tnext.y, region_tnext.z));
		let mask = region_tnext == vec3f(tprev);
		region_tnext += vec3f(mask) * region_tdelta;
		current_region += vec3i(mask) * step;
	}
}

fn march_4(raypos: vec3f, raydir: vec3f, empty: u32) -> Hit {
    var hit: Hit;
    hit.voxel = empty;
    hit.steps = 0;

    let rsign = vec3i(sign(raydir));
	let rstep = vec3i(step(vec3f(0), raydir));
    let eps = raydir * 1e-4;

    let vdims = vec3i(textureDimensions(voxels));
	let rdims = (vdims + vec3i(3)) / 4;
    let tdelta = abs(1.0 / raydir);

    let t1 = -raypos / raydir;
    let t2 = (vec3f(vdims) - raypos) / raydir;
    let tmin = min(t1, t2);
    let tnear = max(max(tmin.x, tmin.y), tmin.z);

    let start = raypos + max(0.0, tnear) * raydir;

	var mode = 1u;
	var voxel = vec3i(floor(start + eps));
	var voxel_min: vec3i;
	var voxel_max: vec3i;
	var region = vec3i(voxel.x >> 2, voxel.y >> 2, voxel.z >> 2);

	let bounds = vec3f((region + rstep) * 4);
	var rtnext = abs((bounds - start) / raydir);
	var vtnext: vec3f;
	var tprev = 0.0;

    for(;;) {
        hit.steps++;
		if (hit.steps >= 64) {
			return hit;
		}
		
		if (mode == 1u) {
			hit.region = region;

			if (any(region < vec3i(0)) || any(region >= rdims)) {
				return hit;
			}

			let mip = textureLoad(voxels, region / 2, 1u).x;
			let bit_index = u32((region.x & 1) + ((region.y & 1) << 1) + ((region.z & 1) << 2));	

			if (((mip >> bit_index) & 1) != 0) {
				mode = 0u;
				voxel = vec3i(floor(start + tprev * raydir + eps));
				let bounds = vec3f(voxel + rstep);
				vtnext = abs((bounds - start) / raydir);
				voxel_min = region * 4;
				voxel_max = min(voxel_min + 4, vdims);
			} 

			tprev = min(rtnext.x, min(rtnext.y, rtnext.z));
			let mask = rtnext.xyz == vec3f(tprev);
			rtnext += vec3f(mask) * tdelta * 4;
			region += vec3i(mask) * rsign;
		} else {

			if (any(voxel < voxel_min) || any(voxel >= voxel_max)) {
				mode = 1u;
				continue;
			}

			let val = textureLoad(voxels, voxel, 0).x;

			if (val != empty) {
				hit.voxel = val;
				hit.normal = vec3f(rstep) * -1.0;
				hit.voxelpos = voxel;
				hit.pos = start + tprev * raydir;
				return hit;
			}

			tprev = min(vtnext.x, min(vtnext.y, vtnext.z));
			let mask = vtnext.xyz == vec3f(tprev);
			vtnext += vec3f(mask) * tdelta;
			voxel += vec3i(mask) * rsign;
		}
	}
}

fn march_5(raypos: vec3f, raydir: vec3f, empty: u32) -> Hit {
    var hit: Hit;
    hit.voxel = empty;
    hit.steps = 0;

    let rsign = sign(raydir);
	let rstep = step(vec3f(0), raydir);
    let eps = raydir * 1e-4;

    let dims = vec3f(textureDimensions(voxels));
    let tdelta = abs(1.0 / raydir);

    let t1 = -raypos / raydir;
    let t2 = (vec3f(dims) - raypos) / raydir;
    let tmin = min(t1, t2);
	let tmax = max(t1, t2);
    let tnear = max(max(tmin.x, tmin.y), tmin.z);
	let tfar = min(min(tmax.x, tmax.y), tmax.z);

    let start = raypos + max(0, tnear) * raydir;
	let tend = tfar - max(0, tnear);
	var tprev = 0.0;

    for(;;) {
 
		
		var tregion: f32;
		
		for(;;) {
			hit.steps++;
			if (hit.steps >= 256) {
				return hit;
			}	
			if (tprev + 1e-4 >= tend) {
				return hit;
			}

			let region = floor((start + tprev * raydir) / 8 + eps);
			let bounds = 8 *(region + rstep);
			let tnext = abs((bounds - start) / raydir);
			tregion = min(tnext.x, min(tnext.y, tnext.z));

			let mip = textureLoad(voxels, vec3i(region), 1).x;
			if (mip != 0) {
				tregion = min(tregion, tend);
				break;
			}
			tprev = tregion;
		}
		
		for(;;) {
			hit.steps++;
			if (hit.steps >= 256) {
				return hit;
			}	
			if (tprev + 1e-4 >= tregion) {
				break;
			}
			let voxel = floor((start + tprev * raydir) + eps);
			let tex = textureLoad(voxels, vec3i(voxel), 0).x;

			if (tex != empty) {
				hit.voxel = tex;
				hit.normal = vec3f(rstep) * -1.0;
				hit.voxelpos = vec3i(voxel);
				hit.pos = (start + tprev * raydir);
				return hit;
			}

			let bounds = voxel + rstep;
			let tnext = abs((bounds - start) / raydir);
			tprev = min(tnext.x, min(tnext.y, tnext.z));
		}
	}
}

struct FragmentOutput {
	@location(0) color: vec4f,
    @builtin(frag_depth) depth: f32
}

@fragment
fn fs_terrain(in: VertexOutput) -> FragmentOutput {
	var output: FragmentOutput;

	let hit = march(in.rayOrigin, normalize(in.rayDirection), 0u);

	if(hit.voxel == 0) {
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
	output.color = textureSample(tiles, tileSampler, hitUV, i32(hit.voxel - 1u));
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

@id(0) override MARCH_VERSION: u32 = 3;

@fragment
fn fs_model(in: VertexOutput) -> FragmentOutput {
    var output: FragmentOutput;

	let hit = march(in.rayOrigin, normalize(in.rayDirection), 255u);

    // Debug visualization
    var stepHeat = 0.0;
	if (hit.steps > 64u) {
	 	stepHeat = 1.0;
	}
    let debugColor = vec3f(stepHeat, 0.0, 1.0 - stepHeat);
	output.color = vec4f(debugColor, 1.0);
	//return output;

	if (hit.voxel == 255u) {
		discard;
	}

    let clipPos = object_uniforms.model_view_projection * vec4f(hit.pos, 1.0);
    output.depth = (clipPos.z / clipPos.w);
    //let ao = getAO(hit.voxelpos, hit.normal);
    let color = textureLoad(palette, vec2<u32>(hit.voxel, object_uniforms.palette_index), 0);
	output.color = vec4f(color.rgb, 1.0);

    return output;
}

@fragment
fn fs_model_2(in: VertexOutput) -> FragmentOutput {
    var output: FragmentOutput;

	let hit = march_4(in.rayOrigin, normalize(in.rayDirection), 255u);

	let clipPos = object_uniforms.model_view_projection * vec4f(hit.pos, 1.0);
    output.depth = (clipPos.z / clipPos.w);

    // Debug visualization
    var stepHeat = 0.0;
	if (hit.steps > 32) {
	 	stepHeat = 1.0;
	}
	//stepHeat = f32(hit.region.z)  / 32.0;
    let debugColor = vec3f(stepHeat, 0.0, 1.0 - stepHeat);
	
	if (hit.voxel == 255u) {
		output.color = vec4f(debugColor, 1.0);
		return output;
	}

	if (hit.voxel == 255u) {
		discard;
	}

    //let ao = getAO(hit.voxelpos, hit.normal);
    let color = textureLoad(palette, vec2<u32>(hit.voxel, object_uniforms.palette_index), 0);
	output.color = vec4f(color.rgb, 1.0);

    return output;
}