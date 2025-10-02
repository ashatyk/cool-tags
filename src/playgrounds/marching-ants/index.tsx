import fragment from './fragment-cheap.ts'
import contourPoints from './../../assets/img_contour.json'
import imgUrl from './../../assets/img.png'
import { PlaygroundFrame, type PlaygroundConfig } from './../domains/playground-frame/index.tsx'



export const marchingAntsCheapConfig: PlaygroundConfig = {
    name: 'StripeRing',
    canvas: { width: 900, height: 1200 },
    shader: { fragment },
    backgroundSrc: imgUrl,
    coords: { json: contourPoints },
    staticUniforms: {},
    fields: [
        {
            name: 'uCenterTranslation',
            label: 'Смещение к центру (0..1)',
            kind: 'f32',
            default: 0.0,
            slider: { min: 0, max: 1, step: 0.01 },
        },
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
            default: 0.0,
            slider: { min: 0, max: 1, step: 0.01 },
        },

        // Кольцо
        {
            name: 'uRingOffsetPx',
            label: 'px: отступ кольца от границы',
            kind: 'f32',
            default: 20.0,
            slider: { min: 0, max: 100, step: 0.5 },
        },
        {
            name: 'uRingWidthPx',
            label: 'px: толщина кольца',
            kind: 'f32',
            default: 30.0,
            slider: { min: 0, max: 50, step: 0.5 },
        },
        {
            name: 'uEdgeFeatherPx',
            label: 'px: мягкость краёв',
            kind: 'f32',
            default: 1.5,
            slider: { min: 0, max: 5, step: 0.05 },
        },

        // Полосы
        {
            name: 'uStripePeriodPx',
            label: 'px: период полос',
            kind: 'f32',
            default: 60.0,
            slider: { min: 2, max: 60, step: 0.5 },
        },
        {
            name: 'uStripeAngleRad',
            label: 'рад: угол полос',
            kind: 'f32',
            default: 3, // 45°
            slider: { min: 0, max: 6.283185, step: 0.01 },
        },
        {
            name: 'uStripeSpeedPx',
            label: 'px/с: скорость сдвига',
            kind: 'f32',
            default: 15.0,
            slider: { min: -300, max: 300, step: 1 },
        },
        {
            name: 'uStripeSmooth',
            label: 'Мягкость полос (0..1)',
            kind: 'f32',
            default: 0.2,
            slider: { min: 0, max: 1, step: 0.01 },
        },
    ],
};

export function MarchingAntsCheapPlaygroundFrame() {
    return <PlaygroundFrame config={marchingAntsCheapConfig} />
}
