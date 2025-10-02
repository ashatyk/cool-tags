
import fragment from './fragment.ts'
import contourPoints from './../../assets/img_contour.json'
import imgUrl from './../../assets/img.png'
import { PlaygroundFrame, type PlaygroundConfig } from './../domains/playground-frame/index.tsx'

// eslint-disable-next-line react-refresh/only-export-components
export const noiseLightRaysConfig: PlaygroundConfig = {
    name: 'NoiseLightRays',
    canvas: { width: 900, height: 1200 },
    shader: { fragment },
    backgroundSrc: imgUrl,
    coords: { json: contourPoints },
    staticUniforms: {

    },
    fields: [
        {
            name: 'uEdgeFeatherPx',
            label: 'Край шейдера (px/с)',
            kind: 'f32',
            default: 0.5,
            slider: { min: 0, max: 10, step: 0.1 },
        },
        {
            name: 'uCenterTranslation',
            label: 'Смещение точек к центру',
            kind: 'f32',
            default: 0,
            slider: { min: -1, max: 1, step: 0.001 },
        },
        {
            name: 'uColor0',
            label: 'Цвет первого ряда',
            kind: 'vec4<f32>',
            default: [0.4,1.0,1.0,1.0],
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uColor1',
            label: 'Цвет второго ряда',
            kind: 'vec4<f32>',
            default: [1.0,0.4,1.0,1.0],
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uColor2',
            label: 'Цвет третьего ряда',
            kind: 'vec4<f32>',
            default: [1.0,1.0,0.6,1.0],
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uRayStrength3',
            label: 'Сила света',
            kind: 'vec3<f32>',
            default: [1.0,1.0,1.0],
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uRayLengthPx3',
            label: 'Длинна света',
            kind: 'vec3<f32>',
            default: [300.0,200.0,400.0],
            slider: { min: 0, max: 1000, step: 0.01 },
        },
        {
            name: 'uRaySharpness3',
            label: 'Острота света',
            kind: 'vec3<f32>',
            default: [1.0,1.0,1.0],
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uRayDensity3',
            label: 'Частота лучей света',
            kind: 'vec3<f32>',
            default: [0.45,0.2,0.2],
            slider: { min: 0, max: 2, step: 0.01 },
        },
        {
            name: 'uRaySpeed3',
            label: 'Скорость вращения лучей света',
            kind: 'vec3<f32>',
            default: [1.0,1.0,1.0],
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uRayFalloff3',
            label: 'Сила угасания лучей света',
            kind: 'vec3<f32>',
            default: [0.02,0.02,0.01],
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uRayStartSoftPx3',
            label: 'Слияние лучей света',
            kind: 'vec3<f32>',
            default: [1.0,1.0,1.0],
            slider: { min: 0, max: 1000, step: 1 },
        },
        {
            name: 'uJoinSoftness3',
            label: 'Мягкость слияния лучей света',
            kind: 'vec3<f32>',
            default: [0.1,1.0,1.0],
            slider: { min: 0, max: 1, step: 0.01 },
        },
    ],
}

export function NoiseLightRaysPlaygroundFrame() {
    return <PlaygroundFrame config={noiseLightRaysConfig} />
}
