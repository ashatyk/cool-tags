import React, {useEffect, useRef, useState, useCallback, useMemo} from 'react'
// npm i @xenova/transformers d3-contour simplify-js
import type { CSSProperties } from 'react'
import {findSegmentIdAtPoint, getCanvasPoint } from '../utils/hit-test'

import {Application, Assets, Geometry, Mesh, Shader, Sprite, Texture, UniformGroup} from 'pixi.js'
import {DEFAULT_VERTEX} from "../playgrounds/domains/playground-frame/constants.ts";
import {toNum} from "../utils";
import {Field, Form, FormSpy} from "react-final-form";

export type FlatPolygon = number[] // [x0,y0,x1,y1,...]
export type ContourMap = Record<string, FlatPolygon>

export type SegmentTexel = {
    id: string
    image: HTMLImageElement // RGBA8 where R=xn*255, G=yn*255
    w: number
    h: number
    count: number // number of point pairs
    aabbN: [number, number, number, number] // [minX,minY,maxX,maxY] in [0..1]
    pointsN: Float32Array // normalized points [x0,y0,...]
}

export type Props = {
    className?: string
    style?: CSSProperties
    onContoursMap: (map: ContourMap) => void
    onTexelsMap?: (map: Record<string, SegmentTexel>) => void // optional callback with packed texels
    gridStep?: number // px between prompt points
    iouThreshold?: number // 0..1 for dedup
    simplifyTolerance?: number // px
    simplifyHighQuality?: boolean
    minAreaPx?: number // drop tiny masks by area in px
    config: PlaygroundConfig
}

