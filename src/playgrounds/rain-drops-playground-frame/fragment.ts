// language=GLSL
export default `
    #version 300 es
    precision highp float;

    in vec2 vUV;
    out vec4 fragColor;

    uniform vec2  uResolution;

    // Полигон
    uniform sampler2D uPointTexture;
    uniform vec4  uPointAABB;
    uniform int   uPointTexelCount;
    uniform vec2  uPointTextureDim;

    // Картинка
    uniform sampler2D uDiffuse;

    // Время
    uniform float uTime;

    // Совместимость API
    uniform float uHLSpeed;
    uniform float uAmount;

    // Направление потока (радианы). 0 = вниз.
    uniform float uFlowAngleRad;

    #define S(a,b,t) smoothstep(a,b,t)
    #define MAX_POINTS 2048

    // ---------- utils ----------
    mat2 rot(float a){
        float s = sin(a), c = cos(a);
        return mat2(c, -s, s, c);
    }

    // ---------- polygon ----------
    vec2 readPointN(int i){
        int w = int(uPointTextureDim.x);
        ivec2 xy = ivec2(i % w, i / w);
        return texelFetch(uPointTexture, xy, 0).rg;
    }

    vec2 readPointPx(int i){ return readPointN(i) * uResolution; }

    vec2 distAndInside(vec2 p){
        float bestD = 1e20;
        bool inside = false;
        int N = min(uPointTexelCount, MAX_POINTS);
        const float EPS = 1e-6;
        if(N<=1) return vec2(bestD, 0.0);

        vec2 a = readPointPx(0);
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

    vec3 N13(float p){
        vec3 p3 = fract(vec3(p) * vec3(.1031,.11369,.13787));
        p3 += dot(p3, p3.yzx + 19.19);
        return fract(vec3((p3.x + p3.y)*p3.z, (p3.x+p3.z)*p3.y, (p3.y+p3.z)*p3.x));
    }

    float N(float t){ return fract(sin(t*12345.564)*7658.76); }

    float Saw(float b, float t){ return S(0., b, t)*S(1., b, t); }

    vec2 DropLayer2(vec2 uv, float t){
        vec2 UV = uv;
        uv.y += t*0.75;
        vec2 a = vec2(6., 1.);
        vec2 grid = a*2.;
        vec2 id = floor(uv*grid);
        float colShift = N(id.x);
        uv.y += colShift;

        id = floor(uv*grid);
        vec3 n = N13(id.x*35.2+id.y*2376.1);
        vec2 st = fract(uv*grid)-vec2(.5, 0);

        float x = n.x-.5;
        float y = UV.y*20.;
        float wiggle = sin(y+sin(y));
        x += wiggle*(.5-abs(x))*(n.z-.5);
        x *= .7;
        float ti = fract(t+n.z);
        y = (Saw(.85, ti)-.5)*.9+.5;
        vec2 p = vec2(x, y);

        float d = length((st-p)*a.yx);
        float mainDrop = S(.4, .0, d);

        float r = sqrt(S(1., y, st.y));
        float cd = abs(st.x-x);
        float trail = S(.23*r, .15*r*r, cd);
        float trailFront = S(-.02, .02, st.y-y);
        trail *= trailFront*r*r;

        y = UV.y;
        float trail2 = S(.2*r, .0, cd);
        float droplets = max(0., (sin(y*(1.-y)*120.)-st.y))*trail2*trailFront*n.z;
        y = fract(y*10.)+(st.y-.5);
        float dd = length(st-vec2(x, y));
        droplets = S(.3, 0., dd);
        float m = mainDrop+droplets*r*trailFront;

        return vec2(m, trail);
    }

    float StaticDrops(vec2 uv, float t){
        uv *= 40.;
        vec2 id = floor(uv);
        uv = fract(uv)-.5;
        vec3 n = N13(id.x*107.45+id.y*3543.654);
        vec2 p = (n.xy-.5)*.7;
        float d = length(uv-p);
        float fade = Saw(.025, fract(t+n.z));
        float c = S(.3, 0., d)*fract(n.z*10.)*fade;
        return c;
    }

    vec2 Drops(vec2 uv, float t, float l0, float l1, float l2){
        float s  = StaticDrops(uv, t)*l0;
        vec2 m1  = DropLayer2(uv,        t)*l1;
        vec2 m2  = DropLayer2(uv*1.85,   t)*l2;
        float c  = s + m1.x + m2.x;
        c = S(.3, 1., c);
        return vec2(c, max(m1.y*l0, m2.y*l1));
    }

    void main(){
        vec2 fragCoord = vUV * uResolution;

        vec2 UV = vUV;
        vec2 uv = (fragCoord - 0.5*uResolution) / uResolution.y;

        vec3 base = texture(uDiffuse, UV).rgb;

        // только внутри полигона
        vec2 di = distAndInside(fragCoord);
        if(di.y < 0.5){
            fragColor = vec4(0.0);
            return;
        }

        // время и дождь
        float T = -uTime;
        float t = 0.01 * uHLSpeed * T;
        float rainAmount = clamp(uAmount, 0.0, 1.0);

        float maxBlur = mix(3., 6., rainAmount);
        float minBlur = 2.;
        float staticDrops = S(-.5, 1., rainAmount)*2.;
        float layer1      = S(.25, .75, rainAmount);
        float layer2      = S(.0,  .5,  rainAmount);

        // Повернуть систему так, чтобы "вниз" был вдоль uFlowAngleRad
        mat2 Rm = rot(-uFlowAngleRad);
        mat2 Rp = rot( uFlowAngleRad);
        vec2 uvR = Rm * uv;

        vec2 c = Drops(uvR, t, staticDrops, layer1, layer2);

        // нормали в повернутом пространстве
        vec2 e = vec2(.001, 0.);
        float cx = Drops(uvR + e,     t, staticDrops, layer1, layer2).x;
        float cy = Drops(uvR + e.yx,  t, staticDrops, layer1, layer2).x;
        vec2 nLocal = vec2(cx - c.x, cy - c.x);
        // вернуть нормаль в пространство UV
        vec2 n = Rp * nLocal;

        // ЗРИТЕЛЬ ЗА ОКНОМ: инвертируем знак смещения
        float focus = mix(maxBlur - c.y, minBlur, S(.1, .2, c.x));
        vec3 col = textureLod(uDiffuse, UV + n, focus).rgb;

        fragColor = vec4(col, 1.0);
    }
`;
