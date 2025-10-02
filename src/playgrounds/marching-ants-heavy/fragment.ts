// language=GLSL
export default `
    #version 300 es
precision mediump float;

    in vec2 vUV;
    out vec4 fragColor;

    uniform vec2  uResolution;
    uniform float uTime;

    uniform sampler2D uPointTexture;
    uniform vec4  uPointAABB;       // [minX,minY,maxX,maxY] в [0..1]
    uniform int   uPointTexelCount;
    uniform vec2  uPointTextureDim;

    uniform float uEdgeFeatherPx;
    uniform float uCenterTranslation;

    // Marching Ants
    uniform float uAntsOffsetPx;    // 0 = по границе
    uniform float uAntsWidthPx;     // толщина
    uniform float uDashPeriodPx;    // период по дуге (если uDashCount<=0)
    uniform float uDashDuty;        // 0..1
    uniform float uDashSpeedPx;     // px/s
    uniform float uDashCount;       // >0 => ровно N штрихов по периметру
    uniform vec3  uColorOn, uColorOff;
    uniform float uIntensity;

    #define MAX_POINTS 1024
#define EPS 1e-6

    int wrapi(int i, int N){ return (i%N+N)%N; }

    vec2 readPointN(int i){
        int w = int(uPointTextureDim.x);
        ivec2 xy = ivec2(i % w, i / w);
        return texelFetch(uPointTexture, xy, 0).rg;
    }
    vec2 readPointPx(int i){ return readPointN(i) * uResolution; }

    // Catmull–Rom (uniform)
    void crEval(vec2 p0, vec2 p1, vec2 p2, vec2 p3, float t, out vec2 C, out vec2 dC, out vec2 ddC){
        float t2=t*t, t3=t2*t;
        vec2 a = -p0 + p2;
        vec2 b =  2.0*p0 - 5.0*p1 + 4.0*p2 - p3;
        vec2 c = -p0 + 3.0*p1 - 3.0*p2 + p3;
        C   = 0.5*( (2.0*p1) + a*t + b*t2 + c*t3 );
        dC  = 0.5*( a + 2.0*b*t + 3.0*c*t2 );
        ddC = 0.5*( 2.0*b + 6.0*c*t );
    }

    // Ньютона для одного CR-сегмента (без рекурсии)
    float closestOnCR_idx(int i, vec2 q, out vec2 C, out vec2 dC){
        int N=min(uPointTexelCount,MAX_POINTS);
        vec2 p0=readPointPx(wrapi(i-1,N));
        vec2 p1=readPointPx(i);
        vec2 p2=readPointPx(wrapi(i+1,N));
        vec2 p3=readPointPx(wrapi(i+2,N));

        // старт — проекция на хорду p1->p2
        vec2 ab=p2-p1;
        float t=clamp(dot(q-p1,ab)/max(dot(ab,ab),EPS),0.0,1.0);

        for(int it=0; it<3; ++it){
            vec2 CC,dCC,ddCC; crEval(p0,p1,p2,p3,t,CC,dCC,ddCC);
            vec2 r=CC-q;
            float fp  = 2.0*dot(dCC,r);
            float fpp = 2.0*(dot(ddCC,r)+dot(dCC,dCC));
            t = clamp(t - fp/max(fpp,1e-6), 0.0, 1.0);
        }
        vec2 dd; vec2 dd2;
        crEval(p0,p1,p2,p3,t,C,dC,dd2);
        return t;
    }

    bool pointInPoly(vec2 p){
        int N=min(uPointTexelCount,MAX_POINTS);
        bool inside=false;
        vec2 a=readPointPx(0);
        for(int i=0;i<MAX_POINTS;++i){
            if(i>=N) break;
            int j=(i+1==N)?0:(i+1);
            vec2 b=readPointPx(j);
            if(abs(b.x-a.x)+abs(b.y-a.y)>EPS){
                bool hit=((a.y<=p.y)&&(b.y>p.y))||((b.y<=p.y)&&(a.y>p.y));
                if(hit){
                    float xInt=a.x+(p.y-a.y)*(b.x-a.x)/(b.y-a.y);
                    if(p.x<xInt) inside=!inside;
                }
            }
            a=b;
        }
        return inside;
    }

    // длина CR-сегмента [0..t] по Симпсону (3 выборки)
    float segLenCR_idx(int i, float t){
        int N=min(uPointTexelCount,MAX_POINTS);
        vec2 p0=readPointPx(wrapi(i-1,N));
        vec2 p1=readPointPx(i);
        vec2 p2=readPointPx(wrapi(i+1,N));
        vec2 p3=readPointPx(wrapi(i+2,N));
        vec2 C0,d0,dd0; crEval(p0,p1,p2,p3,0.0, C0,d0,dd0);
        vec2 Cm,dm,ddm; crEval(p0,p1,p2,p3,0.5*t, Cm,dm,ddm);
        vec2 C1,d1,dd1; crEval(p0,p1,p2,p3,t,   C1,d1,dd1);
        return (t/6.0)*(length(d0)+4.0*length(dm)+length(d1));
    }

    float ringMask(float s, float R, float W, float feather){
        float r0=max(0.0,R-0.5*W), r1=R+0.5*W;
        float inL=smoothstep(r0-feather,r0,s);
        float inR=1.0-smoothstep(r1,r1+feather,s);
        return clamp(inL*inR,0.0,1.0);
    }

    void main(){
        if(uPointTexelCount<2){ fragColor=vec4(0.0); return; }

        vec2 p=vUV*uResolution;

        vec2 bbMin=uPointAABB.xy*uResolution;
        vec2 bbMax=uPointAABB.zw*uResolution;
        vec2 center=0.5*(bbMin+bbMax);
        vec2 q=mix(p,center,uCenterTranslation);

        // старт: ближайший ЛИНЕЙНЫЙ сегмент
        int N=min(uPointTexelCount,MAX_POINTS);
        float bestD=1e20; int bestI=0; float bestH=0.0;
        vec2 A=readPointPx(0);
        for(int i=0;i<MAX_POINTS;++i){
            if(i>=N) break;
            int j=(i+1==N)?0:(i+1);
            vec2 B=readPointPx(j);
            vec2 ab=B-A;
            if(abs(ab.x)+abs(ab.y)>EPS){
                float h=clamp(dot(q-A,ab)/max(dot(ab,ab),EPS),0.0,1.0);
                float d=length((A+ab*h)-q);
                if(d<bestD){ bestD=d; bestI=i; bestH=h; }
            }
            A=B;
        }

        // кандидаты CR: i-1, i, i+1
        int cand[9];
        cand[0]=wrapi(bestI-4,N);
        cand[1]=wrapi(bestI-3,N);
        cand[2]=wrapi(bestI-2,N);
        cand[3]=wrapi(bestI-1,N);
        cand[4]=bestI;
        cand[5]=wrapi(bestI+1,N);
        cand[6]=wrapi(bestI+2,N);
        cand[7]=wrapi(bestI+3,N);
        cand[8]=wrapi(bestI+4,N);

        vec2 Cbest=vec2(0.0), Tbest=vec2(1.0,0.0);
        
        float tbest=0.0, dbest=1e20; int ibest=bestI;

        for(int c=0;c<1;++c){
            int ii=cand[c];
            vec2 Ccur, dC; float t=closestOnCR_idx(ii,q,Ccur,dC);
            float d=length(Ccur-q);
            if(d<dbest){ dbest=d; ibest=ii; tbest=t; Cbest=Ccur; Tbest=dC; }
        }

        vec2 n=normalize(vec2(-Tbest.y, Tbest.x));
        float s=length(q - Cbest);
        bool inside=pointInPoly(q);
        float band=ringMask(s, abs(uAntsOffsetPx), uAntsWidthPx, uEdgeFeatherPx);
        if(band<=0.0 || inside){ fragColor=vec4(0.0); return; }

        // периметр и префикс (для фазы)
        float total=0.0, prefix=0.0;
        for(int k=0;k<MAX_POINTS;++k){
            if(k>=N) break;
            float segL=segLenCR_idx(k,1.0);
            if(k<ibest) prefix+=segL;
            total+=segL;
        }
        float u = prefix + segLenCR_idx(ibest, tbest);

        // период: фиксированный или кратный периметру
        float period = (uDashCount>0.5) ? max(total/max(uDashCount,1.0),1e-4)
        : max(uDashPeriodPx,1e-4);

        float g   = (u + uDashSpeedPx*uTime)/period;
        float fw  = fwidth(g);
        float duty= clamp(uDashDuty,0.0,1.0);
        float loc = fract(g);
        float pulse = clamp(smoothstep(0.0, fw, loc) * (1.0 - smoothstep(duty, duty+fw, loc)), 0.0, 1.0);

        vec3 col = mix(uColorOff, uColorOn, pulse);
        fragColor = vec4(col, band*uIntensity);
    }
`;
