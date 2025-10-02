import fragment from './fragment.ts'
import contourPoints from './../../assets/img_contour.json'
import imgUrl from './../../assets/img.png'
import { PlaygroundFrame, type PlaygroundConfig } from './../domains/playground-frame/index.tsx'

export const sdfBorederFlowConfig: PlaygroundConfig = {
    name: 'SDFBorederFlow',
    canvas: { width: 900, height: 1200 },
    shader: { fragment },
    backgroundSrc: imgUrl,
    coords: { json: contourPoints },
    staticUniforms: {

    },
    fields: [
        // базовый цвет
        {
            name: 'uFillColor',
            label: 'Цвет заливки RGBA',
            kind: 'vec4<f32>',
            default: [0.9, 0.7, 0.4, 1.0],
            slider: { min: 0, max: 1, step: 0.01 },
        },

        // волна
        { name: 'uHLWidth',  label: 'Длина волны (px)', kind: 'f32', default: 36, slider: { min: 0, max: 200, step: 1 } },
        { name: 'uHLSpeed',  label: 'Скорость (px/с)',  kind: 'f32', default: 30, slider: { min: -200, max: 200, step: 1 } },

        // шум
        { name: 'uNoiseAmpPx', label: 'Шум амплитуда (px)', kind: 'f32', default: 12, slider: { min: 0, max: 64, step: 0.1 } },
        { name: 'uNoiseScale', label: 'Шум масштаб',        kind: 'f32', default: 2.5, slider: { min: 0.1, max: 8, step: 0.01 } },
        { name: 'uNoiseSpeed', label: 'Шум скорость',       kind: 'f32', default: 1.0, slider: { min: -5, max: 5, step: 0.01 } },

        // сглаживание/затухание
        { name: 'uDecay',         label: 'Затухание',       kind: 'f32', default: 0.045, slider: { min: 0, max: 0.2, step: 0.001 } },
        { name: 'uSoft',          label: 'Мягкость гребня', kind: 'f32', default: 0.25,  slider: { min: 0, max: 10, step: 0.01 } },
        { name: 'uEdgeFeatherPx', label: 'Перо края (px)',  kind: 'f32', default: 8,     slider: { min: 0, max: 48, step: 1 } },

        // палитра
        { name: 'uColorAmount', label: 'Доля палитры', kind: 'f32', default: 0.5, slider: { min: 0, max: 1, step: 0.01 } },
        { name: 'uColorStride', label: 'Шаг палитры/волну', kind: 'f32', default: 0.2, slider: { min: -1, max: 1, step: 0.01 } },
        { name: 'uColorOffset', label: 'Сдвиг палитры', kind: 'f32', default: 0.0, slider: { min: 0, max: 1, step: 0.01 } },

        // cosine-палитра IQ
        {
            name: 'uPA',
            label: 'PA',
            kind: 'vec3<f32>',
            default: [0.5, 0.5, 0.5],
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uPB',
            label: 'PB',
            kind: 'vec3<f32>',
            default: [0.5, 0.5, 0.5],
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uPC',
            label: 'PC',
            kind: 'vec3<f32>',
            default: [1.0, 1.0, 1.0],
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uPD',
            label: 'PD',
            kind: 'vec3<f32>',
            default: [0.0, 0.33, 0.67],
            slider: { min: 0, max: 1, step: 0.01 },
        },
    ],
}

export function SDFBorederFlowPlaygroundFrame() {
    return <PlaygroundFrame config={sdfBorederFlowConfig} />
}
