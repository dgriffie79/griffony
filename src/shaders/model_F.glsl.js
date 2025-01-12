export default `#version 300 es
precision mediump float;
precision lowp usampler3D;
precision highp int;

uniform usampler3D voxels;
uniform uint palette[192];
uniform mat4 mvpMatrix;

in vec3 vRayDirection;
in vec3 vRayOrigin;
in vec3 vDebugColor;

out vec4 color;

void main() {
    ivec3 textureSize = textureSize(voxels, 0);
    vec3 rayDir = normalize(vRayDirection);

    // Early exit for zero components
    if (rayDir.x == 0.0 || rayDir.y == 0.0 || rayDir.z == 0.0) {
        discard;
    }
    
    // ray/box intersection
    vec3 tMin = (-vRayOrigin) / rayDir;
    vec3 tMax = (vec3(textureSize) - vRayOrigin) / rayDir;
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
        if (voxelPos.x < 0 || voxelPos.x >= textureSize.x ||
            voxelPos.y < 0 || voxelPos.y >= textureSize.y ||
            voxelPos.z < 0 || voxelPos.z >= textureSize.z) {
            discard;
        }

        uint c = texelFetch(voxels, voxelPos, 0).r;
        if (c != 255u) {
            vec3 normal = vec3(0.0);
            normal[steppedAxis] = step[steppedAxis];
            float t = tNext[steppedAxis] - tDelta[steppedAxis];

            float ao = 1.0;
            ivec3 up = voxelPos + ivec3(0, 0, 1);
            ivec3 side = voxelPos + ivec3(normal.x, normal.y, 0);

            if (up.z < textureSize.z && texelFetch(voxels, up, 0).r != 255u) ao -= 0.2;
            if (side.x >= 0 && side.x < textureSize.x && 
                side.y >= 0 && side.y < textureSize.y && 
                texelFetch(voxels, side, 0).r != 255u) ao -= 0.2;

            color.r = float(palette[c * 3u >> 2] >> ((c * 3u & 0x3u) << 3) & 0xFFu) / 255.0;
            color.g = float(palette[c * 3u + 1u >> 2] >> (((c * 3u + 1u & 0x3u) << 3)) & 0xFFu) / 255.0;
            color.b = float(palette[c * 3u + 2u >> 2] >> (((c * 3u + 2u & 0x3u) << 3)) & 0xFFu) / 255.0;
            color.rgb *= ao;
            color.a = 1.0;

            vec3 worldPos = pos + t * rayDir;
			vec4 clipPos = mvpMatrix * vec4(worldPos, 1.0);
			gl_FragDepth = (clipPos.z / clipPos.w + 1.0) * 0.5;
            return;
        }

        if (tNext.x < tNext.y && tNext.x < tNext.z) {
            voxelPos.x += int(step.x);
            tNext.x += tDelta.x;
            steppedAxis = 0;
        } else if (tNext.y < tNext.z) {
            voxelPos.y += int(step.y);
            tNext.y += tDelta.y;
            steppedAxis = 1;
        } else {
            voxelPos.z += int(step.z);
            tNext.z += tDelta.z;
            steppedAxis = 2;
        }
    }
}`