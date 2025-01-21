
struct Uniforms {
    modelViewProjection: mat4x4f,
    model: mat4x4f,
	cameraPosition: vec3f,
	cameraObjectPosition: vec3f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var tiles: texture_2d_array<f32>;
@group(0) @binding(2) var tileSampler: sampler;
@group(0) @binding(3) var voxels: texture_3d<u32>;

@group(1) @binding(0) var voxels: texture_3d<u32>;
@group(1) @binding(1) var<uniform> palette: array<vec4u, 48>;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) rayDirection: vec3f,
    @location(1) rayOrigin: vec3f,
    @location(2) debugColor: vec3f,
};

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
		length(uniforms.model[0].xyz),
		length(uniforms.model[1].xyz),
		length(uniforms.model[2].xyz)
	);
	let invModel = transpose(mat3x3f(
		uniforms.model[0].xyz / scale.x,
		uniforms.model[1].xyz / scale.y,
		uniforms.model[2].xyz / scale.z
	));
	output.rayOrigin = invModel * (uniforms.cameraPosition - uniforms.model[3].xyz) / scale;

	output.rayOrigin = uniforms.cameraObjectPosition;
    output.rayDirection = position - output.rayOrigin;
    output.debugColor = faceColors[vertexID / 6u];
    output.position = uniforms.modelViewProjection * vec4f(position, 1.0);
    
    return output;
}

struct Hit {
	pos: vec3f,
	voxelpos: vec3i,
	normal: vec3f,
	voxel: u32,
	steps: u32,
};

fn march(raypos: vec3f, raydir: vec3f, empty: u32) -> Hit {
	var hit: Hit;
	hit.voxel = empty;
	hit.steps = 0;

	if(!all(raydir == raydir)) {
		return hit;		
	}

	let dims = vec3i(textureDimensions(voxels));
	let tmin = -raypos / raydir;
	let tmax = (vec3f(dims) - raypos) / raydir;
	let t1 = min(tmin, tmax);
	let t2 = max(tmin, tmax);
	let tnear = max(max(t1.x, t1.y), t1.z);
	let tfar = min(min(t2.x, t2.y), t2.z);

	if (tnear > tfar || tfar < 0.0) {
		return hit;
	}

	let startpos = raypos + max(0.0, tnear - 1e-4) * raydir;
	var voxelpos = vec3i(floor(startpos));
	let step = vec3i(sign(raydir));
	let startbounds = vec3f(voxelpos + max(step, vec3i(0)));
	let tdelta = abs(1.0 / raydir);
	var tnext = (startbounds - startpos) / raydir;

	let maxsteps = dims.x + dims.y + dims.z;
	for(;;) {
		hit.steps++;
		var axis: i32;
		var tprev: f32;

		if (tnext.x < tnext.y) {
			if (tnext.x < tnext.z) {
				axis = 0;
				voxelpos.x += step.x;
				tnext.x += tdelta.x;
			} else {
				axis = 2;
				voxelpos.z += step.z;
				tnext.z += tdelta.z;
			}
		} else if (tnext.y < tnext.z) {
			axis = 1;
			voxelpos.y += step.y;
			tnext.y += tdelta.y;
		} else {
			axis = 2;
			voxelpos.z += step.z;
			tnext.z += tdelta.z;
		}

		if(!all(voxelpos >= vec3i(0)) || !all(voxelpos < dims)) {
			return hit;
		}

		hit.voxel = textureLoad(voxels, voxelpos, 0).x;
		if (hit.voxel != empty) {
			hit.normal = vec3f(0.0);
			hit.normal[axis] = f32(step[axis]);
			hit.voxelpos = voxelpos;
			let t = tnext[axis] - tdelta[axis];
			hit.pos = startpos + t * raydir;
			return hit;
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

	let clipPos = uniforms.modelViewProjection * vec4f(hit.pos, 1.0);
	output.depth = (clipPos.z / clipPos.w);

	var hitUV: vec2f;
	if (abs(hit.normal.x) > 0.0) {
		hitUV = vec2f(-hit.normal.x * hit.pos.y, -hit.pos.z);
	} else if (abs(hit.normal.y) > 0.0) {
		hitUV = vec2f(hit.normal.y * hit.pos.x, -hit.pos.z);
	} else {
		hitUV = vec2f(hit.pos.x, -hit.pos.y);
	}
	output.color = textureSample(tiles, tileSampler, hitUV, i32(hit.voxel - 1u));
	return output;
}

fn getPaletteColor(index: u32) -> vec4f {
	let rOffset = index * 3u;
	let gOffset = rOffset + 1u;
	let bOffset = rOffset + 2u;

	let rVec = rOffset >> 4u;
	let gVec = gOffset >> 4u;
	let bVec = bOffset >> 4u;

	let rComp = (rOffset % 16u) >> 2u;
	let gComp = (gOffset % 16u) >> 2u;
	let bComp = (bOffset % 16u) >> 2u;

	let rByte = rOffset % 4u;
	let gByte = gOffset % 4u;
	let bByte = bOffset % 4u;

    let r = (palette[rVec][rComp] >> (rByte * 8u)) & 255u;
    let g = (palette[gVec][gComp] >> (gByte * 8u)) & 255u;
    let b = (palette[bVec][bComp] >> (bByte * 8u)) & 255u;

	return vec4f(f32(r) / 255.0, f32(g) / 255.0, f32(b) / 255.0, 1.0f);
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

    // Debug visualization
    // let stepHeat = f32(hit.steps) / 512.0;  // Normalize to 0-1 range
	// var stepHeat = 0.0;
	// if (hit.steps > 30u) {
	// 	stepHeat = 1.0;
	// }
    // let debugColor = vec3f(stepHeat, 0.0, 1.0 - stepHeat);
	// output.color = vec4f(debugColor, 1.0);
	// return output;

	if (hit.voxel == 255u) {
		discard;
	}

    let clipPos = uniforms.modelViewProjection * vec4f(hit.pos, 1.0);
    output.depth = (clipPos.z / clipPos.w + 1.0) * 0.5;
    let ao = getAO(hit.voxelpos, hit.normal);
    let color = getPaletteColor(hit.voxel);
    output.color = vec4f(color.rgb * ao, 1.0);

    return output;
}




struct RasterVertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) @interpolate(flat) voxel: u32,
	@location(2) debugColor: vec3f,
}

