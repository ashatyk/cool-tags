// language=GLSL
export default `
    
    #version 300 es
    precision highp float;

    in vec2 vUV;
    out vec4 fragColor;

    uniform vec2  uResolution;        // разрешение вьюпорта
    uniform sampler2D uPointTexture;  // текстура координат сегмента: R=x, G=y  (нормализованы)
    uniform vec4  uPointAABB;         // minX,minY,maxX,maxY сегмента (нормализованы)
    uniform int   uPointTexelCount;   // число вершин сегмента
    uniform vec2  uPointTextureDim;   // (W,H) текстуры координат сегмента

    // заливка и блик
    uniform vec4  uFillColor;           // цвет заливки, напр. vec4(0.0,1.0,0.0,1.0)
    uniform vec4  uHLColor;             // цвет блика, напр. vec4(1.0,1.0,1.0,1.0)
    uniform float uHLWidth;             // ширина блика в пикселях (напр. 12.0)
    uniform float uHLSpeed;             // скорость блика в пикселях/сек (напр. 120.0)
    uniform float uHLOffset;            // начальный сдвиг вдоль направления (px)
    uniform vec2  uHLDir;               // направление блика (любое, нормализуем)
    uniform float uTime;                // время (сек)

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

    void main() {
        
        // ранний выход по AABB (UV-нормализованные)
        if (vUV.x < uPointAABB.x || vUV.x > uPointAABB.z || vUV.y < uPointAABB.y || vUV.y > uPointAABB.w) {
            fragColor = vec4(0.1); return; 
        }

        if (uPointTexelCount < 3) { fragColor = vec4(0.0); return; }

        vec2 P = vUV * uResolution;

        const int MAX_SEGMENT_CHECK = 8192;
        
        int N = min(uPointTexelCount, MAX_SEGMENT_CHECK);

        // even-odd с «half-open» правилом и пропуском деградантов
        bool inside = false;
        const float EPS = 1e-6;

        for (int i = 0; i < MAX_SEGMENT_CHECK; ++i) {
            if (i >= N) break;
            int j = (i + 1 == N) ? 0 : i + 1;

            vec2 a = readPointPx(i);
            
            vec2 b = readPointPx(j);

            vec2 ab = b - a;
            if (abs(ab.x) + abs(ab.y) < EPS) continue;
            
            bool aboveA = (a.y <= P.y);
            bool aboveB = (b.y <= P.y);
            
            if (aboveA != aboveB) {
                float t = (P.y - a.y) / (b.y - a.y);      // ∈ (0,1]
                float xInt = a.x + t * ab.x;
                if (P.x < xInt) inside = !inside;
            }
        }

        if (!inside) { fragColor = vec4(0.1); return; }

        // fragColor = inside ? vec4(0.0, 0.2, 0.0, 0.2) : vec4(0.0);

        // ===== Бегущий блик =====
        vec2 d = normalize(uHLDir);
        // Signed distance до центра «линии блика», движущейся вдоль d
        float s = dot(P, d);
        
        float center = uHLOffset + uHLSpeed * uTime;
        
        float distToLine = abs(s - center);

        // AA по ширине блика
        float aa = max(1.0, fwidth(s));
        
        float band = 1.0 - smoothstep(0.5*uHLWidth, 0.5*uHLWidth + aa, distToLine);

        // цвет: заливка + блик сверху
        vec4 col = uFillColor;
        
        col = mix(col, uHLColor, band); 

        fragColor = col;
    }
`
