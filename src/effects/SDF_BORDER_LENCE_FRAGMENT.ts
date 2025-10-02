// language=GLSL
export default `

    #version 300 es
    precision highp float;

    in vec2 vUV;
    out vec4 fragColor;

    uniform vec2  uResolution; // размер вьюпорта (px)
    uniform sampler2D uPointTexture; // текстура координат сегмента: R=x, G=y  (нормализованы)
    uniform vec4  uPointAABB;         // minX,minY,maxX,maxY сегмента (нормализованы)
    uniform int   uPointTexelCount; // число вершин сегмента
    uniform vec2  uPointTextureDim; // (W,H) текстуры координат сегмента

    // опционально подсветим эффект цветом заливки
    uniform vec4  uFillColor;
    uniform float uTime;

    // ---- helpers ------------------------------------------------------------

    vec2 readPointN(int i){
    int w = int(uPointTextureDim.x);
    ivec2 xy = ivec2(i % w, i / w);
    return texelFetch(uPointTexture, xy, 0).rg; // [0..1]
    }

    vec2 readPointPx(int i){
    return readPointN(i) * uResolution;         // → пиксели
    }

    float sdSegment(vec2 p, vec2 a, vec2 b){
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    return length(pa - ba * h);
    }

    // порт шейдера эффекта с Shadertoy (без iTime/iResolution)
    vec3 fx(vec2 fragCoord){
    vec3 c = vec3(0.0);
    float z = uTime;
    for (int i = 0; i < 3; i++){
    vec2 p = fragCoord / uResolution; // [0..1]
    vec2 uv = p;
    p -= 0.5;
    p.x *= uResolution.x / uResolution.y;
    z += 0.07;
    float l = length(p) + 1e-4; // избегаем деления на 0
    uv += p / l * (sin(z) + 1.0) * abs(sin(l * 9.0 - z - z));
    c[i] = 0.01 / length(mod(uv, 1.0) - 0.5);
    }
    float l0 = length((fragCoord / uResolution) - 0.5) + 1e-4;
    return c / l0;
    }

    // ---- main ---------------------------------------------------------------

    void main() {

    // ранний выход по AABB (UV-нормализованные)
    if (vUV.x < uPointAABB.x || vUV.x > uPointAABB.z || vUV.y < uPointAABB.y || vUV.y > uPointAABB.w) {
        fragColor = vec4(0.0); return;
    }
        
    vec2 P = vUV * uResolution;

    if (uPointTexelCount < 3) { fragColor = vec4(0.0); return; }

    const int MAX_VERTS = 2048;
    int texelLimitCount = min(uPointTexelCount, MAX_VERTS);

    float minDist = 1e9;
    for (int i = 0; i < MAX_VERTS; ++i) {
    if (i >= texelLimitCount) break;
    int j = (i + 1 == texelLimitCount) ? 0 : i + 1;
    vec2 a = readPointPx(i);
    vec2 b = readPointPx(j);
    minDist = min(minDist, sdSegment(P, a, b));
    }

    
    vec3 e = fx(P);
        
    vec3 col = e * uFillColor.rgb;

    if (minDist <= 5.0) {
        vec3 e = fx(P);
        vec3 col = e * uFillColor.rgb;
        vec3 colNormalized = col / minDist * 10.0;
        
        fragColor = vec4(colNormalized,min(min(colNormalized.r,colNormalized.g),colNormalized.b));
        
        return;
    }

    fragColor = vec4(0.0);
    
    }
`
