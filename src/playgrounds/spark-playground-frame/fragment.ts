// language=GLSL
export default `
    #version 300 es
    precision mediump float;

    in vec2 vUV;
    out vec4 fragColor;

    uniform vec2  uResolution;
    uniform sampler2D uPointTexture;
    uniform vec4  uPointAABB;       // [minN,minN,maxN,maxN] в [0..1]
    uniform int   uPointTexelCount;
    uniform vec2  uPointTextureDim;
    uniform float uTime;

    #define MAX_POINTS 2048
    const float PI = 3.141592653589793;

    // ---------- polygon ----------
    // readPointN/Px: O(1), 1 texelFetch
    vec2 readPointN(int i){ return texelFetch(uPointTexture, ivec2(i % int(uPointTextureDim.x), i / int(uPointTextureDim.x)), 0).rg; }
    
    vec2 readPointPx(int i){ return readPointN(i) * uResolution; }

    //==========================================================================
    // SDF: расстояние до полигона + флаг inside (четно-нечетное правило)
    //==========================================================================
    vec2 signedDistanceField(vec2 p){
        float bestD = 1e20;
        bool  inside = false;

        int N = min(uPointTexelCount, MAX_POINTS);
        const float EPS = 1e-6;

        vec2 a = readPointPx(0);
        for(int i=0; i<MAX_POINTS; ++i){
            if(i>=N) break;
            int j = (i+1==N)?0:(i+1);
            vec2 b = readPointPx(j);
            vec2 ab = b - a;

            if(abs(ab.x)+abs(ab.y) > EPS){
                vec2  pa = p - a;

                float h  = clamp(dot(pa,ab)/max(dot(ab,ab),1e-8), 0.0, 1.0);
                
                bestD = min(bestD, length(pa - ab*h));

                // пересечение луча по X
                if(((a.y<=p.y) && (b.y>p.y)) || ((b.y<=p.y) && (a.y>p.y))){
                    float xInt = a.x + (p.y - a.y)*ab.x/ab.y;
                    if(p.x < xInt) inside = !inside;
                }
            }
            a = b;
        }
        return vec2(bestD, inside ? 1.0 : 0.0);
    }

    void main(){
        if(uPointTexelCount < 2){ fragColor = vec4(0.0); return; }
        
        fragColor = vec4(rgb, clamp(s, 0.0, 1.0));
    }
`;
