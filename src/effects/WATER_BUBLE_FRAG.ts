// language=GLSL
export default `
    // WATER_DROP_SEGMENT_LIQUID_GLASS.ts
    #version 300 es
precision highp float;

    in vec2 vUV;
    out vec4 fragColor;

    // сегмент
    uniform vec2  uResolution;
    uniform sampler2D uPointTexture;
    uniform vec4  uPointAABB;       // minX,minY,maxX,maxY (норм.)
    uniform int   uPointTexelCount;
    uniform vec2  uPointTextureDim;

    // сцена и время
    uniform sampler2D uSceneTexture;
    uniform float uTime;

    // параметры «liquid glass»
    uniform float uThicknessPx;     // максимальная «высота» капли (px), напр. 12
    uniform float uEdgeFadePx;      // ширина зоны нарастания от границы внутрь (px), напр. 30
    uniform float uIOR;             // 1.33
    uniform float uDispersion;      // 0..0.1, напр. 0.03
    uniform float uOpacity;         // 0..1
    uniform float uFresnelPower;    // 3..7
    uniform float uSpecular;        // 0..2

    // микро-волны
    uniform float uNoiseAmpPx;      // 0..10
    uniform float uNoiseScale;      // 40..200
    uniform float uNoiseSpeed;      // 0.1..1.0

    // сглаживание границы сегмента
    uniform float uEdgeFeatherPx;   // 1..4

    // 0=обычно, 1=маски, 2=профиль
    uniform int   uDebug;

    #define MAX_POINTS 2048
const float PI = 3.14159265359;

    // ===== poly read =====
    vec2 readPointN(int i){
        int w = int(uPointTextureDim.x);
        ivec2 xy = ivec2(i % w, i / w);
        return texelFetch(uPointTexture, xy, 0).rg;
    }
    vec2 readPointPx(int i){ return readPointN(i) * uResolution; }

    // ===== noise =====
    float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float vnoise(vec2 x){
        vec2 i=floor(x), f=fract(x);
        float a=hash21(i), b=hash21(i+vec2(1,0)), c=hash21(i+vec2(0,1)), d=hash21(i+vec2(1,1));
        vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
    }
    float fbm(vec2 x){
        float v=0.0, a=0.5; mat2 m=mat2(1.6,-1.2,1.2,1.6);
        for(int k=0;k<3;k++){ v+=a*vnoise(x); x=m*x; a*=0.5; }
        return v;
    }

    // ===== distance + inside =====
    vec2 distAndInside(vec2 p){
        float bestD=1e20;
        bool inside=false;
        int N=min(uPointTexelCount, MAX_POINTS);
        const float EPS=1e-6;

        vec2 a=readPointPx(0);
        for(int i=0;i<MAX_POINTS;i++){
            if(i>=N) break;
            int j=(i+1==N)?0:i+1;
            vec2 b=readPointPx(j), ab=b-a;
            if(abs(ab.x)+abs(ab.y)>EPS){
                vec2 pa=p-a;
                float h=clamp(dot(pa,ab)/max(dot(ab,ab),1e-8),0.0,1.0);
                bestD=min(bestD, length(pa-ab*h));
                bool cond=((a.y<=p.y)&&(b.y>p.y))||((b.y<=p.y)&&(a.y>p.y));
                if(cond){ float xInt=a.x+(p.y-a.y)*ab.x/ab.y; if(p.x<xInt) inside=!inside; }
            }
            a=b;
        }
        return vec2(bestD, inside?1.0:0.0);
    }

    void main(){
        if(uPointTexelCount<2){ fragColor=vec4(0); return; }

        vec2 p = vUV * uResolution;

        // сегмент SDF
        vec2 di = distAndInside(p);
        float d = di.x;
        bool inside = di.y > 0.5;

        // мягкая маска сегмента
        float edgeAA = max(fwidth(d), 1e-3);
        float segMask = inside ? smoothstep(0.0, uEdgeFeatherPx + edgeAA, d) : 0.0;
        if(segMask<=0.0){ fragColor=vec4(0); return; }

        // профиль «высоты» от границы внутрь:
        // h(d) = thickness * smoothstep(0, edgeFade, d)
        float t  = clamp(d / max(uEdgeFadePx, 1e-3), 0.0, 1.0);
        float S  = t*t*(3.0-2.0*t);                 // smoothstep
        float h  = uThicknessPx * S;

        // производная smoothstep: 6 t (1-t) → пик у края
        float dSdd = 6.0 * t * (1.0 - t) / max(uEdgeFadePx, 1e-3);

        // ∇d через экранные производные
        vec2 gradD = vec2(dFdx(d), dFdy(d));
        float gLen = length(gradD);
        // запасной вектор на случай маленьких производных
        vec2 bbMin=uPointAABB.xy*uResolution, bbMax=uPointAABB.zw*uResolution;
        vec2 bbC = 0.5*(bbMin+bbMax);
        vec2 dirFallback = normalize(p - bbC + 1e-4);
        vec2 dir = (gLen>1e-4) ? (gradD / gLen) : dirFallback;

        // микронормали
        float s  = max(uNoiseScale, 1.0);
        float tt = uTime * uNoiseSpeed;
        float nx = fbm(((p+vec2(1.0,0.0))/s)+vec2(0.0,tt)) - fbm(((p-vec2(1.0,0.0))/s)+vec2(0.0,tt));
        float ny = fbm(((p+vec2(0.0,1.0))/s)+vec2(0.0,tt)) - fbm(((p-vec2(0.0,1.0))/s)+vec2(0.0,tt));
        vec2  nGrad = 0.5*vec2(nx, ny) * (uNoiseAmpPx / max(uEdgeFadePx,1.0));

        // итоговый наклон поверхности: ∇h = dS/dd * ∇d  +  шум
        vec2 slope2D = dSdd * dir + nGrad;

        // нормаль и рефракция
        vec3 N = normalize(vec3(-slope2D, 1.0));
        float kIOR = max(uIOR, 1.0001);
        vec2 bend  = (N.xy / max(N.z, 1e-3)) * (1.0 - 1.0/kIOR);

        // сила искажения усиливается на краях (через dSdd)
        float edgeWeight = clamp(6.0 * t * (1.0 - t), 0.0, 1.0);
        vec2 duv = (bend * uThicknessPx * edgeWeight) / uResolution;

        // дисперсия
        float disp = clamp(uDispersion, 0.0, 0.2);
        vec2 uvR = clamp(vUV + duv*(1.0 + disp), vec2(0.0), vec2(1.0));
        vec2 uvG = clamp(vUV + duv,              vec2(0.0), vec2(1.0));
        vec2 uvB = clamp(vUV + duv*(1.0 - disp), vec2(0.0), vec2(1.0));

        vec3 refrCol = vec3(texture(uSceneTexture, uvR).r,
        texture(uSceneTexture, uvG).g,
        texture(uSceneTexture, uvB).b);

        // френель + спекуляр
        float fresnel = pow(clamp(1.0 - N.z, 0.0, 1.0), uFresnelPower);
        vec3  L = normalize(vec3(-0.35, -0.75, 1.0));
        vec3  V = vec3(0.0, 0.0, 1.0);
        vec3  H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 100.0) * uSpecular;

        // альфа по сегменту
        float alpha = clamp(uOpacity,0.0,1.0) * segMask;

        // debug
        if(uDebug==1){ fragColor = vec4(0.0, segMask, S, 1.0); return; }       // зелёный=сегмент, синий=S
        if(uDebug==2){ fragColor = vec4(edgeWeight, S, 0.0, 1.0); return; }     // красный=edgeWeight

        vec3 col = refrCol + (0.6*fresnel + spec) * edgeWeight;
        fragColor = vec4(col, alpha);
    }
`;
