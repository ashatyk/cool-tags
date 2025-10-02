import fragment from './fragment.ts'
import contourPoints from './../../assets/img_contour.json'
import imgUrl from './../../assets/img.png'
import { PlaygroundFrame, type PlaygroundConfig } from './../domains/playground-frame/index.tsx'

export const marchingAntsConfig: PlaygroundConfig = {
    name: 'MarchingAnts',
    canvas: { width: 900, height: 1200 },
    shader: { fragment },
    backgroundSrc: imgUrl,
    coords: { json: contourPoints },
    staticUniforms: {},
    fields: [
        {
            name: 'uColorOn',
            label: 'Цвет штриха',
            kind: 'vec3<f32>',
            default: [1.0, 1.0, 1.0],
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uColorOff',
            label: 'Цвет фона кольца',
            kind: 'vec3<f32>',
            default: [0.0, 0.0, 0.0],
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uIntensity',
            label: 'Интенсивность альфы',
            kind: 'f32',
            default: 1.0,
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uAntsOffsetPx',
            label: 'px: отступ кольца от границы',
            kind: 'f32',
            default: 2.0,
            slider: { min: 0, max: 100, step: 0.5 },
        },
        {
            name: 'uAntsWidthPx',
            label: 'px: толщина кольца',
            kind: 'f32',
            default: 2.0,
            slider: { min: 0, max: 50, step: 0.5 },
        },
        {
            name: 'uDashPeriodPx',
            label: 'px: период штриха вдоль контура',
            kind: 'f32',
            default: 6.0,
            slider: { min: 1, max: 50, step: 0.5 },
        },
        {
            name: 'uDashDuty',
            label: 'доля заполнения (0..1)',
            kind: 'f32',
            default: 0.5,
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uDashSpeedPx',
            label: 'px/с: скорость вдоль контура',
            kind: 'f32',
            default: 60.0,
            slider: { min: -200, max: 200, step: 1 },
        },
        {
            name: 'uEdgeFeatherPx',
            label: 'px: мягкость краёв',
            kind: 'f32',
            default: 1.25,
            slider: { min: 0, max: 5, step: 0.05 },
        },
        {
            name: 'uCenterTranslation',
            label: 'смещение к центру (0..1)',
            kind: 'f32',
            default: 0.0,
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uSmoothSigma',
            label: 'px: реф-изолиния для фазы',
            kind: 'f32',
            default: 2.0,
            slider: { min: 0, max: 20, step: 0.5 },
        },
        {
            name: 'uNormalEpsPx',
            label: 'px: сглаживание нормали',
            kind: 'f32',
            default: 1.0,
            slider: { min: 0.25, max: 4, step: 0.25 },
        },
    ],
}

export function MarchingAntsPlaygroundFrame() {
    return <PlaygroundFrame config={marchingAntsConfig} />
}
