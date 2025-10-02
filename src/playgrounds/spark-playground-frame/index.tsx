
import fragment from './fragment.ts'
import contourPoints from './../../assets/img_contour.json'
import imgUrl from './../../assets/img.png'
import { PlaygroundFrame, type PlaygroundConfig } from './../domains/playground-frame/index.tsx'


// uniform vec3  uSparkColor;     // цвет бликов
// uniform float uSparkDensity;   // шт на 1e6 px^2 (редко = 20..120)
// uniform float uSparkSizePx;    // базовый размер «звездочки»
// uniform float uSparkIntensity; // множитель яркости
// uniform float uSparkSpeed;     // скорость мерцания
// uniform float uSparkDuty;      // длительность пика 0..0.5 (короче = резче)
// uniform float uSparkSeed;      // сид для рандома

export const sparkConfig: PlaygroundConfig = {
    name: 'Spark',
    canvas: { width: 900, height: 1200 },
    shader: { fragment },
    backgroundSrc: imgUrl,
    coords: { json: contourPoints },
    staticUniforms: {

    },
    fields: [
        {
            name: 'uSparkColor',
            label: 'Цвет звездочек',
            kind: 'vec3<f32>',
            default: [1.0,1.0,1.0],
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uSparkDensity',
            label: 'Плотность звезд',
            kind: 'f32',
            default: 1,
            slider: { min: 0, max: 5.0, step: 0.1 },
        },
        {
            name: 'uSparkSizePx',
            label: 'Размер звезд',
            kind: 'f32',
            default: 1,
            slider: { min: 0, max: 5.0, step: 0.1 },
        },
        {
            name: 'uSparkIntensity',
            label: 'Яркость звезд',
            kind: 'f32',
            default: 1,
            slider: { min: 0, max: 5.0, step: 0.1 },
        },
        {
            name: 'uSparkSpeed',
            label: 'Скорость мерцания звезд',
            kind: 'f32',
            default: 1,
            slider: { min: 0, max: 5.0, step: 0.1 },
        },
        {
            name: 'uSparkDuty',
            label: 'Острота звезд',
            kind: 'f32',
            default: 1,
            slider: { min: 0, max: 5.0, step: 0.1 },
        },
        {
            name: 'uSparkSeed',
            label: 'Сид генерации звезд',
            kind: 'f32',
            default: 1,
            slider: { min: -999, max: 999, step: 1 },
        },
    ],
}

export function SparkPlaygroundFrame() {
    return <PlaygroundFrame config={sparkConfig} />
}
