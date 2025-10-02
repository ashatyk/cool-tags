// ShaderPlayground.tsx
import { useEffect, useMemo, useRef } from 'react'
import { Application, Assets, Sprite, Mesh, Geometry, Shader, UniformGroup, Texture } from 'pixi.js'
import { Form, Field, FormSpy } from 'react-final-form'
import { toNum } from '../../../utils'
import {DEFAULT_VERTEX} from "./constants.ts";

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

export function PlaygroundFrame({ config }: { config: PlaygroundConfig }) {
    const { canvas: c, shader, fields, staticUniforms, backgroundSrc, coords, name } = config

    const canvasRef = useRef<HTMLCanvasElement>(null)

    const uniformsRef = useRef<UniformGroup | null>(null)

    type Values = Record<string, never>
    const initialValues: Values = useMemo(() => {
        const o: Values = {}
        for (const f of fields) o[f.name] = f.default as never
        return o
    }, [fields])

    // PIXI init
    useEffect(() => {
        const init = async () => {
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

            // background texture
            let diffuseSource: any = undefined

            if (backgroundSrc) {
                const bg = await Assets.load(backgroundSrc)

                const sprite = new Sprite(bg)

                sprite.width = app.view.width
                sprite.height = app.view.height

                app.stage.addChild(sprite)

                diffuseSource = bg.source
            }

            // full-quad geometry
            const geometry = new Geometry({
                attributes: {
                    aPosition: [0, 0, c.width, 0, c.width, c.height, 0, c.height],
                    aUV: [0, 0, 1, 0, 1, 1, 0, 1],
                },
                indexBuffer: [0, 1, 2, 0, 2, 3],
            })

            // optional: coords → RGBA8 texture
            let coordsRes: {
                tex?: Texture
                w?: number
                h?: number
                count?: number
                minX?: number
                minY?: number
                maxX?: number
                maxY?: number
            } = {}

            if (coords?.json) {
                type Coords = Float32Array

                function loadCoordsJson(): Coords {
                    const json = coords!.json as unknown
                    let arr: number[] | undefined
                    if (Array.isArray(json)) {
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

                function normalizeToCanvas(coords: Coords, canvasW = c.width, canvasH = c.height) {
                    let minX = Infinity,
                        minY = Infinity,
                        maxX = -Infinity,
                        maxY = -Infinity
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

                function fitTextureWH(pointPairs: number) {
                    const w = Math.ceil(Math.sqrt(pointPairs))
                    const h = Math.ceil(pointPairs / w)
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

                const coordsArr = loadCoordsJson()

                const { out: normalized, minX, minY, maxX, maxY } = normalizeToCanvas(coordsArr)

                const { image, w, h, count } = packRGBA8ImageData(normalized)

                const tex = await Assets.load<Texture>(image)

                coordsRes = { tex, w, h, count, minX, minY, maxX, maxY }
            }

            // build uniforms
            const uEntries: Record<string, { value: any; type: UniformKind }> = {
                uTime: { value: 0, type: 'f32' },
                uResolution: { value: [c.width, c.height], type: 'vec2<f32>' },
                ...(staticUniforms ?? {}),
            }

            // fields → uniforms
            for (const f of fields) {
                const name = f.uniformName ?? f.name
                uEntries[name] = { value: f.default as any, type: f.kind }
            }

            // coords uniforms (optional)
            if (coordsRes.tex) {
                const N = coords.uniformNames ?? {}

                const nameDim = N.dim ?? 'uPointTextureDim'

                const nameCount = N.count ?? 'uPointTexelCount'

                const nameAABB = N.aabb ?? 'uPointAABB'

                uEntries[nameDim] = { value: [coordsRes.w, coordsRes.h], type: 'vec2<f32>' }
                uEntries[nameCount] = { value: coordsRes.count, type: 'i32' }
                uEntries[nameAABB] = {
                    value: [coordsRes.minX, coordsRes.minY, coordsRes.maxX, coordsRes.maxY],
                    type: 'vec4<f32>',
                }
                // texture goes into resources below
            }

            const uniforms = new UniformGroup(uEntries, { isStatic: false })

            const resources: any = { uniforms }

            if (diffuseSource) resources.uDiffuse = diffuseSource

            if (coordsRes.tex) resources[(coords?.uniformNames?.tex ?? 'uPointTexture')] = coordsRes.tex.source

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

            return () => {
                app.destroy(true)
                if ((window as any)[`__PIXI_APP__${name}`] === app) delete (window as any)[`__PIXI_APP__${name}`]
            }
        }

        let cleanup: (() => void) | undefined
        init().then((c) => {
            cleanup = c
        })
        return () => cleanup?.()
    }, [])

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
        <div style={{ display: 'flex', gap: 32, alignItems: 'center',width:'100%',paddingTop: '16px' }}>
            <div
                style={{
                    background: '#383838',
                    border: '1px solid #222a36',
                    minWidth: '852px',
                    height: '1200px',
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

            <canvas ref={canvasRef} style={{ borderRadius: 12, width: '100%', display: 'block' }} />
        </div>
    )
}
