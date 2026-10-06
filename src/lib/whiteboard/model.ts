/** Owned canvas records. Legacy record IDs and props are retained for lossless import/replay. */
export interface TLGlobalShapePropsMap {}
export type TLShapeId = string;
export type TLDefaultColorStyle = string;
export interface TLRecord {
  id: string;
  typeName: string;
  [key: string]: any;
}
export type TLShape<K extends string = string> = TLRecord & {
  typeName: "shape";
  type: K;
  x: number;
  y: number;
  rotation: number;
  parentId: string;
  index: string;
  isLocked: boolean;
  opacity: number;
  meta: Record<string, any>;
  props: K extends keyof TLGlobalShapePropsMap
    ? TLGlobalShapePropsMap[K]
    : Record<string, any>;
};
export type TLTextShape = TLShape<"text">;
export type TLArrowShape = TLShape<"arrow">;
export type TLGeoShape = TLShape<"geo">;
export type TLArrowBinding = TLRecord & {
  type: "arrow";
  fromId: string;
  toId: string;
  props: {
    terminal: "start" | "end";
    normalizedAnchor: { x: number; y: number };
    isPrecise?: boolean;
    isExact?: boolean;
    snap?: string;
  };
};
export interface TLCamera {
  x: number;
  y: number;
  z: number;
  id?: string;
  typeName?: string;
}
export interface TLStoreSnapshot {
  schema: Record<string, any>;
  store: Record<string, TLRecord>;
}
export const SCHEMA = { loci: 1 };
export const createShapeId = (id?: string) =>
  `shape:${id ?? crypto.randomUUID()}`;
