// language=GLSL
export default `
    #version 300 es
    precision lowp float;

    in vec2 vUV;
    out vec4 fragColor;

    // Общие
    uniform vec2  uResolution;
    uniform float uTime;

    // Полигон
    uniform sampler2D uPointTexture;
    uniform vec4  uPointAABB;       // [minX,minY,maxX,maxY] в [0..1]
    uniform int   uPointTexelCount;
    uniform vec2  uPointTextureDim;

    // SDF
    uniform float uCenterTranslation;

    // Радиальная волна внутри сегмента
    uniform vec2  uFocusOffsetPx;     // фокус относительно центра AABB
    uniform float uWavePeriodPx;      // период гребней, px
    uniform float uWaveThicknessPx;   // толщина гребня, px
    uniform float uWaveSpeedPx;       // базовая скорость, px/с
    uniform float uIntensity;         // 0..2
    uniform vec3  uWaveColor;         // rgb 0..1

    // Искажения формы и скорости
    uniform float uNoiseScale;        // 0.2..3.0
    uniform float uNoiseTimeK;        // 0..2
    uniform float uSwirlRad;          // макс смещение угла, радианы
    uniform float uSwirlFalloffPx;    // спад свирла по r
    uniform float uRadJitterPx;       // радиальный джиттер гребня, px
    uniform float uSpeedJitterK;      // 0..1 синусный модулятор скорости
    uniform float uSpeedJitterHz;     // 0..3 частота синусного модулятора
    uniform float uSpeedNoiseK;       // 0..1 шумовой модулятор скорости
    uniform float uInnerEdgeFadePx;   // затухание у границы изнутри, px

    #define MAX_POINTS 1024
    #define TAU 6.28318530718

    // --- noise utils ---------------------------------------------------------
    float hash21(vec2 p){
        p = fract(p*vec2(123.34, 456.21));
        p += dot(p, p+34.345);
        return fract(p.x*p.y);
    }
    float noise2(vec2 p){
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        vec2  u = f*f*(3.0 - 2.0*f);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }
    float fbm2(vec2 p){
        float s = 0.0, a = 0.5;
        for(int i=0;i<3;i++){
            s += a * noise2(p);
            p *= 2.0;
            a *= 0.5;
        }
        return s;
    }

    // --- polygon SDF: расстояние до ребра и флаг inside ----------------------
    vec2 readPointN(int i){
        int w = int(uPointTextureDim.x);
        ivec2 xy = ivec2(i % w, i / w);
        return texelFetch(uPointTexture, xy, 0).rg;
    }
    vec2 readPointPx(int i){ return readPointN(i) * uResolution; }

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

                bool cond = ((a.y<=p.y)&&(b.y>p.y)) || ((b.y<=p.y)&&(a.y>p.y));
                if(cond){
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

        // Пиксели
        vec2 p = vUV * uResolution;

        // Центр AABB и "усадка"
        vec2 bbMin  = uPointAABB.xy * uResolution;
        vec2 bbMax  = uPointAABB.zw * uResolution;
        vec2 center = 0.5 * (bbMin + bbMax);
        vec2 translatedP = mix(p, center, uCenterTranslation);

        // Маска сегмента
        vec2 di = signedDistanceField(translatedP);
        bool inside = di.y > 0.5;
        if(!inside){ fragColor = vec4(0.0); return; }

        // Фокус
        vec2 focusBase = center + uFocusOffsetPx;
        vec2 focus     = mix(focusBase, center, uCenterTranslation);

        // Полярные координаты
        vec2  off = translatedP - focus;
        float r   = length(off);
        float th  = atan(off.y, off.x);

        // Искажение угла: свирл + шум по позиции
        float fall = exp(-r / max(uSwirlFalloffPx, 1e-3));
        float nAng = fbm2(off * uNoiseScale + uTime * uNoiseTimeK);
        th += uSwirlRad * fall * (nAng*2.0 - 1.0);

        // Пересчет векторa после углового сдвига
        vec2 offWarp = vec2(cos(th), sin(th)) * r;

        // Радиальный джиттер гребня
        float nRad = fbm2(offWarp * (uNoiseScale*1.31) + 13.7 + uTime * (uNoiseTimeK*0.73));
        float rWarp = r + uRadJitterPx * (nRad*2.0 - 1.0);

        // Локальная скорость: синусный модулятор + шумовой
        float speedSin = 1.0 + uSpeedJitterK * sin(TAU * uSpeedJitterHz * uTime + nAng*TAU);
        float speedFbm = 1.0 + uSpeedNoiseK  * ((fbm2(offWarp * (uNoiseScale*0.7) + 57.1 + uTime*0.3*uNoiseTimeK))*2.0 - 1.0);
        float vLocal   = uWaveSpeedPx * speedSin * speedFbm;

        // Период и фаза
        float period = max(uWavePeriodPx, 1e-3);
        float phase  = (rWarp + vLocal * uTime) / period;

        // Треугольная волна и расстояние до ближайшего гребня в px
        float f   = fract(phase);
        float distToCrestPx = min(f, 1.0 - f) * period;

        // Профиль гребня
        float ring = 1.0 - smoothstep(0.0, max(uWaveThicknessPx, 1e-3), distToCrestPx);

        // Затухание у внутренней границы
        float edgeFade = 1.0 - smoothstep(0.0, max(uInnerEdgeFadePx, 1e-3), di.x);

        float a = clamp(uIntensity * ring * edgeFade, 0.0, 1.0);
        fragColor = vec4(uWaveColor * a, a);
    }
`;
