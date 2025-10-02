import React, { useEffect, useRef, useState, useCallback } from 'react'
// npm i @xenova/transformers d3-contour simplify-js
import type { CSSProperties } from 'react'

export type FlatPolygon = number[] // [x0,y0,x1,y1,...]
export type ContourMap = Record<string, FlatPolygon>

export type Props = {
    className?: string
    style?: CSSProperties
    onContoursMap: (map: ContourMap) => void
    gridStep?: number // px between prompt points
    iouThreshold?: number // 0..1 for dedup
    simplifyTolerance?: number // px
    simplifyHighQuality?: boolean
    minAreaPx?: number // drop tiny masks by area in px
}

// =============================================================
// Inline module worker that mirrors HF demo but computes ALL contours and caches
// =============================================================
function makeWorker() {
    const code = `
    import { env, SamModel, AutoProcessor, RawImage, Tensor } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.14.0';
    import { contours as d3Contours } from 'https://cdn.jsdelivr.net/npm/d3-contour@3/+esm';
    import simplify from 'https://cdn.jsdelivr.net/npm/simplify-js@1.2.4/+esm';

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

    function contoursFromMask(mask01, W, H, tol, hq){
      const gen = d3Contours().size([W, H]).smooth(false);
      const multi = gen.contour(mask01, 0.5); // MultiPolygon
      const out = [];
      for(const polygon of multi.coordinates){
        for(const ring of polygon){
          const pts = ring.map(([x,y])=>({x,y}));
          const simp = simplify(pts, tol, hq);
          if(simp.length<3) continue;
          for(const p of simp){ out.push(Math.round(p.x), Math.round(p.y)); }
        }
      }
      return out; // flattened, rings concatenated; consumer can use even-odd rule
    }

    async function sha1Hex(buf){
      const d = await crypto.subtle.digest('SHA-1', buf);
      const b = new Uint8Array(d); let h='';
      for(const v of b) h += v.toString(16).padStart(2,'0');
      return h.slice(0,12); // short id like "abb9edd6be4a"
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
        const { dataURL, gridStep=96, iouThreshold=0.9, simplifyTolerance=1.5, simplifyHighQuality=false, minAreaPx=0 } = data;
        cachedContours = null;
        // 1) Read and ensure 900x1200
        const img = await RawImage.read(dataURL);
        const img900 = await img.resize(900, 1200);
        // 2) Precompute embeddings once
        image_inputs = await processor(img900);
        image_embeddings = await model.get_image_embeddings(image_inputs);
        const reshaped = image_inputs.reshaped_input_sizes[0];
        const H = reshaped[0]|0, W = reshaped[1]|0;
        // 3) Iterate prompts on grid
        const prompts = buildGridPrompts(W, H, gridStep);
        const kept = [];// {mask, id}
        const byId = {};

        for(let i=0;i<prompts.length;i++){
          const pt = prompts[i];
          const input_points = new Tensor('float32', new Float32Array([pt[0], pt[1]]), [1,1,1,2]);
          const input_labels = new Tensor('int64', new BigInt64Array([1n]), [1,1,1]);
          const outputs = await model({ ...image_embeddings, input_points, input_labels });
          const t = (await processor.post_process_masks(outputs.pred_masks, image_inputs.original_sizes, image_inputs.reshaped_input_sizes))[0][0];
          // pick best index
          const [num, HH, WW] = t.dims;
          const stride = HH*WW;
          let best = 0; const scores = outputs.iou_scores.data;
          for(let k=1;k<scores.length;k++) if(scores[k]>scores[best]) best = k;
          const bin = thresholdMaskFloat(t.data.subarray(best*stride, (best+1)*stride), WW, HH, 0.5);
          if(minAreaPx && maskAreaPx(bin) < minAreaPx) continue;
          // dedup
          let dup = false;
          for(const m of kept){ if(iou(bin, m.mask) >= iouThreshold){ dup = true; break; } }
          if(dup) continue;
          // contours and id
          const coords = contoursFromMask(bin, WW, HH, simplifyTolerance, simplifyHighQuality);
          if(coords.length<6) continue;
          const id = await sha1Hex(bin.buffer);
          kept.push({ mask: bin, id });
          byId[id] = coords;
        }
        cachedContours = byId;
        self.postMessage({ type: 'segment_all_done', data: { contours: byId, meta: { kept: Object.keys(byId).length, gridStep, dims:[W,H], iouThreshold, simplifyTolerance } } });
        return;
      }

      if(type === 'get_all'){
        self.postMessage({ type: 'segment_all_done', data: { contours: cachedContours ?? {}, meta: {} } });
        return;
      }

      // Fallback to demo-like single decode for hover clicks
      if(type === 'decode'){
        const reshaped = image_inputs.reshaped_input_sizes[0];
        const points = data.points.map(x => [x.point[0] * reshaped[1], x.point[1] * reshaped[0]]);
        const labels = data.points.map(x => BigInt(x.label));
        const input_points = new Tensor('float32', new Float32Array(points.flat()), [1,1,points.length,2]);
        const input_labels = new Tensor('int64', new BigInt64Array(labels), [1,1,labels.length]);
        const outputs = await model({ ...image_embeddings, input_points, input_labels });
        const masks = await processor.post_process_masks(outputs.pred_masks, image_inputs.original_sizes, image_inputs.reshaped_input_sizes);
        const t = masks[0][0]; const [num,H,W]=t.dims; const stride=H*W; let best=0; const s=outputs.iou_scores.data; for(let k=1;k<s.length;k++) if(s[k]>s[best]) best=k;
        const bin = thresholdMaskFloat(t.data.subarray(best*stride,(best+1)*stride), W, H, 0.5);
        const coords = contoursFromMask(bin, W, H, 1.5, false);
        self.postMessage({ type: 'decode_result', data: { width: W, height: H, mask: bin, coords } }, [bin.buffer]);
        return;
      }

      throw new Error('Unknown message type: '+type);
    }
  `
    const blob = new Blob([code], { type: 'text/javascript' })
    const url = URL.createObjectURL(blob)
    return new Worker(url, { type: 'module' })
}

