// ShaderPlayground.tsx
import React, { useEffect, useMemo, useRef } from 'react'
import { Application, Assets, Sprite, Mesh, Geometry, Shader, UniformGroup, Texture } from 'pixi.js'
import { Form, Field, FormSpy } from 'react-final-form'
import type {ContourMap, SegmentTexel} from "./index-new.tsx";
import {findSegmentIdAtPoint, getCanvasPoint} from "../utils/hit-test.ts";
import { toNum } from '../utils/index.ts';
import { DEFAULT_VERTEX } from '../playgrounds/domains/playground-frame/constants.ts';

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
    backgroundSrc?: string

    texels: Record<string, SegmentTexel>
    contours: Record<string, number[]>
}

export function SinglePreview({ config }: { config: PlaygroundConfig }) {
    const { canvas: c, shader, fields, staticUniforms, backgroundSrc, texels, contours, name } = config

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

            if (diffuseSource) resources.uDiffuse = diffuseSource

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
    }, [backgroundSrc, c.height, c.width, fields, name, shader.fragment, shader.vertex, staticUniforms])

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

            if(window[`__PIXI_APP__${name}`]?.stage?.children.length === 2){

                console.log('applyTexels 1', id)

                const r = (window[`__PIXI_APP__${name}`]?.stage?.children?.[1] as Mesh<Geometry,Shader>)?.shader
                    ?.resources

                const u = r.uniforms as UniformGroup | undefined

                if(id){
                    const segmentTexel = (texels[id] as SegmentTexel);

                    const tex = await Assets.load(segmentTexel.image);

                    u.uniforms.uPointTextureDim  = [segmentTexel.w, segmentTexel.h];
                    u.uniforms.uPointTexelCount  = segmentTexel.count | 0;
                    u.uniforms.uPointAABB        = segmentTexel.aabbN;

                    (window[`__PIXI_APP__${name}`]?.stage?.children?.[1] as Mesh<Geometry,Shader>).shader.resources['uPointTexture'] = tex.source

                }
            }
        }



    }, [contours, name, texels]);

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

            <canvas ref={canvasRef} style={{ width: 900, height: 1200, inset: 0,border: '1px solid white' }} onMouseMove={onMove}/>
        </div>
    )
}
