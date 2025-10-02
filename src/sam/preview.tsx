import {useEffect, useRef, useState, useCallback, useMemo} from 'react'

import {SinglePreview} from "./single-preview.tsx";

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
    gridStep?: number // px between prompt points
    iouThreshold?: number // 0..1 for dedup
    simplifyTolerance?: number // px
    simplifyHighQuality?: boolean
    minAreaPx?: number
    configs: Record<string,PlaygroundConfig>
    defaultConfig: string;
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

export default function MultiPreview({
                                         gridStep = 96,
                                         iouThreshold = 0.9,
                                         simplifyTolerance = 1,
                                         simplifyHighQuality = false,
                                         minAreaPx = 0,
                                         configs,
                                         defaultConfig,
                                     }: Props) {
    const [status, setStatus] = useState('Ready');
    const [currentConfig, setCurrentConfig] = useState<string>(defaultConfig);
    const workerRef = useRef<Worker | null>(null);
    const [contours, setContours] = useState<Record<string, number[]> | null>(null);
    const [texels, setTexels] = useState<Record<string, SegmentTexel> | null>(null);
    const [image, setImage] = useState<string | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const inputRef = useRef<HTMLInputElement>(null)

    // ключи доступных конфигов
    const configKeys = useMemo(() => Object.keys(configs || {}), [configs]);

    useEffect(() => {
        const w = makeWorker();
        workerRef.current = w;
        w.onmessage = (e: MessageEvent) => {
            const { type, data } = e.data as any;
            if (type === 'reset_done') setStatus('Ready');
            if (type === 'segment_all_done') {
                setStatus('Done');
                const date = new Date(data.meta.time);
                console.log(`Segmented in: ${date.getMinutes()}:${date.getSeconds()}`);
                const contours = data.contours as Record<string, number[]>;
                setContours(contours);
                setTexels(buildTexelMapsFromContoursMap(contours, 900, 1200));
            }
        };
        return () => {
            w.terminate();
            workerRef.current = null;
        };
    }, []);

    const handleFile = useCallback(
        async (f: File) => {
            const url = URL.createObjectURL(f);
            const img = new Image();
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                canvas.width = 900;
                canvas.height = 1200;
                const ctx = canvas.getContext('2d')!;
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, 900, 1200);
                const dataURL = canvas.toDataURL('image/png');

                setStatus('Segmenting…');
                workerRef.current!.postMessage({
                    type: 'segment_all',
                    data: { dataURL, gridStep, iouThreshold, simplifyTolerance, simplifyHighQuality, minAreaPx },
                });

                setImage(dataURL);
                if (!canvasRef.current) return;
            };
            img.src = url;
        },
        [gridStep, iouThreshold, simplifyTolerance, simplifyHighQuality, minAreaPx],
    );

    return (
        <div style={{width: '100vw',height:"100vh", display: 'flex', flexDirection: 'column'}}>
            <div style={{margin: '32px' }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center',padding: '16px' }}>
                    <input
                        type="file"
                        accept="image/*"
                        ref={inputRef}
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleFile(f);
                        }}
                        style={{ display: 'none' }}
                    />
                    <button   onClick={() => inputRef.current?.click()}>Выбрать фото</button>
                    {/*<button type="button" onClick={() => workerRef.current?.postMessage({ type: 'reset' })}>*/}
                    {/*    Сбросить*/}
                    {/*</button>*/}

                    <label>
                        <select
                            value={currentConfig}
                            onChange={(e) => setCurrentConfig(e.target.value)}
                            disabled={!configKeys.length}

                        >
                            {configKeys.map((k) => (
                                <option key={k} value={k}>
                                    {k}
                                </option>
                            ))}
                        </select>
                    </label>

                    <div style={{fontSize: '32px',display: "flex",alignItems: 'center'}}>{status}</div>
                </div>
            </div>

            <div style={{ display: 'flex',flexDirection: "column", gap: 12, alignItems: 'center', marginBottom: 8 }} key={currentConfig}>
                {Object.keys(texels || {}).length > 0 &&
                    image &&
                    configs?.[currentConfig] && (
                        <SinglePreview
                            config={{
                                ...configs[currentConfig],
                                texels: texels || {},
                                contours: contours || {},
                                backgroundSrc: image,
                            }}
                        />
                    )}
            </div>
        </div>
    );
}
