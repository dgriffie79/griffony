export default `#version 300 es
precision mediump float;
precision lowp usampler3D;
precision highp sampler2DArray;
precision highp int;

uniform usampler3D voxels;
uniform sampler2DArray tiles;
uniform mat4 mvpMatrix;

in vec3 vRayDirection;
in vec3 vRayOrigin;
in vec3 vDebugColor;

out vec4 color;

void main() {
    //color = vec4(vDebugColor, 1.0);
    //return;

    ivec3 voxelsTextureSize = textureSize(voxels, 0);
    vec3 rayDir = normalize(vRayDirection);

    // Early exit for zero components
    if (rayDir.x == 0.0 || rayDir.y == 0.0 || rayDir.z == 0.0) {
        discard;
    }
    
    // ray/box intersection
    vec3 tMin = (-vRayOrigin) / rayDir;
    vec3 tMax = (vec3(voxelsTextureSize) - vRayOrigin) / rayDir;
    vec3 t1 = min(tMin, tMax);
    vec3 t2 = max(tMin, tMax);
    float tNear = max(max(t1.x, t1.y), t1.z);
    float tFar = min(min(t2.x, t2.y), t2.z);
    
    if(tNear > tFar || tFar < 0.0) {
        discard;
    }

    // starting voxel
    vec3 pos = vRayOrigin + (max(0.0, tNear) + 1e-4) * rayDir;
    ivec3 voxelPos = ivec3(floor(pos));

	int steppedAxis;
    if (tNear == t1.x) {
        steppedAxis = 0;
    } else if (tNear == t1.y) {
        steppedAxis = 1;
    } else {
        steppedAxis = 2;
    }

    // step size (tDelta) and initial next step (tNext)
    vec3 step = sign(rayDir);
    vec3 tDelta = abs(1.0 / rayDir);
    vec3 voxelBounds = vec3(voxelPos) + max(step, 0.0);
    vec3 tNext = (voxelBounds - pos) / rayDir;

	// march
    while (true) {
        if (voxelPos.x < 0 || voxelPos.x >= voxelsTextureSize.x ||
            voxelPos.y < 0 || voxelPos.y >= voxelsTextureSize.y ||
            voxelPos.z < 0 || voxelPos.z >= voxelsTextureSize.z) {
            discard;
        }

		uvec2 voxelData = texelFetch(voxels, voxelPos, 0).rg;
    	uint tileIndex = voxelData.g * 256u + voxelData.r;
		
		if (tileIndex != 0u) {	
			vec3 normal = vec3(0.0);
            normal[steppedAxis] = step[steppedAxis];
            float t = tNext[steppedAxis] - tDelta[steppedAxis];
            
            // Project onto entry face
            vec3 hitPos = pos + t * rayDir - vec3(voxelPos);
			vec2 uv;
			if (abs(normal.x) > 0.0) {  
				uv = vec2(-normal.x * hitPos.y, -hitPos.z);
			} else if (abs(normal.y) > 0.0) {
				uv = vec2(normal.y * hitPos.x, -hitPos.z);
			} else {
				uv = vec2(hitPos.x, -hitPos.y);
			}		

			color = texture(tiles, vec3(uv, float(tileIndex - 1u)));
				
			vec3 worldPos = pos + t * rayDir;
			vec4 clipPos = mvpMatrix * vec4(worldPos, 1.0);
			gl_FragDepth = (clipPos.z / clipPos.w + 1.0) * 0.5;
			return;	
		}

        if (tNext.x < tNext.y && tNext.x < tNext.z) {
			steppedAxis = 0;
            voxelPos.x += int(step.x);
            tNext.x += tDelta.x;
        } else if (tNext.y < tNext.z) {
			steppedAxis = 1;
            voxelPos.y += int(step.y);
            tNext.y += tDelta.y;
        } else {
			steppedAxis = 2;
            voxelPos.z += int(step.z);
            tNext.z += tDelta.z;
        }
    }
}`