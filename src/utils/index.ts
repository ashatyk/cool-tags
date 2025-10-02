
// ======= утилиты =======
export function rgb01ToHex(r: number, g: number, b: number) {
    const to255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)))
    return `#${[to255(r), to255(g), to255(b)]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')}`
}
export function hexToRgb01(hex: string) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    const x = (s: string) => parseInt(s, 16) / 255
    return m ? { r: x(m[1]), g: x(m[2]), b: x(m[3]) } : { r: 1, g: 1, b: 1 }
}
export const toNum = (v: unknown) => (v === '' || v == null ? undefined : parseFloat(v as string))