export const toRichText = (text: string) => ({
  type: "doc",
  content: text.split("\n").map((text) => ({
    type: "paragraph",
    content: text ? [{ type: "text", text }] : [],
  })),
});
export function renderPlaintextFromRichText(value: any): string {
  if (typeof value === "string") return value;
  if (!value) return "";
  if (value.type === "text") return value.text ?? "";
  const parts = (value.content ?? []).map(renderPlaintextFromRichText);
  return parts.join(value.type === "doc" ? "\n" : "");
}
export class Box {
  constructor(
    public x: number,
    public y: number,
    public w: number,
    public h: number,
  ) {}
  get width() {
    return this.w;
  }
  get height() {
    return this.h;
  }
  get minX() {
    return this.x;
  }
  get minY() {
    return this.y;
  }
  get maxX() {
    return this.x + this.w;
  }
  get maxY() {
    return this.y + this.h;
  }
  get center() {
    return { x: this.x + this.w / 2, y: this.y + this.h / 2 };
  }
  get point() {
    return { x: this.x, y: this.y };
  }
  collides(b: { x: number; y: number; w: number; h: number }) {
    return (
      this.x <= b.x + b.w &&
      this.maxX >= b.x &&
      this.y <= b.y + b.h &&
      this.maxY >= b.y
    );
  }
  containsPoint(p: { x: number; y: number }) {
    return (
      p.x >= this.x && p.x <= this.maxX && p.y >= this.y && p.y <= this.maxY
    );
  }
}
export class Rectangle2d {
  bounds: Box;
  isLabel = false;
  constructor(info: {
    width: number;
    height: number;
    isFilled: boolean;
    x?: number;
    y?: number;
  }) {
    this.bounds = new Box(info.x ?? 0, info.y ?? 0, info.width, info.height);
  }
}
export class Group2d extends Rectangle2d {
  constructor(public children: Rectangle2d[]) {
    super({ width: 0, height: 0, isFilled: false });
  }
}
export type Matrix = [number, number, number, number, number, number];
export const identity: Matrix = [1, 0, 0, 1, 0, 0];
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function transform(m: Matrix, p: { x: number; y: number }) {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}
export function inverse(m: Matrix): Matrix {
  const d = m[0] * m[3] - m[1] * m[2];
  if (!d) return identity;
  return [
    m[3] / d,
    -m[1] / d,
    -m[2] / d,
    m[0] / d,
    (m[2] * m[5] - m[3] * m[4]) / d,
    (m[1] * m[4] - m[0] * m[5]) / d,
  ];
}
export function worldMatrix(
  shape: TLShape,
  records: Record<string, TLRecord>,
  seen = new Set<string>(),
): Matrix {
  const c = Math.cos(shape.rotation || 0),
    s = Math.sin(shape.rotation || 0);
  const own: Matrix = [c, s, -s, c, shape.x || 0, shape.y || 0];
  if (seen.has(shape.id)) return own;
  seen.add(shape.id);
  const parent = records[shape.parentId];
  return parent?.typeName === "shape"
    ? multiply(worldMatrix(parent as TLShape, records, seen), own)
    : own;
}
export function unionBoxes(boxes: Box[]) {
  if (!boxes.length) return new Box(0, 0, 0, 0);
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y));
  return new Box(
    x,
    y,
    Math.max(...boxes.map((b) => b.maxX)) - x,
    Math.max(...boxes.map((b) => b.maxY)) - y,
  );
}
/** Interoperability decoder: Float32 origin followed by accumulated IEEE-754 Float16 deltas. */
export function decodeStroke(path: string, dim: 2 | 3 = 3): number[][] {
  const raw = Uint8Array.from(atob(path), (c) => c.charCodeAt(0));
  const view = new DataView(raw.buffer);
  if (raw.length < dim * 4 || (raw.length - dim * 4) % (dim * 2))
    throw new Error("Invalid saved stroke");
  const point = Array.from({ length: dim }, (_, i) =>
    view.getFloat32(i * 4, true),
  );
  const result = [dim === 2 ? [...point, 0.5] : [...point]];
  const half = (bits: number) => {
    const sign = bits & 0x8000 ? -1 : 1,
      exp = (bits >> 10) & 31,
      frac = bits & 1023;
    return (
      sign *
      (exp === 0
        ? (2 ** -14 * frac) / 1024
        : exp === 31
          ? frac
            ? NaN
            : Infinity
          : 2 ** (exp - 15) * (1 + frac / 1024))
    );
  };
  for (let offset = dim * 4; offset < raw.length; offset += dim * 2) {
    for (let i = 0; i < dim; i++)
      point[i] += half(view.getUint16(offset + i * 2, true));
    result.push(dim === 2 ? [...point, 0.5] : [...point]);
  }
  if (result.some((p) => p.some((n) => !Number.isFinite(n))))
    throw new Error("Invalid saved stroke coordinates");
  return result;
}
export function strokePoints(shape: TLShape): number[][] {
  const sx = (shape.props.scaleX ?? 1) * (shape.props.scale ?? 1),
    sy = (shape.props.scaleY ?? 1) * (shape.props.scale ?? 1);
  return (shape.props.segments ?? [])
    .flatMap((segment: any) =>
      segment.path
        ? decodeStroke(segment.path, segment.dim ?? 3)
        : (segment.points ?? []).map((p: any) => [p.x, p.y, p.z ?? 0.5]),
    )
    .map((p: number[]) => [p[0] * sx, p[1] * sy, p[2]]);
}
export function normalizeSnapshot(input: TLStoreSnapshot): TLStoreSnapshot {
  if (!input || !input.store || typeof input.store !== "object")
    throw new Error("Invalid board snapshot");
  const records: Record<string, TLRecord> = {};
  for (const [id, value] of Object.entries(input.store)) {
    if (!value || typeof value !== "object")
      throw new Error("Invalid board record");
    records[id] =
      value.typeName === "shape"
        ? {
            x: 0,
            y: 0,
            rotation: 0,
            parentId: "page:page",
            index: id,
            isLocked: false,
            opacity: 1,
            meta: {},
            props: {},
            ...structuredClone(value),
          }
        : structuredClone(value);
  }
  return { schema: SCHEMA, store: records };
}
