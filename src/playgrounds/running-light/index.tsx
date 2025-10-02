import fragment from './fragment.ts'
import contourPoints from './../../assets/img_contour.json'
import imgUrl from './../../assets/img.png'
import { PlaygroundFrame, type PlaygroundConfig } from './../domains/playground-frame/index.tsx'

const config: PlaygroundConfig = {
    name: 'RunningBeam',
    canvas: { width: 900, height: 1200 },
    shader: { fragment },
    backgroundSrc: imgUrl,
    coords: { json: contourPoints },
    staticUniforms: {},
    fields: [
        // Цвет и интенсивность
        {
            name: 'uBeamColor',
            label: 'Цвет луча',
            kind: 'vec3<f32>',
            default: [1.0, 0.95, 0.8],
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uBeamIntensity',
            label: 'Интенсивность',
            kind: 'f32',
            default: 1.0,
            slider: { min: 0, max: 2, step: 0.01 },
        },

        // Геометрия луча
        {
            name: 'uBeamOffsetPx',
            label: 'px: отступ от границы',
            kind: 'f32',
            default: 6.0,
            slider: { min: 0, max: 120, step: 0.5 },
        },
        {
            name: 'uBeamWidthPx',
            label: 'px: полуширина луча',
            kind: 'f32',
            default: 3.0,
            slider: { min: 0, max: 50, step: 0.25 },
        },
        {
            name: 'uBeamAngularWidth',
            label: 'рад: угловая ширина окна',
            kind: 'f32',
            default: 0.35,
            slider: { min: 0, max: 3.141593, step: 0.01 },
        },

        // Анимация
        {
            name: 'uBeamSpeed',
            label: 'рад/с: скорость обхода',
            kind: 'f32',
            default: 1.4,
            slider: { min: -8, max: 8, step: 0.01 },
        },

        // Контроль краёв и центра
        {
            name: 'uEdgeFeatherPx',
            label: 'px: мягкость краёв',
            kind: 'f32',
            default: 1.5,
            slider: { min: 0, max: 6, step: 0.05 },
        },
        {
            name: 'uCenterTranslation',
            label: 'Смещение к центру (0..1)',
            kind: 'f32',
            default: 0.0,
            slider: { min: 0, max: 1, step: 0.01 },
        },
    ],
};

export function RunningBeamPlaygroundFrame() {
    return <PlaygroundFrame config={config} />
}