// =============================================================
// Inline module worker that mirrors HF demo but computes ALL contours and caches
// =============================================================
function makeWorker() {
    const code = `
    import { env, SamModel, AutoProcessor, RawImage, Tensor } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.14.0';
    import { loadOpenCV } from 'https://cdn.jsdelivr.net/npm/@opencvjs/web@4.11.0-release.1/lib/index.js';
    const cv = await loadOpenCV(); // WASM загружен, API готов

    // дождаться готовности OpenCV (WASM)
    await cv.ready;

    env.allowLocalModels = false;
    

    class Singleton {
      static model_id = 'Xenova/slimsam-77-uniform';
      static model; static processor; static quantized = true;
      static async get(){
        if(!this.model) this.model = SamModel.from_pretrained(this.model_id, { quantized: this.quantized });
        if(!this.processor) this.processor = AutoProcessor.from_pretrained(this.model_id);
        return Promise.all([this.model, this.processor]);
      }
    }

    // ---- state ----
    let image_inputs = null;       // processor(image)
    let image_embeddings = null;   // model.get_image_embeddings(...)
    let cachedContours = null;     // Record<id, number[]>

    // ---- utils ----
    function buildGridPrompts(W, H, step){
      const pts = [];
      const ox = Math.floor(step/2), oy = Math.floor(step/2);
      for(let y=oy; y<H; y+=step){ for(let x=ox; x<W; x+=step){ pts.push([x,y]); } }
      return pts;
    }

    function thresholdMaskFloat(src, W, H, thr){
      const out = new Uint8Array(W*H);
      for(let i=0;i<out.length;i++) out[i] = src[i] >= thr ? 1 : 0;
      return out;
    }

    function iou(a, b){
      let inter=0, uni=0; const n=a.length;
      for(let i=0;i<n;i++){ const ai=a[i], bi=b[i]; if(ai|bi) uni++; if(ai&bi) inter++; }
      return uni? inter/uni : 0;
    }

    function maskAreaPx(m){ let s=0; for(let i=0;i<m.length;i++) s+=m[i]; return s; }

    // --- OpenCV.js: извлечь контуры из бинарной маски (0/1) ---
    // Возврат: один плоский массив [x0,y0,x1,y1,...] по всем внешним контурам
    // Один округлый внешний контур без дыр
    function outlineOffset(mask01, W, H, { offsetPx=8, closePx=0, epsilon=2.0 } = {}) {
        // 0/1 -> 0/255
        let src = cv.matFromArray(H, W, cv.CV_8UC1, mask01);
        let bin = new cv.Mat(); cv.threshold(src, bin, 0, 255, cv.THRESH_BINARY);

        const ell = (r) => cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size((r|0)||1, (r|0)||1));

        // оффсет наружу ≈ Минковский сумма с диском радиуса r
        if (offsetPx > 0) { const k = ell(offsetPx); cv.dilate(bin, bin, k); k.delete(); }

        // сгладить края, закрыть щели
        if (closePx > 0) { const k = ell(closePx); cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, k); k.delete(); }

        // только внешний контур
        const contours = new cv.MatVector(), hier = new cv.Mat();
        cv.findContours(bin, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        if (contours.size() === 0) { src.delete(); bin.delete(); contours.delete(); hier.delete(); return []; }

        // крупнейший контур
        let maxIdx = 0, maxArea = -1;
        for (let i=0;i<contours.size();i++){ const a=cv.contourArea(contours.get(i),false); if(a>maxArea){maxArea=a;maxIdx=i;} }

        const approx = new cv.Mat(); cv.approxPolyDP(contours.get(maxIdx), approx, Math.max(1e-3, epsilon), true);

        const data = approx.data32S; const out = new Array(data.length);
        for (let i=0;i<data.length;i++) out[i]=data[i];

        src.delete(); bin.delete(); contours.delete(); hier.delete(); approx.delete();
        return out; // [x0,y0,x1,y1,...] — один замкнутый внешний контур
    }

    async function sha1Hex(buf){
      const d = await crypto.subtle.digest('SHA-1', buf);
      const b = new Uint8Array(d); let h='';
      for(const v of b) h += v.toString(16).padStart(2,'0');
      return h.slice(0,12);
    }

    self.onmessage = async (e) => {
      const { type, data } = e.data;
      const [model, processor] = await Singleton.get();

      if(type === 'reset'){
        image_inputs = null; image_embeddings = null; cachedContours = null;
        self.postMessage({ type: 'reset_done' });
        return;
      }

      if(type === 'segment_all'){
          
        const time = Date.now();
        
        const {
          dataURL,
          gridStep=96,
          iouThreshold=0.9,
          simplifyTolerance=1.5,        // теперь это epsilon для approxPolyDP в пикселях
          minAreaPx=0
        } = data;

        cachedContours = null;

        // 1) Read and ensure 900x1200
        // const img = await RawImage.read(dataURL);
        
        // const img900 = await img.resize(900, 1200);
        // // 2) Precompute embeddings once
        // image_inputs = await processor(img900);
        
        const img = await RawImage.read(dataURL); 
        image_inputs = await processor(img); 
        
        image_embeddings = await model.get_image_embeddings(image_inputs);
        const reshaped = image_inputs.reshaped_input_sizes[0];
        const H = reshaped[0]|0, W = reshaped[1]|0;

        // 3) Iterate prompts on grid
        const prompts = buildGridPrompts(W, H, gridStep);
        const kept = []; // {mask, id}
        const byId = {};

        for(let i=0;i<prompts.length;i++){
          const pt = prompts[i];
          const input_points = new Tensor('float32', new Float32Array([pt[0], pt[1]]), [1,1,1,2]);
          const input_labels = new Tensor('int64', new BigInt64Array([1n]), [1,1,1]);

          const outputs = await model({ ...image_embeddings, input_points, input_labels });
          const t = (await processor.post_process_masks(
            outputs.pred_masks,
            image_inputs.original_sizes,
            image_inputs.reshaped_input_sizes
          ))[0][0];

          const [num, HH, WW] = t.dims;
          const stride = HH*WW;
          let best = 0; const scores = outputs.iou_scores.data;
          for(let k=1;k<scores.length;k++) if(scores[k]>scores[best]) best = k;

          const bin = thresholdMaskFloat(t.data.subarray(best*stride, (best+1)*stride), WW, HH, 0.7);
          if(minAreaPx && maskAreaPx(bin) < minAreaPx) continue;

          // dedup по IoU
          let dup = false;
          
          for(const m of kept){ if(iou(bin, m.mask) >= iouThreshold){ dup = true; break; } }
          
          if(dup) continue;

          // контуры через OpenCV.js
            const coords = outlineOffset(bin, WW, HH);
            
            if (!coords || coords.length < 6) continue;

          const id = await sha1Hex(bin.buffer);
          kept.push({ mask: bin, id });
          byId[id] = coords;
        }

        cachedContours = byId;
        self.postMessage({
          type: 'segment_all_done',
          data: { contours: byId, meta: { kept: Object.keys(byId).length, gridStep, dims:[W,H], iouThreshold, simplifyTolerance,time: Date.now() - time }, }
        });
        return;
      }

      if(type === 'get_all'){
        self.postMessage({ type: 'segment_all_done', data: { contours: cachedContours ?? {}, meta: {} } });
        return;
      }

      throw new Error('Unknown message type: '+type);
    }
  `;
    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    return new Worker(url, { type: 'module' });
}

