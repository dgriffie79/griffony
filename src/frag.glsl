#version 300 es

precision mediump float;
precision lowp usampler3D;
precision highp int;

uniform usampler3D voxels;
uniform uint palette[192];

in vec3 xyz;

out vec4 color;

void main() {
	uint c = texture(voxels, vec3(xyz.x, 1.0 - xyz.y, xyz.z)).r;
	

	if (c == 255u) {
		discard;
	}

	color.r = float(palette[c * 3u >> 2] >> ((c * 3u & 0x3u) << 3) & 0xFFu) / 255.0;
	color.g = float(palette[c * 3u + 1u >> 2] >> (((c * 3u + 1u & 0x3u) << 3)) & 0xFFu) / 255.0;
	color.b = float(palette[c * 3u + 2u >> 2] >> (((c * 3u + 2u & 0x3u) << 3)) & 0xFFu) / 255.0;

	color.a = 1.0;
}