@vertex
fn vs_raster (
    @location(0) face: vec4u,
    @builtin(vertex_index) vertexID: u32,
	@builtin(instance_index) instanceID: u32
) -> RasterVertexOutput {
    var output: RasterVertexOutput;
    
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

	let faceColors = array<vec3f, 6>(
		vec3f(0.0, 0.0, 1.0),  // -X blue
		vec3f(0.0, 1.0, 1.0),  // +X cyan
		vec3f(1.0, 1.0, 0.0),  // -Y yellow
		vec3f(1.0, 0.0, 0.0),  // +y red
		vec3f(0.0, 1.0, 0.0),  // -Z green
		vec3f(1.0, 0.0, 1.0),  // +Z magenta
	);
    
    let worldPos = vec3f(position) + vertices[normal][vertexID];
    output.position = uniforms.modelViewProjection * vec4f(worldPos, 1.0);

	let localPos = vertices[normal][vertexID];
    output.uv = select(
        select(
            vec2f(localPos.x, localPos.y),  // Z faces
            vec2f(localPos.y, localPos.x),  // Y faces
            normal == 2u || normal == 3u
        ),
        vec2f(localPos.z, localPos.y),      // X faces
        normal == 0u || normal == 1u
    );

	let voxel = textureLoad(voxels, position, 0).r;
	output.voxel = voxel;
	output.debugColor = getPaletteColor(voxel).rgb;

    return output;
}

@fragment
fn fs_textured(in: RasterVertexOutput) -> @location(0) vec4f {
	return textureSample(tiles, tileSampler, in.uv, i32(in.voxel));
}
 
@fragment
fn fs_raster(in: RasterVertexOutput) -> @location(0) vec4f {
	return vec4(in.debugColor, 1.0);
}

