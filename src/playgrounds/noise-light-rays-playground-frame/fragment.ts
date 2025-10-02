// SNOISE_LIGHT_RAYS_3COL.refactored.ts
// Purpose: 3-цветные «лучи света» вокруг полигона на SDF.
// language=GLSL
export default `
    #version 300 es
    precision lowp float;
    
    in vec2 vUV;
    out vec4 fragColor;

    //==========================================================================
    // UNIFORMS
    //==========================================================================
    // Общие
    uniform vec2  uResolution;
    uniform float uTime;

    // Полигон: точки в текстуре
    uniform sampler2D uPointTexture;
    uniform vec4  uPointAABB;         // [minX,minY,maxX,maxY] в [0..1]
    uniform int   uPointTexelCount;   // кол-во точек
    uniform vec2  uPointTextureDim;   // размеры текстуры с точками

    // Параметры эффекта
    uniform float uEdgeFeatherPx;     // мягкость по краю
    uniform float uCenterTranslation; // 0..1 смещение к центру bb

    // Цвета (по слою)
    uniform vec4 uColor0, uColor1, uColor2;

    // Параметры лучей (по компоненте: .x -> для цвета0, .y -> цвета1, .z -> цвета2)
    uniform vec3 uRayStrength3;     // сила
    uniform vec3 uRayLengthPx3;     // длина в пикселях
    uniform vec3 uRaySharpness3;    // «острота» (экспонента)
    uniform vec3 uRayDensity3;      // плотность по углу
    uniform vec3 uRaySpeed3;        // скорость анимации
    uniform vec3 uRayFalloff3;      // эксп. затухание по расстоянию
    uniform vec3 uRayStartSoftPx3;  // мягкий старт от края
    uniform vec3 uJoinSoftness3;    // мягкость слияния соседних лучей

    //==========================================================================
    // CONSTANTS & MACROS
    //==========================================================================
    const float PI      = 3.14;   // ровно как в исходнике
    const float INV_TAU = 0.16;   // ≈ 1/(2π), оставлено как было
    #define  MAX_POINTS 1024

    //==========================================================================
    // UTILS: RNG, выбор компонентов, цвета
    //==========================================================================
    uint uhash(uint x){
        x ^= x>>16u; x *= 2246822519u;
        x ^= x>>13u; x *= 3266489917u;
        x ^= x>>16u; return x;
    }
    float hash11(float x){
        uint u = floatBitsToUint(x);
        return float(uhash(u)) / 4294967296.0;
    }

    // Выбор компоненты vec3 по индексу 0..2
    float pick(vec3 v, int i){ return (i==0)?v.x:((i==1)?v.y:v.z); }

    // Выбор цвета слоя по индексу 0..2
    vec3 colorPick(int i){ return (i==0)?uColor0.rgb:((i==1)?uColor1.rgb:uColor2.rgb); }

    //==========================================================================
    // GEOMETRY: чтение точек полигона
    //==========================================================================
    vec2 readPointN(int i){ // нормализованные координаты из текстуры
        int w = int(uPointTextureDim.x);
        ivec2 xy = ivec2(i % w, i / w);
        return texelFetch(uPointTexture, xy, 0).rg;
    }
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

    //==========================================================================
    // NOISE: треугольная волна
    //==========================================================================
    float tri(float x){ return abs(fract(x) - .5); }
    
    vec3  tri3(vec3 p){ return vec3(tri(p.x), tri(p.y), tri(p.z)); }
    
    float triNoise3D(vec3 p, float spd){
        float z = 0.3, rz = 0.1;
        vec3  bp = p;
        for(float i=0.0; i<=3.0; i+=1.0){
            vec3 dg = tri3(bp*0.01);
            p  += (dg + uTime*0.1*spd);
            bp *= 2.0; z *= 0.9; p *= 1.6;
            rz += tri(p.z + tri(0.6*p.x + 0.1*tri(p.y))) / z;
        }
        return smoothstep(0.0, 8.0, rz + sin(rz + sin(z)*2.8)*2.2);
    }

    //==========================================================================
    // MATH APPROX: atan2 и сглаженные максимумы
    //==========================================================================
    // Быстрый atan2-аппрокс. (как в исходнике)
    float fastAtan2(float y, float x){
        float ax = abs(x), ay = abs(y);
        float a  = min(ax, ay) / max(ax + 1e-8, ay + 1e-8);
        float s  = a*a;
        // 7-й порядок (minimax)
        float r = (((-0.0464964749*s + 0.15931422)*s - 0.327622764)*s + 0.999787841)*a;
        if(ay > ax) r = 1.57079637 - r;
        if(x  < 0.0) r = 3.14159274 - r;
        return (y < 0.0) ? -r : r;
    }
    
    // Дешевая версия сглаженного max (используется в shadeColor)
    float smoothMax2(float a, float b, float k){
        float h = clamp(0.5 + 0.5*(a - b)/k, 0.0, 1.0);
        return mix(b, a, h) + k*h*(1.0 - h);
    }
    
    float smoothMax3(float a, float b, float c, float k){
        return smoothMax2(smoothMax2(a, b, k), c, k);
    }

    //==========================================================================
    // SHADING: интенсивность лучей для одного слоя
    //==========================================================================
    float shadeColor(int i, float uu, float d, float edgeMask){
        // Плотность и дискретный ID луча
        float density = pick(uRayDensity3, i);
        float rayId   = floor(uu * density);

        // Псевдослучайные вариации по лучу
        float r1 = hash11(float(i) + rayId + 13.37);
        float r2 = hash11(float(i) + rayId + 71.17);
        float r3 = hash11(float(i) + rayId + 131.9);

        float lenVar   = mix(0.65, 1.35, r1);
        float ampVar   = mix(0.70, 1.25, r2);
        float speedVar = mix(0.50, 1.10, r3);

        // Геометрия вдоль расстояния
        float rayLen = pick(uRayLengthPx3, i);
        float startS = pick(uRayStartSoftPx3, i);
        float dShift = max(0.0, d - startS);
        float maxLen = max(1.0, rayLen * lenVar);
        float t = clamp(dShift / maxLen, 0.0, 1.0);

        // Шум по углу (с соседями для слияния)
        float phase = 0.1 * pick(uRaySpeed3, i) * speedVar;
        float base  = uu * density + r1 * 6.2831853; // 2π
        float du    = 0.5 / max(density, 1.0);

        float s0 = triNoise3D(vec3(base, 0.0, uu*density), phase);
        float sL = triNoise3D(vec3((uu-du)*density + r1*6.2831853, 0.0, (uu-du)*density), phase);
        float sR = triNoise3D(vec3((uu+du)*density + r1*6.2831853, 0.0, (uu+du)*density), phase);

        // Слияние соседних лучей
        float kJoin = mix(0.1, 0.6, clamp(pick(uJoinSoftness3,i), 0.0, 1.0));
        float s = smoothMax3(s0, sL, sR, kJoin);

        // Профиль луча
        float sharp = clamp(pick(uRaySharpness3, i), 0.0, 1.0);
        
        float th    = mix(0.60, 0.95, t);
        
        float core  = smoothstep(th, 1.0, s);
        
        core = pow(core, mix(1.2, 10.0, t * sharp));
        
        float taper = pow(1.0 - t, mix(0.8, 4.0, sharp));

        // Затухание и сила
        float fall     = exp(-pick(uRayFalloff3, i) * d);
        float strength = pick(uRayStrength3, i);

        return strength * ampVar * core * taper * fall * edgeMask;
    }

    //==========================================================================
    // MAIN
    //==========================================================================
    void main(){
        if(uPointTexelCount < 2){ fragColor = vec4(0.0); return; }

        // Пиксель в пиксельных координатах
        vec2 p = vUV * uResolution;

        // AABB полигона в пикселях
        vec2 bbMin  = uPointAABB.xy * uResolution;
        vec2 bbMax  = uPointAABB.zw * uResolution;
        vec2 center = 0.5 * (bbMin + bbMax);

        // Сдвиг к центру
        vec2 translatedP = mix(p, center, uCenterTranslation);

        // Расстояние и внутри/снаружи
        vec2  di = signedDistanceField(translatedP);
        float d  = di.x;
        bool  inside = di.y > 0.5;
        if(inside){ fragColor = vec4(0.0); return; }

        float edgeMask = smoothstep(uEdgeFeatherPx - d, uEdgeFeatherPx + d, log(d));

        // Угол и нормализованный параметр по окружности
        vec2  v   = p - center;
        float ang = fastAtan2(v.y, v.x);
        float uu  = (ang + 3.141) * INV_TAU; // 0..1

        // Сумма трёх слоёв
        vec3 col = vec3(0.0);
        float sumI = 0.0;
        for(int c=0; c<3; ++c){
            float I = shadeColor(c, uu, d, edgeMask);
            col  += colorPick(c) * I;
            sumI += I;
        }

        fragColor = vec4(col, clamp(sumI, 0.0, 1.0));
    }
`;
