#version 300 es

precision mediump float;
precision lowp usampler3D;
precision highp sampler2DArray;
precision highp int;

uniform usampler3D voxels;
uniform sampler2DArray tiles;
uniform uint palette[192];

in vec3 xyz;
in vec3 normal;

out vec4 color;

void main() {
	uvec2 voxeldata = texture(voxels, xyz).rg;
	int c = int(voxeldata.g) * 256 + int(voxeldata.r);

	if (c > 32627) {
		discard;
	}

	vec3 gridsize = vec3(textureSize(voxels, 0));

    vec2 uv;
    if (normal.x > 0.5) {
		uv.x = (1.0 - xyz.z) * gridsize.z;
		uv.y = (1.0 - xyz.y) * gridsize.y;
    } else if (normal.x < -0.5) {
        uv.x = (xyz.z) * gridsize.z;
		uv.y = (1.0 - xyz.y) * gridsize.y;
    } else if (normal.y > 0.5) {
		uv.x = (1.0 - xyz.z) * gridsize.z;
		uv.y = (1.0 - xyz.x) * gridsize.x;
    } else if (normal.y < -0.5) {
        uv.x = (1.0 - xyz.z) * gridsize.z;
		uv.y = (xyz.x) * gridsize.x;
    } else if (normal.z > 0.5) {
		uv.x = xyz.x * gridsize.x;
		uv.y = (1.0 - xyz.y) * gridsize.y;
    } else {
		uv.x = (1.0 - xyz.x) * gridsize.x;
		uv.y = (1.0 - xyz.y) * gridsize.y;
    }

	color = vec4(texture(tiles, vec3(uv.x, uv.y, c)));
	if (color.a == 0.0) {
		discard;
	}
}