// language=GLSL
export default `
    #version 300 es
precision highp float;

    in vec2 vUV;
    out vec4 fragColor;

    uniform vec2  uResolution;

    uniform sampler2D uPointTexture;
    uniform vec4  uPointAABB;
    uniform int   uPointTexelCount;
    uniform vec2  uPointTextureDim;

    uniform float uTime;

    uniform vec4  uFillColor;
    uniform float uHLWidth;         // длина волны, px
    uniform float uHLSpeed;         // скорость, px/s

    // шум
    uniform float uNoiseAmpPx;
    uniform float uNoiseScale;
    uniform float uNoiseSpeed;

    // сглаживание/затухание
    uniform float uDecay;           // эксп. затухание
    uniform float uSoft;            // мягкость гребня
    uniform float uEdgeFeatherPx;   // плавный край у контура

    // ПАЛИТРА ДЛЯ РАЗНЫХ ВОЛН
    uniform float uColorAmount;     // 0..1 — доля палитры относительно uFillColor
    uniform float uColorStride;     // шаг по палитре на 1 волну (напр. 0.2)
    uniform float uColorOffset;     // глобальный сдвиг палитры [0..1]
    uniform vec3  uPA, uPB, uPC, uPD; // коэффициенты cosine-палитры (IQ)

    const float PI = 3.14159265359;
    #define MAX_POINTS 2048

    vec2 readPointN(int i){
        int w = int(uPointTextureDim.x);

        ivec2 xy = ivec2(i % w, i / w);

        return texelFetch(uPointTexture, xy, 0).rg;
    }

    vec2 readPointPx(int i){
        return readPointN(i) * uResolution;
    }

    // noise
    float hash21(vec2 p){
        return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453);
    }

    float vnoise(vec2 x){
        vec2 i=floor(x), f=fract(x);

        float a=hash21(i), b=hash21(i+vec2(1,0)), c=hash21(i+vec2(0,1)), d=hash21(i+vec2(1,1));

        vec2 u=f*f*(3.0-2.0*f);

        return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
    }

    float fbm(vec2 x){
        float v=0.0, a=0.5; mat2 m=mat2(1.6,-1.2,1.2,1.6);

        for(int k=0;k<3;k++){
            v+=a*vnoise(x);
            x=m*x;
            a*=0.5;
        }

        return v;
    }

    // SDF + inside
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

    float distToAABB(vec2 p, vec2 mn, vec2 mx){
        vec2 d=max(max(mn-p,vec2(0)), p-mx);
        return length(d);
    }

    // cosine palette (IQ)
    vec3 palette(float t){
        return uPA + uPB * cos(2.0*PI*(uPC*t + uPD));
    }

    void main(){
        
        if(uPointTexelCount<2){ fragColor=vec4(0); return; }

        vec2 p = vUV * uResolution;

        vec2 bbMin=uPointAABB.xy*uResolution, bbMax=uPointAABB.zw*uResolution;
        float cutoff = -log(1.0/255.0)/max(uDecay,1e-4) + 1.5*uHLWidth;
        if(distToAABB(p, bbMin, bbMax) > cutoff){ fragColor=vec4(0); return; }

        vec2 di = distAndInside(p);
        float d = di.x; bool inside = di.y>0.5;
        if(inside){ fragColor=vec4(0); return; }

        // мягкий край у контура
        float edgeAA = max(fwidth(d), 1e-3);
        float edgeMask = smoothstep(uEdgeFeatherPx - edgeAA, uEdgeFeatherPx + edgeAA, sqrt(d));

        // шумовая «дрожь» фаз
        float amp = uNoiseAmpPx * edgeMask;
        float s   = max(uNoiseScale, 1e-3);
        float n   = fbm( (p/s) + vec2(0.0, uTime*uNoiseSpeed) );
        float dJ  = d + (n-0.5)*2.0*amp;

        // фаза и индекс гребня
        float phase   = (dJ - uHLSpeed*uTime) / max(uHLWidth,1e-3);
        float waveIdx = floor(phase + 0.5);                    // центр ближайшего гребня
        float crest   = 0.5 + 0.5 * cos(2.0*PI*phase);
        float aa      = uSoft + fwidth(phase);
        float rings   = smoothstep(1.0-aa, 1.0, crest);

        float atten = exp(-uDecay * d);
        
        float alpha = rings * atten * edgeMask * mix(0.85, 1.0, n) * uFillColor.a;

        // цвет по палитре для конкретной волны
        float t = fract(waveIdx * uColorStride + uColorOffset);
        vec3 waveCol = palette(t);
        vec3 baseCol = mix(uFillColor.rgb, waveCol, clamp(uColorAmount,0.0,1.0));

        fragColor = vec4(baseCol * alpha, alpha);
    }
`