// =============================================================
// React component: loads image, runs segment_all in worker, returns contours map
// =============================================================
export default function SamContoursReactAll({ className, style, onContoursMap, gridStep = 96, iouThreshold = 0.9, simplifyTolerance = 1.5, simplifyHighQuality = false, minAreaPx = 0 }: Props){
    const [status, setStatus] = useState('Ready')
    const workerRef = useRef<Worker | null>(null)
    const containerRef = useRef<HTMLDivElement | null>(null)
    const maskCanvasRef = useRef<HTMLCanvasElement | null>(null)

    useEffect(() => {
        const w = makeWorker()
        workerRef.current = w
        w.onmessage = (e: MessageEvent) => {
            const { type, data } = e.data as any
            if (type === 'reset_done') setStatus('Ready')
            if (type === 'segment_all_done') {
                setStatus('Done')
                // optional quick viz: draw nothing; user consumes contours map
                onContoursMap(data.contours as Record<string, number[]>)
            }
        }
        return () => { w.terminate(); workerRef.current = null }
    }, [onContoursMap])

    const handleFile = useCallback(async (f: File) => {
        const url = URL.createObjectURL(f)
        const img = new Image()
        img.onload = () => {
            // Resample to 900x1200 for preview background
            const canvas = document.createElement('canvas')
            canvas.width = 900; canvas.height = 1200
            const ctx = canvas.getContext('2d')!
            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = 'high'
            ctx.drawImage(img, 0, 0, 900, 1200)
            const dataURL = canvas.toDataURL('image/png')
            if (containerRef.current) containerRef.current.style.backgroundImage = `url(${dataURL})`
            setStatus('Segmenting…')
            workerRef.current!.postMessage({ type: 'segment_all', data: { dataURL, gridStep, iouThreshold, simplifyTolerance, simplifyHighQuality, minAreaPx } })
        }
        img.src = url
    }, [gridStep, iouThreshold, simplifyTolerance, simplifyHighQuality, minAreaPx])

    return (
        <div className={className} style={style}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
                <button type="button" onClick={() => workerRef.current?.postMessage({ type: 'reset' })}>Сбросить</button>
                <span>{status}</span>
            </div>
            <div
                ref={containerRef}
                style={{ width: 900, height: 1200, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', position: 'relative', border: '1px solid #333', userSelect: 'none' }}
            >
                <canvas ref={maskCanvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
            </div>
        </div>
    )
}

// =============================================================
// Usage
// =============================================================
/**
 import SamContoursReactAll from './SegmentAllSAM'

 export default function Demo(){
 return (
 <SamContoursReactAll
 gridStep={96}
 iouThreshold={0.9}
 simplifyTolerance={1.5}
 minAreaPx={200}
 onContoursMap={(m) => {
 // m: { [id: string]: number[] }
 console.log('contours', m)
 }}
 />
 )
 }
 */
