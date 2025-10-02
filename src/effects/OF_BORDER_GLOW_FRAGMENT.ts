// language=GLSL
export default `
    #version 300 es
precision highp float;

    in vec2 vUV;
    out vec4 fragColor;

    uniform vec2  uResolution;
    uniform sampler2D uPointTexture;
    uniform vec4  uPointAABB;       // minX,minY,maxX,maxY in 0..1
    uniform int   uPointTexelCount;
    uniform vec2  uPointTextureDim;

    uniform vec4  uFillColor;
    uniform float uTime;
    uniform float uHLWidth;         // glow reach scale
    uniform float uHLSpeed;         // used for animation

    // noise
    uniform float uNoiseAmpPx;      // amplitude in px
    uniform float uNoiseScale;      // scale in px
    uniform float uNoiseSpeed;      // speed

    const float DECAY = 0.045;
    const float SOFT  = 0.015;
    #define MAX_POINTS 2048

    vec2 readPointN(int i){
        int w = int(uPointTextureDim.x);
        ivec2 xy = ivec2(i % w, i / w);
        return texelFetch(uPointTexture, xy, 0).rg;
    }
    vec2 readPointPx(int i){ return readPointN(i) * uResolution; }

    // distance and inside flag
    vec2 distAndInside(vec2 p){
        float bestD = 1e20;
        bool inside = false;
        int N = min(uPointTexelCount, MAX_POINTS);
        const float EPS = 1e-6;

        vec2 a = readPointPx(0);
        for (int i = 0; i < MAX_POINTS; ++i){
            if (i >= N) break;
            int j = (i + 1 == N) ? 0 : i + 1;
            vec2 b = readPointPx(j);
            vec2 ab = b - a;

            if (abs(ab.x) + abs(ab.y) > EPS){
                vec2 pa = p - a;
                float h = clamp(dot(pa, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
                bestD = min(bestD, length(pa - ab * h));

                bool cond = ((a.y <= p.y) && (b.y >  p.y)) ||
                ((b.y <= p.y) && (a.y >  p.y));
                if (cond){
                    float xInt = a.x + (p.y - a.y) * ab.x / ab.y;
                    if (p.x < xInt) inside = !inside;
                }
            }
            a = b;
        }
        return vec2(bestD, inside ? 1.0 : 0.0);
    }

    float distToAABB(vec2 p, vec2 mn, vec2 mx){
        vec2 d = max(max(mn - p, vec2(0.0)), p - mx);
        return length(d);
    }

    // hash value noise
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
    float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0,0.0));
        float c = hash(i + vec2(0.0,1.0));
        float d = hash(i + vec2(1.0,1.0));
        vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
    }
    float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        for(int i=0;i<4;i++){ v += a * noise(p); p *= 2.0; a *= 0.5; }
        return v;
    }

    float signedDist(vec2 p){
        vec2 di = distAndInside(p);
        return di.x * (di.y > 0.5 ? -1.0 : 1.0);
    }

    vec2 sdGrad(vec2 p){
        // 1px finite differences
        float e = 1.0;
        float dx1 = signedDist(p + vec2(e,0.0));
        float dx2 = signedDist(p - vec2(e,0.0));
        float dy1 = signedDist(p + vec2(0.0,e));
        float dy2 = signedDist(p - vec2(0.0,e));
        vec2 g = vec2(dx1 - dx2, dy1 - dy2);
        float m = max(length(g), 1e-5);
        return g / m;
    }

    // volumetric glow along outward gradient
    float glowAccumulate(vec2 p, float sd0){
        if (sd0 <= 0.0) return 0.0; // inside not glowing
        vec2 dir = sdGrad(p);       // outward
        // march length scales with width
        const int STEPS = 20;
        float stepPx = max(uHLWidth / float(STEPS), 0.75);
        float sum = 0.0;

        // noise domain in pixels
        float tAnim = uTime * (uNoiseSpeed + 0.01*uHLSpeed);
        for(int i=0;i<STEPS;i++){
            float t = (float(i) + 0.5) * stepPx;
            vec2 q = p + dir * t;

            // keep outside only
            float sdq = signedDist(q);
            float outside = step(0.0, sdq);

            // base falloff
            float w = exp(-DECAY * t) * smoothstep(0.0, SOFT * (uHLWidth + 1.0), sdq);

            // animated modulation
            float n = fbm(q / max(uNoiseScale, 1.0) + vec2(0.37,0.19) * tAnim);
            // center n around 1.0 with pixel-based amplitude
            float modAmp = uNoiseAmpPx / max(uHLWidth, 1.0);
            float modN = 1.0 + modAmp * (n - 0.5);

            sum += outside * w * modN;
        }
        // scale to sensible range
        return sum * (stepPx * 0.8);
    }

    void main(){
        if (uPointTexelCount < 2){ fragColor = vec4(0.0); return; }

        vec2 p  = vUV * uResolution;

        // AABB early out
        vec2 aabbMin = uPointAABB.xy * uResolution;
        vec2 aabbMax = uPointAABB.zw * uResolution;
        float reach  = 6.0 * uHLWidth + uNoiseAmpPx + uNoiseScale;
        if (distToAABB(p, aabbMin, aabbMax) > reach){
            fragColor = vec4(0.0);
            return;
        }

        vec2 di = distAndInside(p);
        float sd = di.x * (di.y > 0.5 ? -1.0 : 1.0);

//        if (sd <= 0.0){
//            // inside fill
//            fragColor = uFillColor;
//            return;
//        }

        // outside glow only
        float glow = glowAccumulate(p, sd);
        float a = clamp(glow, 0.0, 1.0);
        fragColor = vec4(uFillColor.rgb, a);
    }
`;
