// language=GLSL
export default `
#version 300 es
precision mediump float;

in vec2 vUV;
out vec4 fragColor;

uniform vec2  uResolution;
uniform float uTime;

// Полигон
uniform sampler2D uPointTexture;
uniform vec4  uPointAABB;       // [minX,minY,maxX,maxY] в [0..1]
uniform int   uPointTexelCount;
uniform vec2  uPointTextureDim;

// Кольцо
uniform float uRingOffsetPx;    // смещение от границы (>=0)
uniform float uRingWidthPx;     // толщина кольца
uniform float uEdgeFeatherPx;   // AA по краю
uniform float uCenterTranslation;

// «Муравьи» (экранные полосы)
uniform float uStripePeriodPx;  // период в пикселях
uniform float uStripeAngleRad;  // угол полос
uniform float uStripeSpeedPx;   // скорость вдоль нормали к полосе (px/s)
uniform float uStripeSmooth;    // 0..1 мягкость кончиков
uniform vec3  uColorOn, uColorOff;
uniform float uIntensity;

#define MAX_POINTS 1024
#define EPS 1e-6

vec2 readPointN(int i){
  int w = int(uPointTextureDim.x);
  ivec2 xy = ivec2(i % w, i / w);
  return texelFetch(uPointTexture, xy, 0).rg;
}
vec2 readPointPx(int i){ return readPointN(i) * uResolution; }

// SDF: расстояние до ломаной + inside (even-odd)
vec2 sdf(vec2 p){
  float bestD = 1e20;
  bool inside = false;
  int N = min(uPointTexelCount, MAX_POINTS);

  vec2 a = readPointPx(0);
  for(int i=0;i<MAX_POINTS;++i){
    if(i>=N) break;
    int j = (i+1==N)?0:(i+1);
    vec2 b = readPointPx(j);
    vec2 ab = b - a;
    if(abs(ab.x)+abs(ab.y)>EPS){
      vec2 pa = p - a;
      float h = clamp(dot(pa,ab)/max(dot(ab,ab),1e-8), 0.0, 1.0);
      bestD = min(bestD, length(pa - ab*h));
      bool cond = ((a.y<=p.y)&&(b.y>p.y)) || ((b.y<=p.y)&&(a.y>p.y));
      if(cond){
        float xInt = a.x + (p.y - a.y)*ab.x/ab.y;
        if(p.x < xInt) inside = !inside;
      }
    }
    a = b;
  }
  return vec2(bestD, inside?1.0:0.0);
}

float ringMask(float s, float R, float W, float feather){
  float r0 = max(0.0, R - 0.5*W);
  float r1 = R + 0.5*W;
  float inL  = smoothstep(r0 - feather, r0, s);
  float inR  = 1.0 - smoothstep(r1, r1 + feather, s);
  return clamp(inL*inR, 0.0, 1.0);
}

void main(){
  if(uPointTexelCount<2){ fragColor=vec4(0.0); return; }

  vec2 p = vUV * uResolution;

  // сдвиг к центру AABB (опционально)
  vec2 bbMin=uPointAABB.xy*uResolution, bbMax=uPointAABB.zw*uResolution;
  vec2 center=0.5*(bbMin+bbMax);
  vec2 q = mix(p, center, uCenterTranslation);

  // SDF и маска кольца СНАРУЖИ
  vec2 di = sdf(q);
  float d = di.x;
  bool inside = di.y>0.5;
  float band = ringMask(d, uRingOffsetPx, uRingWidthPx, uEdgeFeatherPx);
  if(band<=0.0 || inside){ fragColor=vec4(0.0); return; }

  // Экранные полосы (как в твоём примере): sin по косому направлению
  vec2 dir = vec2(cos(uStripeAngleRad), sin(uStripeAngleRad));         // направление гребней
  float period = max(uStripePeriodPx, 1e-4);
  float phase  = (dot(p, dir) + uStripeSpeedPx*uTime) / period;        // в периодах
  float aa     = fwidth(phase);                                        // антиалиас
  float s      = sin(6.2831853*phase);                                 // −1..1
  float k      = clamp(uStripeSmooth, 0.0, 1.0);
  float soft   = k + aa;                                               // сглаживание кончиков
  float stripe = smoothstep(-soft, soft, s);                           // 0..1

  vec3 col  = mix(uColorOff, uColorOn, stripe);
  fragColor = vec4(col, band*uIntensity);
}
`;
