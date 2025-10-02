import { useEffect, useRef, useState } from 'react'
import './App.css'
import {
    Application,
    Assets,
    Sprite,
    Mesh,
    Geometry,
    Shader,
    UniformGroup,
    Texture,
} from 'pixi.js'
import contourPoints from './assets/img_contour.json' // JSON из SAM2
import imgUrl from './assets/img.png'

import vertex from './shaders/vertex.glsl.ts'

declare global {
    interface Window {
        __PIXI_APP__?: Application
    }
}

// Значения по умолчанию для юниформов
const DEF_FILL   = [0.9, 0.7, 0.4, 1.0]
const DEF_HLCOL  = [0.3, 0.3, 0.3, 0.3]
const DEF_HLW    = 36
const DEF_HLS    = 30
const DEF_HLO    = 0
const DEF_HLDIR  = [0.5, 0.5]
const DEF_DECAY = 0.045;
const DEF_SOFT  = 0.12;
const DEF_EDGE  = 3;   // px

const DEF_COLOR_AMOUNT = 1.0
const DEF_COLOR_STRIDE = 0.22
const DEF_COLOR_OFFSET = 0.0
const DEF_PA = [0.5, 0.5, 0.5] as const
const DEF_PB = [0.5, 0.5, 0.5] as const
const DEF_PC = [1.0, 1.0, 1.0] as const
const DEF_PD = [0.0, 0.33, 0.67] as const

// Утилиты для цветов
function rgb01ToHex(r: number, g: number, b: number) {
    const to255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)))
    return `#${[to255(r), to255(g), to255(b)]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')}`
}
function hexToRgb01(hex: string) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    const x = (s: string) => parseInt(s, 16) / 255
    return m ? { r: x(m[1]), g: x(m[2]), b: x(m[3]) } : { r: 1, g: 1, b: 1 }
}

