export default `#version 300 es

precision mediump float;
precision lowp usampler3D;

uniform mat4 mvpMatrix;
uniform mat4 modelMatrix;
uniform vec3 cameraPosition;
uniform usampler3D voxels;

out vec3 vRayDirection;
out vec3 vRayOrigin;
out vec3 vDebugColor;

void main() {
    // unit cube, z-up
    const vec3 vertices[8] = vec3[8](
        vec3(0.0, 0.0, 0.0),  // 0: left  front bottom
        vec3(1.0, 0.0, 0.0),  // 1: right front bottom
        vec3(0.0, 1.0, 0.0),  // 2: left  back  bottom
        vec3(1.0, 1.0, 0.0),  // 3: right back  bottom
        vec3(0.0, 0.0, 1.0),  // 4: left  front top
        vec3(1.0, 0.0, 1.0),  // 5: right front top
        vec3(0.0, 1.0, 1.0),  // 6: left  back  top
        vec3(1.0, 1.0, 1.0)   // 7: right back  top
    );

    // colors for debugging
    const vec3 faceColors[6] = vec3[6](
        vec3(0.0, 0.0, 1.0),  // bottom (-Z) - blue
        vec3(0.0, 1.0, 1.0),  // bottom (+Z) - cyan
        vec3(1.0, 1.0, 0.0),  // back   (+Y) - yellow
        vec3(1.0, 0.0, 0.0),  // front  (-Y) - red
        vec3(0.0, 1.0, 0.0),  // left   (-X) - green
        vec3(1.0, 0.0, 1.0)   // right  (+X) - magenta
        
    );

    // drawing the inside faces of the cube
    const int indices[36] = int[36](
        0, 1, 2, 2, 1, 3,   // bottom (-Z)
        6, 5, 4, 7, 5, 6,   // top    (+Z)
        2, 3, 6, 6, 3, 7,   // back   (+Y)
        4, 1, 0, 5, 1, 4,   // front  (-Y)
        0, 2, 4, 4, 2, 6,   // left   (-X)
        5, 3, 1, 7, 3, 5    // right  (+X)   
    );

    vec3 position = vertices[indices[gl_VertexID]] * vec3(textureSize(voxels, 0));
    vDebugColor = faceColors[gl_VertexID / 6];

    vRayOrigin = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
    vRayDirection = position - vRayOrigin;
    
    gl_Position = mvpMatrix * vec4(position, 1.0);
}`