// =============================================================
// Texel packing helpers (browser-only)
// =============================================================
export function fitTextureWH(pointPairs: number) {
    const w = Math.ceil(Math.sqrt(pointPairs))
    const h = Math.ceil(pointPairs / w)
    return { w, h }
}

export function imagedata_to_image(imagedata: ImageData) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    canvas.width = imagedata.width
    canvas.height = imagedata.height
    ctx.putImageData(imagedata, 0, 0)
    const image = new Image()
    image.src = canvas.toDataURL()
    return image
}

export function normalizeToCanvas(coords: Float32Array, canvasW = 900, canvasH = 1200) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    const out = new Float32Array(coords.length)
    for (let i = 0; i < coords.length; i += 2) {
        const xn = Math.min(1, Math.max(0, coords[i] / canvasW))
        const yn = Math.min(1, Math.max(0, coords[i + 1] / canvasH))
        out[i] = xn
        out[i + 1] = yn
        if (minX > xn) minX = xn
        if (maxX < xn) maxX = xn
        if (minY > yn) minY = yn
        if (maxY < yn) maxY = yn
    }
    return { out, minX, minY, maxX, maxY }
}

export function packRGBA8ImageData(normalized: Float32Array) {
    const nPairs = normalized.length / 2
    const { w, h } = fitTextureWH(nPairs)
    const imageData = new ImageData(w, h)
    const rgba = imageData.data
    for (let i = 0; i < nPairs; i++) {
        const xn = normalized[2 * i]
        const yn = normalized[2 * i + 1]
        const R = Math.max(0, Math.min(255, Math.round(xn * 255)))
        const G = Math.max(0, Math.min(255, Math.round(yn * 255)))
        const pi = i * 4
        rgba[pi + 0] = R
        rgba[pi + 1] = G
        rgba[pi + 2] = 0
        rgba[pi + 3] = 255
    }
    return { image: imagedata_to_image(imageData), w, h, count: nPairs }
}

export function buildTexelMapsFromContoursMap(map: ContourMap, canvasW = 900, canvasH = 1200): Record<string, SegmentTexel> {
    const out: Record<string, SegmentTexel> = {}

    for (const [id, arr] of Object.entries(map)) {
        if (!Array.isArray(arr) || arr.length < 6) continue
        const evenLen = arr.length & 1 ? arr.length - 1 : arr.length
        const coords = new Float32Array(evenLen)
        for (let i = 0; i < evenLen; i++) coords[i] = arr[i]
        const { out: pointsN, minX, minY, maxX, maxY } = normalizeToCanvas(coords, canvasW, canvasH)
        const { image, w, h, count } = packRGBA8ImageData(pointsN)

        out[id] = { id, image, w, h, count, aabbN: [minX, minY, maxX, maxY], pointsN }
    }
    return out
}

type ScalarKind = 'f32' | 'i32'

type VecKind = 'vec2<f32>' | 'vec3<f32>' | 'vec4<f32>'

type UniformKind = ScalarKind | VecKind

export type FieldDef =
    | {
    name: string
    label: string
    kind: ScalarKind
    default: number
    slider?: { min: number; max: number; step?: number }
    uniformName?: string
}
    | {
    name: string
    label: string
    kind: VecKind
    default: number[]
    slider?: { min: number; max: number; step?: number }
    uniformName?: string
}


export type PlaygroundConfig = {
    name: string,
    canvas: { width: number; height: number }
    shader: { vertex?: string; fragment: string }
    fields: FieldDef[]
    staticUniforms?: Record<string, { value: never; type: UniformKind }>
    backgroundSrc?: string // uDiffuse
    coords?: {
        json: number[] | Record<string, unknown>
        uniformNames?: {
            tex?: string // default uPointTexture
            dim?: string // default uPointTextureDim
            count?: string // default uPointTexelCount
            aabb?: string // default uPointAABB
        }
    }
}