function App() {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const uniformsRef = useRef<UniformGroup | null>(null)

    // React‑состояния для юниформов
    const [fillHex, setFillHex] = useState(
        rgb01ToHex(DEF_FILL[0], DEF_FILL[1], DEF_FILL[2])
    )
    const [fillA, setFillA] = useState(DEF_FILL[3])

    const [hlWidth, setHlWidth] = useState(DEF_HLW)
    const [hlSpeed, setHlSpeed] = useState(DEF_HLS)

    const [noiseAmpPx, setNoiseAmpPx] = useState(40)
    const [noiseScale, setNoiseScale] = useState(40)
    const [noiseSpeed, setNoiseSpeed] = useState(1)

    const [decay, setDecay] = useState(DEF_DECAY);
    const [soft, setSoft] = useState(DEF_SOFT);
    const [edgeFeather, setEdgeFeather] = useState(DEF_EDGE);

    const [colorAmount, setColorAmount] = useState(DEF_COLOR_AMOUNT)
    const [colorStride, setColorStride] = useState(DEF_COLOR_STRIDE)
    const [colorOffset, setColorOffset] = useState(DEF_COLOR_OFFSET)

    const [pa, setPA] = useState<[number,number,number]>([...DEF_PA])
    const [pb, setPB] = useState<[number,number,number]>([...DEF_PB])
    const [pc, setPC] = useState<[number,number,number]>([...DEF_PC])
    const [pd, setPD] = useState<[number,number,number]>([...DEF_PD])

    useEffect(() => {
        const init = async () => {
            if (!canvasRef.current) return

            const app = new Application()
            await app.init({
                width: 900,
                height: 1200,
                preference: 'webgl',
                backgroundAlpha: 1,
                preferWebGLVersion: 2,
                background: 0x0b0e14,
                antialias: true,
                view: canvasRef.current,
            })

            window.__PIXI_APP__ = app

            // Загружаем текстуру фотографии
            const texture = await Assets.load(imgUrl)

            // Спрайт на весь экран
            const sprite = new Sprite(texture)
            sprite.width = app.view.width
            sprite.height = app.view.height
            app.stage.addChild(sprite)

            const geometry = new Geometry({
                attributes: {
                    aPosition: [
                        ...[0, 0],
                        ...[900, 0],
                        ...[900, 1200],
                        ...[0, 1200],
                    ],
                    aUV: [...[0, 0], ...[1, 0], ...[1, 1], ...[0, 1]],
                },
                indexBuffer: [...[0, 1, 2], ...[0, 2, 3]],
            })

            type Coords = Float32Array

            function loadCoordsJson(): Coords {
                const json = contourPoints as unknown
                let arr: number[] | undefined
                if (Array.isArray(contourPoints)) {
                    arr = json as number[]
                } else if (json && typeof json === 'object') {
                    for (const v of Object.values(json as Record<string, unknown>)) {
                        if (Array.isArray(v) && v.every((n) => typeof n === 'number')) {
                            arr = v as number[]
                            break
                        }
                    }
                }
                if (!arr) throw new Error('JSON does not contain a numeric array')
                if (arr.length % 2 !== 0) arr = arr.slice(0, arr.length - 1)
                return new Float32Array(arr)
            }

            function normalizeToCanvas(
                coords: Coords,
                canvasW = 900,
                canvasH = 1200
            ) {
                let minX = Infinity
                let minY = Infinity
                let maxX = -Infinity
                let maxY = -Infinity

                const out = new Float32Array(coords.length)

                for (let i = 0; i < coords.length; i += 2) {
                    const xn = coords[i] / canvasW
                    const yn = coords[i + 1] / canvasH

                    out[i] = Math.min(1, Math.max(0, xn))
                    out[i + 1] = Math.min(1, Math.max(0, yn))

                    if (minX > out[i]) minX = out[i]
                    if (maxX < out[i]) maxX = out[i]
                    if (minY > out[i + 1]) minY = out[i + 1]
                    if (maxY < out[i + 1]) maxY = out[i + 1]
                }
                return { out, minX, minY, maxX, maxY }
            }

            function fitTextureWH(pointCount: number): { w: number; h: number } {
                const w = Math.ceil(Math.sqrt(pointCount))
                const h = Math.ceil(pointCount / w)
                return { w, h }
            }

            function imagedata_to_image(imagedata: ImageData) {
                const canvas = document.createElement('canvas')
                const ctx = canvas.getContext('2d')!
                canvas.width = imagedata.width
                canvas.height = imagedata.height
                ctx.putImageData(imagedata, 0, 0)
                const image = new Image()
                image.src = canvas.toDataURL()
                return image
            }

            function packRGBA8ImageData(normalized: Float32Array) {
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

            async function buildCoordsTexture(canvasW = 900, canvasH = 1200) {
                const coords = loadCoordsJson()
                const {
                    out: normalized,
                    minX,
                    minY,
                    maxX,
                    maxY,
                } = normalizeToCanvas(coords, canvasW, canvasH)
                const { image, w, h, count } = packRGBA8ImageData(normalized)
                const tex = await Assets.load<Texture>(image)
                return { tex, w, h, count, minX, minY, maxX, maxY }
            }

            const { tex, w, h, count, minX, minY, maxX, maxY } =
                await buildCoordsTexture()

            // Создаём UniformGroup
            const uniforms = new UniformGroup({
                uResolution: { value: [900, 1200], type: 'vec2<f32>' },
                uPointTextureDim: { value: [w, h], type: 'vec2<f32>' },
                uPointTexelCount: { value: count, type: 'i32' },
                uPointAABB: { value: [minX, minY, maxX, maxY], type: 'vec4<f32>' },
                uFillColor: { value: [...DEF_FILL], type: 'vec4<f32>' },
                uHLColor: { value: [...DEF_HLCOL], type: 'vec4<f32>' },
                uHLWidth: { value: DEF_HLW, type: 'f32' },
                uHLSpeed: { value: DEF_HLS, type: 'f32' },
                uHLOffset: { value: DEF_HLO, type: 'f32' },
                hlLength: { value: DEF_HLO, type: 'f32' },
                uHLDir: { value: [...DEF_HLDIR], type: 'vec2<f32>' },
                uTime: { value: 0, type: 'f32' },

                uNoiseAmpPx: {value: 40, type: 'f32'},
                uNoiseScale: {value: 40, type: 'f32'},
                uNoiseSpeed: {value: 1, type: 'f32'},

                uDecay:         { value: DEF_DECAY, type: 'f32' },
                uSoft:          { value: DEF_SOFT,  type: 'f32' },
                uEdgeFeatherPx: { value: DEF_EDGE,  type: 'f32' },

                uColorAmount: { value: DEF_COLOR_AMOUNT, type: 'f32' },
                uColorStride: { value: DEF_COLOR_STRIDE, type: 'f32' },
                uColorOffset: { value: DEF_COLOR_OFFSET, type: 'f32' },
                uPA: { value: [...DEF_PA], type: 'vec3<f32>' },
                uPB: { value: [...DEF_PB], type: 'vec3<f32>' },
                uPC: { value: [...DEF_PC], type: 'vec3<f32>' },
                uPD: { value: [...DEF_PD], type: 'vec3<f32>' },

            }, { isStatic: false })

            const shader = Shader.from({
                gl: { vertex: vertex, fragment: frag },
                resources: {
                    uPointTexture: tex.source,
                    uniforms,
                },
            })

            uniformsRef.current = shader.resources.uniforms as UniformGroup

            const mesh = new Mesh({ geometry, shader })

            app.stage.addChild(mesh)

            uniformsRef.current = (window.__PIXI_APP__?.stage.children[1] as Mesh<Geometry,Shader>).shader!.resources.uniforms


            let t = 0

            app.ticker.add((tk) => {
                t = t + tk.deltaMS / 1000
                uniforms.uniforms.uTime = t

            })

            // Очистка
            return () => {
                app.destroy(true)
                if (window.__PIXI_APP__ === app) delete window.__PIXI_APP__
            }
        }

        let cleanup: (() => void) | undefined

        init().then((c) => {
            cleanup = c
        })

        return () => cleanup?.()
    }, [])


    useEffect(() => {
        const uniforms = uniformsRef.current; if (!uniforms) return;

        const { r, g, b } = hexToRgb01(fillHex);

        uniforms.uniforms.uFillColor = [r,g,b,fillA];

    }, [fillHex, fillA]);

    useEffect(() => {
        const uniforms = uniformsRef.current; if (!uniforms) return;
        uniforms.uniforms.uHLWidth = hlWidth;
    }, [hlWidth]);

    useEffect(() => {
        const uniforms = uniformsRef.current; if (!uniforms) return;
        uniforms.uniforms.uHLSpeed = hlSpeed;
    }, [hlSpeed]);


    useEffect(() => {
        const uniforms = uniformsRef.current; if (!uniforms) return;
        uniforms.uniforms.uNoiseAmpPx = noiseAmpPx;
    }, [noiseAmpPx]);

    useEffect(() => {
        const uniforms = uniformsRef.current; if (!uniforms) return;
        uniforms.uniforms.uNoiseScale = noiseScale;
    }, [noiseScale]);

    useEffect(() => {
        const uniforms = uniformsRef.current; if (!uniforms) return;
        uniforms.uniforms.uNoiseSpeed = noiseSpeed;
    }, [noiseSpeed]);

    useEffect(() => {
        const u = uniformsRef.current; if (!u) return;
        u.uniforms.uDecay = decay;
    }, [decay]);

    useEffect(() => {
        const u = uniformsRef.current; if (!u) return;
        u.uniforms.uSoft = soft;
    }, [soft]);

    useEffect(() => {
        const u = uniformsRef.current; if (!u) return;
        u.uniforms.uEdgeFeatherPx = edgeFeather;
    }, [edgeFeather]);

    useEffect(()=>{ const u=uniformsRef.current; if(!u) return; u.uniforms.uColorAmount = colorAmount },[colorAmount])
    useEffect(()=>{ const u=uniformsRef.current; if(!u) return; u.uniforms.uColorStride = colorStride },[colorStride])
    useEffect(()=>{ const u=uniformsRef.current; if(!u) return; u.uniforms.uColorOffset = colorOffset },[colorOffset])

    useEffect(()=>{ const u=uniformsRef.current; if(!u) return; u.uniforms.uPA = pa },[pa])
    useEffect(()=>{ const u=uniformsRef.current; if(!u) return; u.uniforms.uPB = pb },[pb])
    useEffect(()=>{ const u=uniformsRef.current; if(!u) return; u.uniforms.uPC = pc },[pc])
    useEffect(()=>{ const u=uniformsRef.current; if(!u) return; u.uniforms.uPD = pd },[pd])


    // UI элементы управления
    const rowStyle: React.CSSProperties = {
        display: 'grid',
        gridTemplateColumns: '160px 1fr 80px',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '8px',
    }
    const labelStyle: React.CSSProperties = { fontSize: 12, color: '#9aa4b2' }

    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: '700px 1fr',
                gap: 16,
                alignItems: 'start',
            }}
        >
            <div
                style={{
                    background: '#383838',
                    border: '1px solid #222a36',
                    width: '600px',
                    borderRadius: 12,
                    padding: 12,
                    position: 'sticky',
                    top: 12,
                    maxHeight: 'calc(100vh - 24px)',
                    overflow: 'auto',
                }}
            >
                <h3 style={{ margin: 0, marginBottom: 8, color: '#cbd5e1' }}>Юниформы</h3>

                {/* FILL */}
                <div style={rowStyle}>
                    <div style={labelStyle}>Заливка RGB</div>
                    <input
                        type="color"
                        value={fillHex}
                        onChange={(e) => setFillHex(e.target.value)}
                        style={{ width: '100%' }}
                    />
                    <div />
                </div>
                <div style={rowStyle}>
                    <div style={labelStyle}>Заливка A</div>
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={fillA}
                        onChange={(e) => setFillA(parseFloat(e.target.value))}
                    />
                    <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={fillA}
                        onChange={(e) => setFillA(parseFloat(e.target.value))}
                    />
                </div>

                {/* HL params */}
                <div style={{ height: 1, background: '#1f2733', margin: '12px 0' }} />

                <div style={rowStyle}>
                    <div style={labelStyle}>Ширина блика (px)</div>
                    <input
                        type="range"
                        min={0}
                        max={200}
                        step={1}
                        value={hlWidth}
                        onChange={(e) => setHlWidth(parseFloat(e.target.value))}
                    />
                    <input
                        type="number"
                        min={0}
                        max={9999}
                        step={1}
                        value={hlWidth}
                        onChange={(e) => setHlWidth(parseFloat(e.target.value))}
                    />
                </div>
                <div style={rowStyle}>
                    <div style={labelStyle}>Скорость (px/с)</div>
                    <input
                        type="range"
                        min={-200}
                        max={200}
                        step={1}
                        value={hlSpeed}
                        onChange={(e) => setHlSpeed(parseFloat(e.target.value))}
                    />
                    <input
                        type="number"
                        min={-9999}
                        max={9999}
                        step={1}
                        value={hlSpeed}
                        onChange={(e) => setHlSpeed(parseFloat(e.target.value))}
                    />
                </div>

                {/* NOISE */}
                <div style={{ height: 1, background: '#1f2733', margin: '12px 0' }} />

                <div style={rowStyle}>
                    <div style={labelStyle}>Шум: амплитуда (px)</div>
                    <input
                        type="range" min={0} max={300} step={1}
                        value={noiseAmpPx}
                        onChange={(e) => setNoiseAmpPx(parseFloat(e.target.value))}
                    />
                    <input
                        type="number" min={0} max={9999} step={1}
                        value={noiseAmpPx}
                        onChange={(e) => setNoiseAmpPx(parseFloat(e.target.value))}
                    />
                </div>

                <div style={rowStyle}>
                    <div style={labelStyle}>Шум: масштаб</div>
                    <input
                        type="range" min={1} max={200} step={1}
                        value={noiseScale}
                        onChange={(e) => setNoiseScale(parseFloat(e.target.value))}
                    />
                    <input
                        type="number" min={1} max={9999} step={1}
                        value={noiseScale}
                        onChange={(e) => setNoiseScale(parseFloat(e.target.value))}
                    />
                </div>

                <div style={rowStyle}>
                    <div style={labelStyle}>Шум: скорость</div>
                    <input
                        type="range" min={-10} max={10} step={0.1}
                        value={noiseSpeed}
                        onChange={(e) => setNoiseSpeed(parseFloat(e.target.value))}
                    />
                    <input
                        type="number" min={-999} max={999} step={0.1}
                        value={noiseSpeed}
                        onChange={(e) => setNoiseSpeed(parseFloat(e.target.value))}
                    />
                </div>

                {/* Плавный край */}
                <div style={rowStyle}>
                    <div style={labelStyle}>Край сегмента (px)</div>
                    <input
                        type="range" min={0} max={16} step={0.5}
                        value={edgeFeather}
                        onChange={(e)=>setEdgeFeather(parseFloat(e.target.value))}
                    />
                    <input
                        type="number" min={0} max={999} step={0.5}
                        value={edgeFeather}
                        onChange={(e)=>setEdgeFeather(parseFloat(e.target.value))}
                    />
                </div>

                {/* Затухание */}
                <div style={rowStyle}>
                    <div style={labelStyle}>Decay</div>
                    <input
                        type="range" min={0.0} max={0.2} step={0.001}
                        value={decay}
                        onChange={(e)=>setDecay(parseFloat(e.target.value))}
                    />
                    <input
                        type="number" min={0.0} max={1.0} step={0.001}
                        value={decay}
                        onChange={(e)=>setDecay(parseFloat(e.target.value))}
                    />
                </div>

                {/* Мягкость гребня */}
                <div style={rowStyle}>
                    <div style={labelStyle}>Soft</div>
                    <input
                        type="range" min={0.0} max={0.5} step={0.005}
                        value={soft}
                        onChange={(e)=>setSoft(parseFloat(e.target.value))}
                    />
                    <input
                        type="number" min={0.0} max={1.0} step={0.005}
                        value={soft}
                        onChange={(e)=>setSoft(parseFloat(e.target.value))}
                    />
                </div>

                <div style={{ height: 1, background: '#1f2733', margin: '12px 0' }} />
                <div style={rowStyle}>
                    <div style={labelStyle}>Цвет волн: Amount</div>
                    <input type="range" min={0} max={1} step={0.01}
                           value={colorAmount} onChange={e=>setColorAmount(parseFloat(e.target.value))}/>
                    <input type="number" min={0} max={1} step={0.01}
                           value={colorAmount} onChange={e=>setColorAmount(parseFloat(e.target.value))}/>
                </div>
                <div style={rowStyle}>
                    <div style={labelStyle}>Цвет волн: Stride</div>
                    <input type="range" min={0} max={1} step={0.01}
                           value={colorStride} onChange={e=>setColorStride(parseFloat(e.target.value))}/>
                    <input type="number" min={0} max={1} step={0.01}
                           value={colorStride} onChange={e=>setColorStride(parseFloat(e.target.value))}/>
                </div>
                <div style={rowStyle}>
                    <div style={labelStyle}>Цвет волн: Offset</div>
                    <input type="range" min={0} max={1} step={0.01}
                           value={colorOffset} onChange={e=>setColorOffset(parseFloat(e.target.value))}/>
                    <input type="number" min={0} max={1} step={0.01}
                           value={colorOffset} onChange={e=>setColorOffset(parseFloat(e.target.value))}/>
                </div>

                <div style={{ height: 1, background: '#1f2733', margin: '12px 0' }} />
                <h4 style={{ margin: '8px 0', color: '#cbd5e1' }}>Палитра волн (IQ cosine)</h4>

                {/* uPA */}
                <div style={rowStyle}><div style={labelStyle}>PA.x</div>
                    <input type="range" min={0} max={1} step={0.01} value={pa[0]}
                           onChange={e=>setPA(prev=>[parseFloat(e.target.value), prev[1], prev[2]])}/>
                    <input type="number" min={0} max={1} step={0.01} value={pa[0]}
                           onChange={e=>setPA(prev=>[parseFloat(e.target.value), prev[1], prev[2]])}/>
                </div>
                <div style={rowStyle}><div style={labelStyle}>PA.y</div>
                    <input type="range" min={0} max={1} step={0.01} value={pa[1]}
                           onChange={e=>setPA(prev=>[prev[0], parseFloat(e.target.value), prev[2]])}/>
                    <input type="number" min={0} max={1} step={0.01} value={pa[1]}
                           onChange={e=>setPA(prev=>[prev[0], parseFloat(e.target.value), prev[2]])}/>
                </div>
                <div style={rowStyle}><div style={labelStyle}>PA.z</div>
                    <input type="range" min={0} max={1} step={0.01} value={pa[2]}
                           onChange={e=>setPA(prev=>[prev[0], prev[1], parseFloat(e.target.value)])}/>
                    <input type="number" min={0} max={1} step={0.01} value={pa[2]}
                           onChange={e=>setPA(prev=>[prev[0], prev[1], parseFloat(e.target.value)])}/>
                </div>

                {/* uPB */}
                <div style={rowStyle}><div style={labelStyle}>PB.x</div>
                    <input type="range" min={0} max={1} step={0.01} value={pb[0]}
                           onChange={e=>setPB(prev=>[parseFloat(e.target.value), prev[1], prev[2]])}/>
                    <input type="number" min={0} max={1} step={0.01} value={pb[0]}
                           onChange={e=>setPB(prev=>[parseFloat(e.target.value), prev[1], prev[2]])}/>
                </div>
                <div style={rowStyle}><div style={labelStyle}>PB.y</div>
                    <input type="range" min={0} max={1} step={0.01} value={pb[1]}
                           onChange={e=>setPB(prev=>[prev[0], parseFloat(e.target.value), prev[2]])}/>
                    <input type="number" min={0} max={1} step={0.01} value={pb[1]}
                           onChange={e=>setPB(prev=>[prev[0], parseFloat(e.target.value), prev[2]])}/>
                </div>
                <div style={rowStyle}><div style={labelStyle}>PB.z</div>
                    <input type="range" min={0} max={1} step={0.01} value={pb[2]}
                           onChange={e=>setPB(prev=>[prev[0], prev[1], parseFloat(e.target.value)])}/>
                    <input type="number" min={0} max={1} step={0.01} value={pb[2]}
                           onChange={e=>setPB(prev=>[prev[0], prev[1], parseFloat(e.target.value)])}/>
                </div>

                {/* uPC */}
                <div style={rowStyle}><div style={labelStyle}>PC.x</div>
                    <input type="range" min={0} max={2} step={0.01} value={pc[0]}
                           onChange={e=>setPC(prev=>[parseFloat(e.target.value), prev[1], prev[2]])}/>
                    <input type="number" min={0} max={2} step={0.01} value={pc[0]}
                           onChange={e=>setPC(prev=>[parseFloat(e.target.value), prev[1], prev[2]])}/>
                </div>
                <div style={rowStyle}><div style={labelStyle}>PC.y</div>
                    <input type="range" min={0} max={2} step={0.01} value={pc[1]}
                           onChange={e=>setPC(prev=>[prev[0], parseFloat(e.target.value), prev[2]])}/>
                    <input type="number" min={0} max={2} step={0.01} value={pc[1]}
                           onChange={e=>setPC(prev=>[prev[0], parseFloat(e.target.value), prev[2]])}/>
                </div>
                <div style={rowStyle}><div style={labelStyle}>PC.z</div>
                    <input type="range" min={0} max={2} step={0.01} value={pc[2]}
                           onChange={e=>setPC(prev=>[prev[0], prev[1], parseFloat(e.target.value)])}/>
                    <input type="number" min={0} max={2} step={0.01} value={pc[2]}
                           onChange={e=>setPC(prev=>[prev[0], prev[1], parseFloat(e.target.value)])}/>
                </div>

                {/* uPD */}
                <div style={rowStyle}><div style={labelStyle}>PD.x</div>
                    <input type="range" min={0} max={1} step={0.01} value={pd[0]}
                           onChange={e=>setPD(prev=>[parseFloat(e.target.value), prev[1], prev[2]])}/>
                    <input type="number" min={0} max={1} step={0.01} value={pd[0]}
                           onChange={e=>setPD(prev=>[parseFloat(e.target.value), prev[1], prev[2]])}/>
                </div>
                <div style={rowStyle}><div style={labelStyle}>PD.y</div>
                    <input type="range" min={0} max={1} step={0.01} value={pd[1]}
                           onChange={e=>setPD(prev=>[prev[0], parseFloat(e.target.value), prev[2]])}/>
                    <input type="number" min={0} max={1} step={0.01} value={pd[1]}
                           onChange={e=>setPD(prev=>[prev[0], parseFloat(e.target.value), prev[2]])}/>
                </div>
                <div style={rowStyle}><div style={labelStyle}>PD.z</div>
                    <input type="range" min={0} max={1} step={0.01} value={pd[2]}
                           onChange={e=>setPD(prev=>[prev[0], prev[1], parseFloat(e.target.value)])}/>
                    <input type="number" min={0} max={1} step={0.01} value={pd[2]}
                           onChange={e=>setPD(prev=>[prev[0], prev[1], parseFloat(e.target.value)])}/>
                </div>

            </div>


            <canvas ref={canvasRef} style={{ borderRadius: 12, width: '100%' }} />
        </div>
    )
}

export default App
