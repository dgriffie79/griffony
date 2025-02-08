struct FrameUniforms {
    projection: mat4x4f,
    view: mat4x4f,
    camera_position: vec3f,
    viewport: vec2f
}

struct ObjectUniforms {
    model: mat4x4f,
    model_view_projection: mat4x4f,
    palette_index: u32
}

@group(0) @binding(0) var<uniform> frame_uniforms: FrameUniforms;
@group(0) @binding(1) var<uniform> object_uniforms: ObjectUniforms;
@group(0) @binding(2) var column_map_buffer: array<u32>;
@group(0) @binding(3) var column_data_buffer: array<u8>;
@group(0) @binding(4) var output_texture: texture_storage_2d<rgba8unorm, write>;

struct Ray {
    origin: vec3f,
    direction: vec3f
}

fn get_ray(pixel: vec2u) -> Ray {
    let uv = (vec2f(pixel) + 0.5) / vec2f(textureDimensions(output_texture));
    let ndc = vec2f(2.0 * uv.x - 1.0, 1.0 - 2.0 * uv.y);
    
    let clip = vec4f(ndc, -1.0, 1.0);
    let view = frame_uniforms.projection.inverse * clip;
    let world = frame_uniforms.view.inverse * vec4f(view.xy, -1.0, 0.0);
    
    let dir = normalize(world.xyz);
    return Ray(frame_uniforms.camera_position, dir);
}

fn intersect_column(ray: Ray, column_x: u32, column_y: u32) -> vec4f {
    let column_index = column_y * u32(textureDimensions(output_texture).x) + column_x;
    let data_offset = column_map_buffer[column_index];
    
    // Read intervals from column data
    var closest_t = 999999.0;
    var hit_color = vec4f(0.0);
    
    var current_offset = data_offset;
    loop {
        let start_z = f32(column_data_buffer[current_offset]);
        let length = column_data_buffer[current_offset + 1u];
        
        if length == 0u { break; }
        
        // Test ray intersection with interval
        let column_min = vec3f(f32(column_x), f32(column_y), start_z);
        let column_max = vec3f(f32(column_x + 1u), f32(column_y + 1u), f32(start_z + length));
        
        // AABB intersection test
        let t1 = (column_min - ray.origin) / ray.direction;
        let t2 = (column_max - ray.origin) / ray.direction;
        
        let tmin = max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z));
        let tmax = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));
        
        if tmax >= tmin && tmin < closest_t {
            closest_t = tmin;
            // For now just use a debug color based on height
            hit_color = vec4f(start_z / 255.0, length / 255.0, 0.0, 1.0);
        }
        
        current_offset += 2u;
    }
    
    return hit_color;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3u) {
    let dims = textureDimensions(output_texture);
    if (global_id.x >= dims.x || global_id.y >= dims.y) {
        return;
    }
    
    let ray = get_ray(global_id.xy);
    let color = intersect_column(ray, global_id.x, global_id.y);
    
    textureStore(output_texture, global_id.xy, color);
}