// =============================================================
// React component: loads image, runs segment_all in worker, returns contours map
// and writes per-contour texel maps into a global registry and via callback
// =============================================================
export default function SamContoursReactAll({ onContoursMap, onTexelsMap, gridStep = 96, iouThreshold = 0.9, simplifyTolerance = 1, simplifyHighQuality = false, minAreaPx = 0,config }: Props){
    const [status, setStatus] = useState('Ready')

    const workerRef = useRef<Worker | null>(null)

    const [contours,setContours] = useState<Record<string, number[]> | null>(null)


    const [hoverId, setHoverId] = React.useState<string | null>(null);

    const { canvas: c, shader, fields, staticUniforms, name } = config

    useEffect(() => {
        const w = makeWorker()
        workerRef.current = w
        w.onmessage = (e: MessageEvent) => {
            const { type, data } = e.data as any

            if (type === 'reset_done') setStatus('Ready')

            if (type === 'segment_all_done') {
                setStatus('Done')


                const date = new Date(data.meta.time);


                console.log(`Segmented in: ${date.getMinutes()}:${date.getSeconds()}`)

                const contours = data.contours as Record<string, number[]>
                onContoursMap(contours)
                setContours(contours)
                // Build and publish texel maps
                const texels = buildTexelMapsFromContoursMap(contours, 900, 1200)

                ;(window as any).__SEGMENT_TEXELS__ = texels // simple registry as "система"

                onTexelsMap?.(texels)
            }
        }
        return () => { w.terminate(); workerRef.current = null }

    }, [onContoursMap, onTexelsMap])

    const handleFile = useCallback(async (f: File) => {
        const url = URL.createObjectURL(f)
        const img = new Image()
        img.onload = async () => {
            // Resample to 900x1200 for preview background
            const canvas = document.createElement('canvas')
            canvas.width = 900; canvas.height = 1200

            const ctx = canvas.getContext('2d')!

            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = 'high'

            ctx.drawImage(img, 0, 0, 900, 1200)
            const dataURL = canvas.toDataURL('image/png')

            //if (containerRef.current) containerRef.current.style.backgroundImage = `url(${dataURL})`

            setStatus('Segmenting…')

            workerRef.current!.postMessage({ type: 'segment_all', data: { dataURL, gridStep, iouThreshold, simplifyTolerance, simplifyHighQuality, minAreaPx } })

            if (!canvasRef.current) return

            const app = new Application()

            await app.init({
                width: c.width,
                height: c.height,
                preference: 'webgl',
                preferWebGLVersion: 2,
                background: 0x0b0e14,
                backgroundAlpha: 1,
                antialias: false,
                view: canvasRef.current,
            });

            (window as Window)[`__PIXI_APP__${name}`] = app

            const tex = Texture.from(canvas) // WebGL-текстура из готового canvas

            const sprite = new Sprite(tex)

            sprite.width = 900
            sprite.height = 1200

            if (app?.stage) app.stage.addChild(sprite)

            // full-quad geometry
            const geometry = new Geometry({
                attributes: {
                    aPosition: [0, 0, c.width, 0, c.width, c.height, 0, c.height],
                    aUV: [0, 0, 1, 0, 1, 1, 0, 1],
                },
                indexBuffer: [0, 1, 2, 0, 2, 3],
            })

            // build uniforms
            const uEntries: Record<string, { value: any; type: UniformKind }> = {
                uTime: { value: 0, type: 'f32' },
                uPointTextureDim: { value: [0, 0], type: 'vec2<f32>' },
                uPointTexelCount: { value: 0, type: 'i32' },
                uPointAABB: {value: [0,0,0,0], type: 'vec4<f32>',},
                uResolution: { value: [c.width, c.height], type: 'vec2<f32>' },
                ...(staticUniforms ?? {}),
            }

            // fields → uniforms
            for (const f of fields) {
                const name = f.uniformName ?? f.name
                uEntries[name] = { value: f.default as any, type: f.kind }
            }

            const uniforms = new UniformGroup(uEntries, { isStatic: false })

            const resources: any = { uniforms, uPointTexture: Texture.WHITE.source }

            const sh = Shader.from({
                gl: { vertex: shader.vertex || DEFAULT_VERTEX, fragment: shader.fragment },
                resources,
            })

            uniformsRef.current = sh.resources.uniforms as UniformGroup

            const mesh = new Mesh({ geometry, shader: sh })

            app.stage.addChild(mesh)

            // time
            let t = 0

            app.ticker.add((tk) => {

                t += tk.deltaMS / 1000
                uniforms.uniforms.uTime = t
            })

        }

        img.src = url

    }, [gridStep, iouThreshold, simplifyTolerance, simplifyHighQuality, minAreaPx, c.width, c.height, name, staticUniforms, shader.vertex, shader.fragment, fields])

    const onMove = React.useCallback(async (e: React.MouseEvent<HTMLCanvasElement>) => {
        const el = canvasRef.current!;

        const { x, y } = getCanvasPoint(e.nativeEvent, el, 900, 1200);

        function polygonAreaPx(poly: number[]): number {
            let s = 0;
            const n = poly.length;
            let xj = poly[n - 2], yj = poly[n - 1];
            for (let i = 0; i < n; i += 2) {
                const xi = poly[i], yi = poly[i + 1];
                s += xj * yi - xi * yj;
                xj = xi; yj = yi;
            }
            return Math.abs(s) * 0.5;
        }

        function buildOrderedIdsByArea(segments: ContourMap): string[] {
            const tmp: { id: string; area: number }[] = [];

            for (const [id, poly] of Object.entries(segments)) {
                if (!poly || poly.length < 6) continue;
                tmp.push({ id, area: polygonAreaPx(poly) });
            }

            tmp.sort((a, b) => a.area - b.area); // asc

            return tmp.map(v => v.id);
        }

        if (contours){
            const id = findSegmentIdAtPoint(contours, x, y, buildOrderedIdsByArea(contours));

            setHoverId(id);

            if(window[`__PIXI_APP__${name}`]?.stage?.children.length === 2){

                console.log('applyTexels 1', id)

                const r = (window[`__PIXI_APP__${name}`]?.stage?.children?.[1] as Mesh<Geometry,Shader>)?.shader
                    ?.resources

                const u = r.uniforms as UniformGroup | undefined

                if(id){
                    const segmentTexel = ((window as any).__SEGMENT_TEXELS__[id] as SegmentTexel);

                    u.uniforms.uPointTextureDim  = [segmentTexel.w, segmentTexel.h];
                    u.uniforms.uPointTexelCount  = segmentTexel.count | 0;
                    u.uniforms.uPointAABB        = segmentTexel.aabbN;


                    const tex = await Assets.load(((window as any).__SEGMENT_TEXELS__[id] as SegmentTexel).image);

                    (window[`__PIXI_APP__${name}`]?.stage?.children?.[1] as Mesh<Geometry,Shader>).shader.resources['uPointTexture'] = tex.source

                }
            }
        }



    }, [contours, name]);

    const canvasRef = useRef<HTMLCanvasElement>(null)

    const uniformsRef = useRef<UniformGroup | null>(null)

    type Values = Record<string, never>

    const initialValues: Values = useMemo(() => {
        const o: Values = {}
        for (const f of fields) o[f.name] = f.default as never
        return o
    }, [fields])

    // apply uniforms from form
    function applyUniforms(values: Record<string, any>) {
        const u = (window[`__PIXI_APP__${name}`]?.stage?.children?.[1] as Mesh<Geometry,Shader>)?.shader
            ?.resources.uniforms as UniformGroup | undefined

        if (!u) return

        for (const f of fields) {
            const name = f.uniformName ?? f.name
            const v = values[f.name]
            if (v == null) continue
            if (f.kind === 'i32') u.uniforms[name] = Math.trunc(toNum(v))
            else u.uniforms[name] = v
        }
    }

    // UI styles
    const rowStyle: React.CSSProperties = {
        display: 'grid',
        gridTemplateColumns: '200px 1fr 88px',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
    }
    const labelStyle: React.CSSProperties = { fontSize: 12, color: '#9aa4b2' }

    function VecInputs({
                           name,
                           kind,
                           slider,
                       }: {
        name: string
        kind: VecKind
        slider?: { min: number; max: number; step?: number }
    }) {
        const n = kind === 'vec2<f32>' ? 2 : kind === 'vec3<f32>' ? 3 : 4
        return (
            <Field<any> name={name}>
                {({ input }) => {
                    const arr: number[] = Array.isArray(input.value) ? input.value.slice() : new Array(n).fill(0)
                    return (
                        <>
                            <div style={{ gridColumn: '2 / span 2', display: 'grid', gridTemplateColumns: `repeat(${n}, 1fr)`, gap: 6 }}>
                                {arr.map((val, i) => (
                                    <input
                                        key={i}
                                        type="number"
                                        value={val ?? 0}
                                        step={slider?.step ?? 0.01}
                                        onChange={(e) => {
                                            const next = arr.slice()
                                            next[i] = toNum(e.target.value)
                                            input.onChange(next)
                                        }}
                                    />
                                ))}
                            </div>
                            {slider && (
                                <div style={{ gridColumn: '2 / span 2', display: 'grid', gridTemplateColumns: `repeat(${n}, 1fr)`, gap: 6 }}>
                                    {arr.map((val, i) => (
                                        <input
                                            key={i}
                                            type="range"
                                            min={slider.min}
                                            max={slider.max}
                                            step={slider.step ?? 0.01}
                                            value={val ?? 0}
                                            onChange={(e) => {
                                                const next = arr.slice()
                                                next[i] = toNum(e.target.value)
                                                input.onChange(next)
                                            }}
                                        />
                                    ))}
                                </div>
                            )}
                        </>
                    )
                }}
            </Field>
        )
    }


    return (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center',width:'100%',paddingTop: '16px' }}>
            <div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
                <button type="button" onClick={() => workerRef.current?.postMessage({ type: 'reset' })}>Сбросить</button>
                <span>{status}</span>
            </div>

            <div>hover: {hoverId ?? 'none'}</div>
            <canvas ref={canvasRef} style={{ width: 900, height: 1200, inset: 0,border: '1px solid white' }} onMouseMove={onMove}/>

            </div>

            <div
                style={{
                    background: '#383838',
                    border: '1px solid #222a36',
                    minWidth: '852px',
                    height: '100',
                    borderRadius: 12,
                    padding: "0 24px",
                    overflowY:'auto',
                    top: 12,
                }}
            >
                <h3 style={{ margin: 0, marginBottom: 8, color: '#cbd5e1' }}>Юниформы</h3>

                <Form<Values>
                    onSubmit={() => {}}
                    initialValues={initialValues}
                    render={({ handleSubmit }) => (
                        <form onSubmit={handleSubmit}>
                            <FormSpy subscription={{ values: true }} onChange={({ values }) => applyUniforms(values as Values)} />

                            {fields.map((f) => (
                                <div key={f.name} style={{ marginBottom: 12 }}>
                                    <div style={{ height: 1, background: '#1f2733', margin: '12px 0' }} />
                                    <div style={rowStyle}>
                                        <div style={labelStyle}>{f.label}</div>

                                        {(f.kind === 'f32' || f.kind === 'i32') && (
                                            <Field<number> name={f.name} parse={toNum}>
                                                {({ input }) => (
                                                    <>
                                                        {f.slider ? (
                                                            <input
                                                                type="range"
                                                                min={f.slider.min}
                                                                max={f.slider.max}
                                                                step={f.slider.step ?? (f.kind === 'i32' ? 1 : 0.01)}
                                                                value={input.value ?? 0}
                                                                onChange={(e) => input.onChange(e.target.value)}
                                                            />
                                                        ) : (
                                                            <div />
                                                        )}
                                                        <input
                                                            type="number"
                                                            min={f.slider?.min}
                                                            max={f.slider?.max}
                                                            step={f.slider?.step ?? (f.kind === 'i32' ? 1 : 0.01)}
                                                            value={input.value ?? 0}
                                                            onChange={(e) => input.onChange(e.target.value)}
                                                        />
                                                    </>
                                                )}
                                            </Field>
                                        )}

                                        {(f.kind === 'vec2<f32>' || f.kind === 'vec3<f32>' || f.kind === 'vec4<f32>') && (
                                            <VecInputs name={f.name} kind={f.kind} slider={f.slider} />
                                        )}
                                    </div>
                                </div>
                            ))}
                        </form>
                    )}
                />
            </div>
        </div>
    )
}
