import fragment from './fragment.ts'
import contourPoints from './../../assets/img_contour.json'
import imgUrl from './../../assets/img.png'
import { PlaygroundFrame, type PlaygroundConfig } from './../domains/playground-frame/index.tsx'

export const rainDropsConfig: PlaygroundConfig = {
    name: 'RainDrops',
    canvas: { width: 900, height: 1200 },
    shader: { fragment },
    backgroundSrc: imgUrl,
    coords: { json: contourPoints },
    staticUniforms: {

    },
    fields: [
        {
            name: 'uHLSpeed',
            label: 'Скорость (px/с)',
            kind: 'f32',
            default: 3.0,
            slider: { min: -20, max: 20, step: 0.1 },
        },
        {
            name: 'uAmount',
            label: 'Сила дождя',
            kind: 'f32',
            default: 1.0,
            slider: { min: 0, max: 1, step: 0.01 },
        },
        {
            name: 'uFlowAngleRad',
            label: 'Направление дождя',
            kind: 'f32',
            default: 0.0,
            slider: { min: -1, max: 1, step: 0.01 },
        },
    ],
}

export function RainDropsPlaygroundFrame() {
    return <PlaygroundFrame config={rainDropsConfig} />
}
