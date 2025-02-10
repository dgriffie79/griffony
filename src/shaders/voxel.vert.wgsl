struct VertexInput {
    @location(0) position: vec4f,
    @location(1) world_pos: vec3f,
    @location(2) color: vec4f,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4f,
    @location(0) world_pos: vec3f,
    @location(1) color: vec4f,
    @location(2) screen_pos: vec2f,
};

struct Uniforms {
    projection: mat4x4f,
    view: mat4x4f,
    model: mat4x4f,
    viewport: vec2f,
    camera_position: vec3f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    
    // Pass through position (already in clip space from compute shader)
    out.clip_position = in.position;
    
    // Pass through attributes for fragment shader
    out.world_pos = in.world_pos;
    out.color = in.color;
    
    // Calculate screen position for fragment shader
    out.screen_pos = in.position.xy / in.position.w;
    
    return out;
}
