import fragment from './fragment.ts'
import contourPoints from './../../assets/img_contour.json'
import imgUrl from './../../assets/img.png'
import { PlaygroundFrame, type PlaygroundConfig } from './../domains/playground-frame/index.tsx'

export const radialWaveConfig: PlaygroundConfig = {
    name: 'RadialWave',
    canvas: { width: 900, height: 1200 },
    shader: { fragment },
    backgroundSrc: imgUrl,
    coords: { json: contourPoints },
    staticUniforms: {},
    fields: [
        // Цвет и интенсивность
        {
            name: 'uWaveColor',
            label: 'Цвет волны',
            kind: 'vec3<f32>',
            default: [1.0, 1.0, 1.0],
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uIntensity',
            label: 'Яркость',
            kind: 'f32',
            default: 1.0,
            slider: { min: 0, max: 2, step: 0.01 },
        },

        // Геометрия волны
        {
            name: 'uWavePeriodPx',
            label: 'px: шаг между гребнями',
            kind: 'f32',
            default: 120.0,
            slider: { min: 10, max: 400, step: 1 },
        },
        {
            name: 'uWaveThicknessPx',
            label: 'px: толщина гребня',
            kind: 'f32',
            default: 8.0,
            slider: { min: 1, max: 30, step: 0.5 },
        },
        {
            name: 'uWaveSpeedPx',
            label: 'px/с: скорость к фокусу',
            kind: 'f32',
            default: 80.0,
            slider: { min: -300, max: 300, step: 1 },
        },

        // Область действия
        {
            name: 'uBandStartPx',
            label: 'px: отступ от границы сегмента',
            kind: 'f32',
            default: 10.0,
            slider: { min: 0, max: 200, step: 1 },
        },
        {
            name: 'uBandWidthPx',
            label: 'px: ширина бэнда',
            kind: 'f32',
            default: 120.0,
            slider: { min: 10, max: 400, step: 1 },
        },
        {
            name: 'uFocusDeadZonePx',
            label: 'px: мёртвая зона у фокуса',
            kind: 'f32',
            default: 20.0,
            slider: { min: 0, max: 200, step: 1 },
        },

        // Фокус
        {
            name: 'uFocusOffsetPx',
            label: 'px: смещение фокуса (x,y)',
            kind: 'vec2<f32>',
            default: [0.0, 0.0],
            slider: { min: -300, max: 300, step: 1 },
        },

        // Искажения формы и скорости
        {
            name: 'uNoiseScale',
            label: 'Шум: масштаб',
            kind: 'f32',
            default: 1.0,
            slider: { min: 0.2, max: 3.0, step: 0.01 },
        },
        {
            name: 'uNoiseTimeK',
            label: 'Шум: скорость эволюции',
            kind: 'f32',
            default: 0.8,
            slider: { min: 0.0, max: 2.0, step: 0.01 },
        },
        {
            name: 'uSwirlRad',
            label: 'Свирл: макс угол (рад)',
            kind: 'f32',
            default: 0.35,
            slider: { min: 0.0, max: 0.7, step: 0.01 },
        },
        {
            name: 'uSwirlFalloffPx',
            label: 'Свирл: спад по радиусу (px)',
            kind: 'f32',
            default: 250.0,
            slider: { min: 20, max: 800, step: 1 },
        },
        {
            name: 'uRadJitterPx',
            label: 'Радиальный джиттер гребня (px)',
            kind: 'f32',
            default: 10.0,
            slider: { min: 0, max: 40, step: 0.5 },
        },
        {
            name: 'uSpeedJitterK',
            label: 'Синус-модулятор скорости (K)',
            kind: 'f32',
            default: 0.4,
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uSpeedJitterHz',
            label: 'Синус-модулятор скорости (Гц)',
            kind: 'f32',
            default: 0.6,
            slider: { min: 0.0, max: 3.0, step: 0.01 },
        },
        {
            name: 'uSpeedNoiseK',
            label: 'Шумовой модулятор скорости (K)',
            kind: 'f32',
            default: 0.35,
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uInnerEdgeFadePx',
            label: 'Затухание у края изнутри (px)',
            kind: 'f32',
            default: 8.0,
            slider: { min: 0, max: 40, step: 1 },
        },

        // Художественный сдвиг
        {
            name: 'uCenterTranslation',
            label: 'Смещение к центру (0..1)',
            kind: 'f32',
            default: 0.0,
            slider: { min: 0, max: 1, step: 0.01 },
        },
    ],
};

export function RadialWavePlaygroundFrame() {
    return <PlaygroundFrame config={radialWaveConfig} />
}
