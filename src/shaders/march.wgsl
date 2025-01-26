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

	//output.rayOrigin = object_uniforms.camera_position_local;
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

@fragment
fn fs_model(in: VertexOutput) -> FragmentOutput {
    var output: FragmentOutput;

	let hit = march(in.rayOrigin, normalize(in.rayDirection), 255u);

    // Debug visualization
    var stepHeat = 0.0;
	if (hit.steps > 32u) {
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
    let ao = getAO(hit.voxelpos, hit.normal);
    let color = textureLoad(palette, vec2<u32>(hit.voxel, object_uniforms.palette_index), 0);
	output.color = vec4f(color.rgb * ao, 1.0);

    return output;
}
