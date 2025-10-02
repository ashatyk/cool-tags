// language=GLSL
export default `
    #version 300 es
    precision lowp float;

    // I/O
    in vec2 vUV;
    out vec4 fragColor;

    // Общие
    uniform vec2  uResolution;
    uniform float uTime;

    // Полигон: точки в текстуре
    uniform sampler2D uPointTexture;
    uniform vec4  uPointAABB;         // [minX,minY,maxX,maxY] в [0..1]
    uniform int   uPointTexelCount;   // кол-во точек
    uniform vec2  uPointTextureDim;   // размеры текстуры с точками

    // Поведение
    uniform float uCenterTranslation; // 0..1
    uniform float uEdgeFeatherPx;     // не обязателен, можно 0

    // --- Параметры луча ---
    uniform float uBeamOffsetPx;      // отступ от границы наружу (px)
    uniform float uBeamWidthPx;       // полуширина луча (px)
    uniform float uBeamAngularWidth;  // угловая ширина "узла" (радианы)
    uniform float uBeamSpeed;         // скорость обхода (рад/сек)
    uniform float uBeamIntensity;     // множитель яркости
    uniform vec3  uBeamColor;         // цвет

    #define MAX_POINTS 1024

    vec2 readPointN(int i){
        int w = int(uPointTextureDim.x);
        ivec2 xy = ivec2(i % w, i / w);
        return texelFetch(uPointTexture, xy, 0).rg;
    }
    vec2 readPointPx(int i){ return readPointN(i) * uResolution; }
    
    float signedDistanceWithFrame(vec2 p, out bool inside, out vec2 n, out vec2 t){
        int N = min(uPointTexelCount, MAX_POINTS);
        if(N < 2){ inside = false; n = vec2(1.0,0.0); t = vec2(0.0,1.0); return 1e20; }

        float bestD2 = 1e30;
        vec2  bestA = vec2(0.0), bestB = vec2(1.0);
        float bestH = 0.0;

        inside = false;

        // старт с последней вершины, чтобы избежать спец-случаев замыкания
        vec2 a = readPointPx(N-1);

        for(int i=0; i<MAX_POINTS; ++i){
            if(i>=N) break;
            vec2 b  = readPointPx(i);
            vec2 ab = b - a;

            // расстояние до отрезка a-b
            vec2 pa = p - a;
            float denom = max(dot(ab,ab), 1e-12);
            float h = clamp(dot(pa,ab) / denom, 0.0, 1.0);
            vec2  q = a + ab*h;
            vec2  dq = p - q;
            float d2 = dot(dq,dq);
            if(d2 < bestD2){
                bestD2 = d2;
                bestA  = a;
                bestB  = b;
                bestH  = h;
            }

            // чётно-нечётное правило без деления на ab.y и без двойных счётов на вершинах
            bool yStraddle = ((a.y > p.y) != (b.y > p.y));
            if(yStraddle){
                float t01 = (p.y - a.y) / (b.y - a.y);      // безопасно, раз знаки разные
                float xInt = mix(a.x, b.x, t01);
                if(p.x < xInt) inside = !inside;
            }

            a = b;
        }

        // касательная и нормаль в ближайшей точке
        vec2 qbest = mix(bestA, bestB, bestH);
        vec2 e     = bestB - bestA;
        float el2  = max(dot(e,e), 1e-12);
        t = e * inversesqrt(el2);               // normalize без NaN
        vec2 nRaw = normalize(p - qbest);       // градиент расстояния
        n = inside ? -nRaw : nRaw;              // наружу

        float d = sqrt(bestD2);
        return inside ? -d : d;
    }

    // обёртка для разницы углов в [-pi..pi] без шва
    float angDiff(float a, float b){
        float d = a - b;
        return atan(sin(d), cos(d));
    }

    void main(){
        if(uPointTexelCount < 2){ fragColor = vec4(0.0); return; }

        vec2 p = vUV * uResolution;

        // центр bb
        vec2 bbMin  = uPointAABB.xy * uResolution;
        vec2 bbMax  = uPointAABB.zw * uResolution;
        vec2 center = 0.5 * (bbMin + bbMax);

        vec2 pp = mix(p, center, uCenterTranslation);

        bool  inside;
        vec2  n, t;
        float sd = signedDistanceWithFrame(pp, inside, n, t); // + outside, - inside

        // Луч только СНАРУЖИ
        if(sd <= 0.0){ fragColor = vec4(0.0); return; }

        // Радиальная маска полосы: |sd - R| < W
        float radial = smoothstep(uBeamWidthPx, 0.0, abs(sd - uBeamOffsetPx));

        // Угловая "шторка" вокруг движущегося центра фазы
        float theta   = atan(n.y, n.x);                 // ориентация границы в точке
        float theta0  = uTime * uBeamSpeed;             // бег вокруг фигуры
        float dTheta  = abs(angDiff(theta, theta0));    // без шва
        float angular = smoothstep(uBeamAngularWidth, 0.0, dTheta);

        // Доп. прижатие к границе, если нужно
        float edgeFeather = 1.0;
        if(uEdgeFeatherPx > 0.0){
            // мягкая затухалка с ростом расстояния от самой границы
            edgeFeather = smoothstep(0.0, uEdgeFeatherPx, sd);
        }

        float m = radial * angular * edgeFeather;
        m *= uBeamIntensity;

        vec3 col = uBeamColor * m;
        fragColor = vec4(col, m);
    }
`;
