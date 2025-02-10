struct FragmentInput {
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

fn rayBoxIntersect(rayOrigin: vec3f, rayDir: vec3f, boxMin: vec3f, boxMax: vec3f) -> bool {
    // Ray-box intersection from fragment position to voxel bounds
    let invDir = 1.0 / rayDir;
    let t1 = (boxMin - rayOrigin) * invDir;
    let t2 = (boxMax - rayOrigin) * invDir;
    
    let tMin = min(t1, t2);
    let tMax = max(t1, t2);
    
    let tNear = max(max(tMin.x, tMin.y), tMin.z);
    let tFar = min(min(tMax.x, tMax.y), tMax.z);
    
    return tNear <= tFar && tFar > 0.0;
}

@fragment
fn main(in: FragmentInput) -> @location(0) vec4f {
    // Reconstruct ray from camera to fragment
    let rayOrigin = uniforms.camera_position;
    let rayDir = normalize(in.world_pos - rayOrigin);
    
    // Calculate voxel bounds (unit cube centered at world_pos)
    let halfSize = 0.5;
    let boxMin = in.world_pos - vec3f(halfSize);
    let boxMax = in.world_pos + vec3f(halfSize);
    
    // Do ray-box intersection test
    if (!rayBoxIntersect(rayOrigin, rayDir, boxMin, boxMax)) {
        discard;
    }
    
    // Basic lighting
    let lightDir = normalize(vec3f(1.0, 1.0, 1.0));
    let diffuse = max(dot(normalize(vec3f(0.0, 0.0, 1.0)), lightDir), 0.2);
    
    return vec4f(in.color.rgb * diffuse, 1.0);
}
