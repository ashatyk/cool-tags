type FlatPolygon = number[];              // [x0,y0,x1,y1,...]
type ContourMap = Record<string, FlatPolygon>;

/** Переводим clientX/clientY в координаты канваса (900x1200), учитываем CSS-скейл. */
export function getCanvasPoint(
    e: MouseEvent,
    canvas: HTMLCanvasElement,
    targetW = 900,
    targetH = 1200
): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;   // [0..1] по CSS-размеру
    const ny = (e.clientY - rect.top)  / rect.height;
    return { x: nx * targetW, y: ny * targetH };
}

/** Быстрый ray-cast по плоскому массиву [x0,y0,...]. Чётно-нечётное правило. */
export function pointInPolygonFlat(x: number, y: number, pts: FlatPolygon): boolean {
    let inside = false;
    // проходим по рёбрам (i -> j)
    for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
        const xi = pts[i],     yi = pts[i + 1];
        const xj = pts[j],     yj = pts[j + 1];

        // проверяем, пересекает ли горизонтальный луч ребро (исключаем горизонтальные ребра)
        const intersect =
            ((yi > y) !== (yj > y)) &&
            (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);

        if (intersect) inside = !inside;
    }
    return inside;
}

/** Опционально: AABB для раннего отсечения. Можно кэшировать между вызовами. */
function aabbContains(x: number, y: number, box: [number, number, number, number]) {
    const [minX, minY, maxX, maxY] = box;
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
}
export function computeAABB(pts: FlatPolygon): [number, number, number, number] {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
        const x = pts[i], y = pts[i + 1];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    return [minX, minY, maxX, maxY];
}

/**
 * Возвращает первый id сегмента, который содержит точку (x,y).
 * Если нужен порядок “сверху вниз”, передайте orderedIds.
 */
export function findSegmentIdAtPoint(
    segments: ContourMap,
    x: number,
    y: number,
    orderedIds?: string[],
    aabbCache?: Map<string, [number, number, number, number]>,
): string | null {
    const ids = orderedIds ?? Object.keys(segments);
    for (let k = 0; k < ids.length; k++) {
        const id = ids[k];
        const poly = segments[id];
        if (!poly || poly.length < 6) continue;

        let box = aabbCache?.get(id);
        if (!box) {
            box = computeAABB(poly);
            aabbCache?.set(id, box);
        }
        if (!aabbContains(x, y, box)) continue;

        if (pointInPolygonFlat(x, y, poly)) return id;
    }
    return null;
}
