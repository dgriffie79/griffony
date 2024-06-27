#version 300 es

precision highp float;
precision highp usampler3D;

uniform mat4 mvp;
uniform usampler3D voxels;

out vec3 xyz;
out vec3 normal;

const vec3 pos[6] = vec3[6](vec3(-1.0, -1.0, 1.0), vec3(1.0, -1.0, 1.0), vec3(-1.0, 1.0, 1.0), vec3(-1.0, 1.0, 1.0), vec3(1.0, -1.0, 1.0), vec3(1.0, 1.0, 1.0));


const vec2[6] uv = vec2[6](
	vec2(0.0, 0.0),
	vec2(1.0, 0.0),
	vec2(0.0, 1.0),
	vec2(0.0, 1.0),
	vec2(1.0, 0.0),
	vec2(1.0, 1.0)
);

void main() {
	vec3 gridsize = vec3(textureSize(voxels, 0));
	vec3 p = pos[gl_VertexID % 6];
	float n = float(gl_VertexID / 6);

	if ( n < gridsize.z) {
		normal = vec3(0, 0, 1);
		p = vec3(uv[gl_VertexID % 6].xy, 1.0) * gridsize;
		p.z -= n;
		xyz = p;
		xyz.z -= .5;
		xyz /= gridsize;
		gl_Position = mvp * vec4(p, 1.0);
		return;
	}
	n -= gridsize.z;


	if ( n < gridsize.z) {
		normal = vec3(0, 0, -1);
		p = vec3(uv[gl_VertexID % 6].yx, 0.0) * gridsize;
		p.z += n;
		xyz = p;
		xyz.z += .5;
		xyz /= gridsize;
		gl_Position = mvp * vec4(p, 1.0);
		return;
	}
	n -= gridsize.z;

	if (n < gridsize.x) {
		normal = vec3(-1, 0, 0);
		p = vec3(0, uv[gl_VertexID % 6].yx) * gridsize;
		p.x += n;
		xyz = p;
		xyz.x += .5;
		xyz /= gridsize;
		gl_Position = mvp * vec4(p, 1.0);
		return;
	}
	n -= gridsize.x;

	if (n < gridsize.x) {
		normal = vec3(1, 0, 0);
		p = vec3(1, uv[gl_VertexID % 6].xy) * gridsize;
		p.x -= n;
		xyz = p;
		xyz.x -= .5;
		xyz /= gridsize;
		gl_Position = mvp * vec4(p, 1.0);
		return;
	}
	n -= gridsize.x;

	if (n < gridsize.y) {
		normal = vec3(0, -1, 0);
		p = vec3(uv[gl_VertexID % 6].y, 1, uv[gl_VertexID % 6].x) * gridsize;
		p.y -= n;
		xyz = p;
		xyz.y -= .5;
		xyz /= gridsize;
		gl_Position = mvp * vec4(p, 1.0);
		return;
	}
	n -= gridsize.y;

	if (n < gridsize.y) {
		normal = vec3(0, 1, 0);
		p = vec3(uv[gl_VertexID % 6].x, 0, uv[gl_VertexID % 6].y) * gridsize;
		p.y += n;
		xyz = p;
		xyz.y += .5;
		xyz /= gridsize;
		gl_Position = mvp * vec4(p, 1.0);
		return;
	}
}