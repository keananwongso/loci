import {
  Box,
  Group2d,
  Rectangle2d,
  SCHEMA,
  createShapeId,
  identity,
  inverse,
  normalizeSnapshot,
  renderPlaintextFromRichText,
  strokePoints,
  toRichText,
  transform,
  unionBoxes,
  worldMatrix,
  type TLShape,
  type TLRecord,
  type TLStoreSnapshot,
  type TLCamera,
  type TLArrowBinding,
} from "./model";
import type { ReactNode } from "react";
export type ShapeInput<S extends TLShape = TLShape> = Partial<
  Omit<S, "props">
> & { id?: string; type?: string; props?: Partial<S["props"]> };
export type ListenerOptions = {
  scope?: "document" | "session" | "all";
  source?: "user" | "all";
};
type Listener = { fn: () => void; options: ListenerOptions };
export interface Renderer {
  type: string;
  defaults: Record<string, any>;
  geometry: (shape: TLShape) => Rectangle2d;
  component: (shape: TLShape) => ReactNode;
  aspect?: boolean;
  editable?: boolean;
  resizable?: boolean;
}
export class Editor {
  records: Record<string, TLRecord> = {};
  revision = 0;
  camera: TLCamera = { x: 0, y: 0, z: 1 };
  container: HTMLElement | null = null;
  assetSource?: Editor;
  resolveAsset(id: string): TLRecord | undefined {
    const asset = this.records[id];
    return asset?.props?.blobKey || asset?.props?.src?.startsWith("data:")
      ? asset
      : (this.assetSource?.resolveAsset(id) ?? asset);
  }
  readonly renderers = new Map<string, Renderer>();
  selected: string[] = [];
  editing: string | null = null;
  tool = "select";
  readonlyState = false;
  styles: Record<string, any> = {
    color: "black",
    size: "m",
    font: "draw",
    dash: "solid",
    geo: "rectangle",
  };
  private subscribers = new Set<() => void>();
  private listeners = new Set<Listener>();
  private undoStack: TLStoreSnapshot[] = [];
  private redoStack: TLStoreSnapshot[] = [];
  private marks = new Map<
    string,
    { snapshot: TLStoreSnapshot; undoLength: number }
  >();
  private historyBoundary = true;
  private batching = 0;
  private ignoreHistory = false;
  private dirty = false;
  private remote = false;
  private cameraFrame = 0;
  subscribe = (fn: () => void) => {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  };
  getVersion = () => this.revision;
  timers = { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) };
  store = {
    getStoreSnapshot: (_scope?: string): TLStoreSnapshot => ({
      schema: SCHEMA,
      store: { ...this.records },
    }),
    listen: (fn: () => void, options: ListenerOptions = {}) => {
      const l = { fn, options };
      this.listeners.add(l);
      return () => {
        this.listeners.delete(l);
      };
    },
    put: (records: TLRecord[]) => {
      this.before();
      for (const r of records) this.records = { ...this.records, [r.id]: r };
      this.changed();
    },
    remove: (ids: string[]) => {
      this.before();
      const next = { ...this.records };
      for (const id of ids) delete next[id];
      this.records = next;
      this.changed();
    },
    mergeRemoteChanges: (fn: () => void) => {
      const before = this.remote;
      this.remote = true;
      try {
        this.run(fn, { history: "ignore" });
      } finally {
        this.remote = before;
      }
    },
  };
  private historySnapshot() {
    return {
      schema: SCHEMA,
      store: Object.fromEntries(
        Object.entries(this.records).filter(
          ([, r]) => r.type !== "loci-region",
        ),
      ),
    };
  }
  private before() {
    if (!this.ignoreHistory && this.historyBoundary) {
      this.undoStack.push(this.historySnapshot());
      this.redoStack = [];
      this.historyBoundary = false;
    }
  }
  private changed() {
    if (this.batching) {
      this.dirty = true;
      return;
    }
    this.emit("document");
  }
  private emit(scope: "document" | "session") {
    this.revision++;
    for (const fn of [...this.subscribers]) fn();
    for (const l of [...this.listeners])
      if (
        (!l.options.scope ||
          l.options.scope === "all" ||
          l.options.scope === scope) &&
        (!this.remote || l.options.source !== "user")
      )
        l.fn();
  }
  run(fn: () => void, options?: { history?: "ignore" | "record" }) {
    const ignored = this.ignoreHistory;
    this.ignoreHistory = ignored || options?.history === "ignore";
    this.batching++;
    try {
      fn();
    } finally {
      this.batching--;
      this.ignoreHistory = ignored;
      if (!this.batching && this.dirty) {
        this.dirty = false;
        this.emit("document");
      }
    }
    return this;
  }
  loadSnapshot(snapshot: TLStoreSnapshot) {
    const incoming = normalizeSnapshot(snapshot).store;
    for (const asset of Object.values(incoming)) {
      const cached = this.records[asset.id];
      if (
        asset.typeName === "asset" &&
        !asset.props?.blobKey &&
        cached?.props?.blobKey &&
        asset.props?.src === cached.props.src
      )
        incoming[asset.id] = {
          ...asset,
          props: { ...asset.props, blobKey: cached.props.blobKey },
        };
    }
    this.records = incoming;
    const page = Object.values(this.records).find((r) => r.typeName === "page");
    this.pageId = page?.id ?? "page:page";
    this.selected = [];
    this.clearHistory();
    this.emit("document");
    return this;
  }
  pageId = "page:page";
  setCurrentPage(id: string) {
    this.pageId = id;
    this.selected = [];
    this.emit("session");
    return this;
  }
  markHistoryStoppingPoint(_name?: string) {
    const id = crypto.randomUUID();
    this.marks.set(id, {
      snapshot: this.historySnapshot(),
      undoLength: this.undoStack.length,
    });
    this.historyBoundary = true;
    return id;
  }
  bailToMark(id: string) {
    const mark = this.marks.get(id);
    if (mark) {
      this.records = { ...mark.snapshot.store };
      this.undoStack.length = mark.undoLength;
      this.redoStack = [];
      this.historyBoundary = true;
      this.emit("document");
    }
    return this;
  }
  clearHistory() {
    this.undoStack = [];
    this.redoStack = [];
    this.marks.clear();
    this.historyBoundary = true;
    return this;
  }
  undo() {
    const snapshot = this.undoStack.pop();
    if (snapshot) {
      this.redoStack.push(this.historySnapshot());
      this.records = { ...snapshot.store };
      this.selected = this.selected.filter((id) => this.records[id]);
      this.editing = null;
      this.historyBoundary = true;
      this.emit("document");
    }
    return this;
  }
  redo() {
    const snapshot = this.redoStack.pop();
    if (snapshot) {
      this.undoStack.push(this.historySnapshot());
      this.records = { ...snapshot.store };
      this.historyBoundary = true;
      this.emit("document");
    }
    return this;
  }
  createShape<S extends TLShape = TLShape>(input: ShapeInput<S>) {
    if (this.readonlyState && !this.remote) return this;
    const type = input.type ?? "geo";
    const id = input.id ?? createShapeId();
    const defaults = this.renderers.get(type)?.defaults ?? nativeDefaults(type);
    if (type !== "loci-region") this.before();
    const shape = {
      id,
      typeName: "shape",
      type,
      x: 0,
      y: 0,
      rotation: 0,
      parentId: this.pageId,
      index: `z${String(Object.keys(this.records).length).padStart(9, "0")}`,
      isLocked: false,
      opacity: 1,
      meta: {},
      ...input,
      props: {
        ...defaults,
        ...(this.renderers.has(type) ? {} : this.styles),
        ...input.props,
      },
    } as TLShape;
    this.records = { ...this.records, [id]: shape };
    this.changed();
    return this;
  }
  updateShape<S extends TLShape = TLShape>(input: ShapeInput<S>) {
    if (this.readonlyState && !this.remote) return this;
    const prev = this.records[input.id ?? ""];
    if (!prev) return this;
    if (prev.type !== "loci-region") this.before();
    this.records = {
      ...this.records,
      [prev.id]: {
        ...prev,
        ...input,
        props: { ...prev.props, ...input.props },
        meta: { ...prev.meta, ...input.meta },
      },
    };
    this.changed();
    return this;
  }
  /** Resize descendants in parent-local space so annotations stay attached to their material. */
  resizeShape(
    id: string,
    width: number,
    height: number,
    position?: { x: number; y: number },
  ) {
    const shape = this.getShape(id);
    if (!shape) return this;
    const bounds = this.getShapeGeometry(shape).bounds,
      sx = width / Math.max(1, bounds.w),
      sy = height / Math.max(1, bounds.h);
    this.run(() => {
      const scaleChildren = (parentId: string) => {
        for (const child of Object.values(this.records).filter(
          (r) => r.typeName === "shape" && r.parentId === parentId,
        ) as TLShape[]) {
          const props = { ...child.props };
          if (
            typeof props.w === "number" &&
            !["text", "note"].includes(child.type)
          )
            props.w *= sx;
          if (
            typeof props.h === "number" &&
            !["text", "note"].includes(child.type)
          )
            props.h *= sy;
          if (child.type === "draw" || child.type === "highlight") {
            props.scaleX = (props.scaleX ?? 1) * sx;
            props.scaleY = (props.scaleY ?? 1) * sy;
          }
          if (child.type === "text" || child.type === "note")
            props.scale = (props.scale ?? 1) * Math.min(sx, sy);
          if (child.type === "arrow") {
            for (const end of ["start", "end"])
              if (props[end])
                props[end] = { x: props[end].x * sx, y: props[end].y * sy };
          }
          this.updateShape({
            id: child.id,
            x: child.x * sx,
            y: child.y * sy,
            props,
          });
          scaleChildren(child.id);
        }
      };
      scaleChildren(id);
      this.updateShape({
        id,
        ...position,
        ...(shape.type === "group" ? {} : { props: { w: width, h: height } }),
      });
    });
    return this;
  }
  updateShapes(shapes: ShapeInput[]) {
    this.run(() => shapes.forEach((s) => this.updateShape(s)));
    return this;
  }
  animateShape(shape: ShapeInput, _options?: unknown) {
    return this.updateShape(shape);
  }
  deleteShapes(ids: string[]) {
    if (this.readonlyState && !this.remote) return this;
    const remove = new Set(ids);
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of Object.values(this.records))
        if (
          (r.typeName === "shape" && remove.has(r.parentId)) ||
          (r.typeName === "binding" &&
            (remove.has(r.fromId) || remove.has(r.toId)))
        )
          if (!remove.has(r.id)) {
            remove.add(r.id);
            grew = true;
          }
    }
    const onlyRegions = [...remove].every(
      (id) => !this.records[id] || this.records[id].type === "loci-region",
    );
    this.run(
      () => this.store.remove([...remove]),
      onlyRegions ? { history: "ignore" } : undefined,
    );
    this.select(...this.selected.filter((id) => !remove.has(id)));
    return this;
  }
  groupShapes(ids = this.selected) {
    if (this.getIsReadonly()) return this;
    const chosen = new Set(ids);
    const shapes = ids
      .map((id) => this.getShape(id))
      .filter(
        (s): s is TLShape =>
          !!s &&
          !this.isShapeOrAncestorLocked(s) &&
          !this.getShapeAncestors(s).some((p) => chosen.has(p.id)),
      );
    if (shapes.length < 2) return this;
    const bounds = unionBoxes(shapes.map((s) => this.getShapePageBounds(s)!)),
      id = createShapeId();
    this.markHistoryStoppingPoint("group");
    this.run(() => {
      this.createShape({ id, type: "group", x: bounds.x, y: bounds.y });
      for (const shape of shapes) {
        const m = worldMatrix(shape, this.records);
        this.updateShape({
          id: shape.id,
          parentId: id,
          x: m[4] - bounds.x,
          y: m[5] - bounds.y,
          rotation: Math.atan2(m[1], m[0]),
        });
      }
    });
    this.select(id);
    return this;
  }
  ungroupShapes(ids = this.selected) {
    if (this.getIsReadonly()) return this;
    const selected: string[] = [];
    this.markHistoryStoppingPoint("ungroup");
    this.run(() => {
      for (const id of ids) {
        const shape = this.getShape(id);
        if (shape?.type !== "group") continue;
        for (const child of this.getCurrentPageShapes().filter(
          (s) => s.parentId === id,
        )) {
          const m = worldMatrix(child, this.records);
          this.updateShape({
            id: child.id,
            parentId: this.pageId,
            x: m[4],
            y: m[5],
            rotation: Math.atan2(m[1], m[0]),
          });
          selected.push(child.id);
        }
        this.store.remove([id]);
      }
    });
    this.select(...selected);
    return this;
  }
  copyRecords(): TLRecord[] {
    const ids = new Set(this.selected);
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of this.getCurrentPageShapes())
        if (ids.has(s.parentId) && !ids.has(s.id)) {
          ids.add(s.id);
          grew = true;
        }
    }
    const records: TLRecord[] = [];
    for (const s of this.getCurrentPageShapesSorted().filter((s) =>
      ids.has(s.id),
    )) {
      const copy = structuredClone(s);
      if (!ids.has(s.parentId)) {
        const m = worldMatrix(s, this.records);
        copy.parentId = this.pageId;
        copy.x = m[4];
        copy.y = m[5];
        copy.rotation = Math.atan2(m[1], m[0]);
      }
      if (s.type === "arrow") {
        const ends = this.arrowEnds(s);
        copy.props = { ...copy.props, ...ends };
      }
      records.push(copy);
      if (s.props.assetId && this.records[s.props.assetId])
        records.push(structuredClone(this.records[s.props.assetId]));
    }
    records.push(
      ...Object.values(this.records)
        .filter(
          (r) =>
            r.typeName === "binding" && ids.has(r.fromId) && ids.has(r.toId),
        )
        .map((r) => structuredClone(r)),
    );
    return records;
  }
  pasteRecords(records: TLRecord[]) {
    if (this.getIsReadonly()) return this;
    const normalized = Object.values(
      normalizeSnapshot({
        schema: SCHEMA,
        store: Object.fromEntries(records.map((r) => [r.id, r])),
      }).store,
    );
    const ids = new Map(
      normalized
        .filter((r) => r.typeName === "shape" || r.typeName === "binding")
        .map((r) => [
          r.id,
          r.typeName === "shape"
            ? createShapeId()
            : `binding:${crypto.randomUUID()}`,
        ]),
    );
    const selected: string[] = [];
    this.markHistoryStoppingPoint("paste");
    this.run(() => {
      for (const r of normalized) {
        if (r.typeName === "asset") {
          if (!this.records[r.id]) this.store.put([r]);
          continue;
        }
        if (r.typeName === "binding") {
          if (ids.has(r.fromId) && ids.has(r.toId))
            this.store.put([
              {
                ...r,
                id: ids.get(r.id)!,
                fromId: ids.get(r.fromId)!,
                toId: ids.get(r.toId)!,
              },
            ]);
          continue;
        }
        if (r.typeName !== "shape") continue;
        const root = !ids.has(r.parentId),
          meta = { ...r.meta };
        delete meta.author;
        delete meta.turn;
        const id = ids.get(r.id)!;
        this.createShape({
          ...r,
          id,
          parentId: ids.get(r.parentId) ?? this.pageId,
          x: r.x + (root ? 32 / this.camera.z : 0),
          y: r.y + (root ? 32 / this.camera.z : 0),
          index: `z${String(Object.keys(this.records).length).padStart(9, "0")}`,
          meta,
        });
        if (root) selected.push(id);
      }
    });
    this.select(...selected);
    return this;
  }
  createBindings<B extends TLArrowBinding>(bindings: Array<Partial<B>>) {
    this.store.put(
      bindings.map(
        (b) =>
          ({
            id: `binding:${crypto.randomUUID()}`,
            typeName: "binding",
            ...b,
          }) as TLRecord,
      ),
    );
    return this;
  }
  getBindingsFromShape(shape: string | TLShape, _type?: string) {
    const id = typeof shape === "string" ? shape : shape.id;
    return Object.values(this.records).filter(
      (r) => r.typeName === "binding" && r.fromId === id,
    ) as TLArrowBinding[];
  }
  getShape<S extends TLShape = TLShape>(id: string | TLShape): S | undefined {
    return this.records[typeof id === "string" ? id : id.id] as S | undefined;
  }
  getShapeParent(shape: TLShape) {
    return this.getShape(shape.parentId);
  }
  getShapeAncestors(shape: TLShape | string) {
    const parents: TLShape[] = [];
    let current = this.getShape(shape);
    const seen = new Set<string>();
    while (current && this.getShapeParent(current) && !seen.has(current.id)) {
      seen.add(current.id);
      current = this.getShapeParent(current);
      if (current) parents.push(current);
    }
    return parents;
  }
  getCurrentPageShapes() {
    return Object.values(this.records).filter(
      (r) =>
        r.typeName === "shape" &&
        (r.parentId === this.pageId ||
          this.getShapeAncestors(r as TLShape).at(-1)?.parentId ===
            this.pageId),
    ) as TLShape[];
  }
  getCurrentPageShapesSorted() {
    return this.getCurrentPageShapes().sort((a, b) =>
      a.index.localeCompare(b.index),
    );
  }
  getCurrentPageShapeIds() {
    return new Set(this.getCurrentPageShapes().map((s) => s.id));
  }
  getSelectedShapeIds() {
    return this.selected;
  }
  getSelectedShapes() {
    return this.selected
      .map((id) => this.getShape(id))
      .filter((s): s is TLShape => !!s);
  }
  getOnlySelectedShapeId() {
    return this.selected.length === 1 ? this.selected[0] : null;
  }
  select(...ids: string[]) {
    this.selected = ids;
    this.emit("session");
    return this;
  }
  selectNone() {
    return this.select();
  }
  setEditingShape(id: string | null) {
    this.editing = id;
    this.emit("session");
    return this;
  }
  getEditingShapeId() {
    return this.editing;
  }
  setCurrentTool(id: string) {
    this.tool = id.split(".")[0];
    this.setEditingShape(null);
    return this;
  }
  getCurrentToolId() {
    return this.tool;
  }
  setStyleForNextShapes(style: string, value: any) {
    this.styles = { ...this.styles, [style]: value };
    this.emit("session");
    return this;
  }
  getIsReadonly() {
    return this.readonlyState;
  }
  getInstanceState() {
    return { isReadonly: this.readonlyState };
  }
  updateInstanceState(state: { isReadonly?: boolean }) {
    if (state.isReadonly !== undefined) this.readonlyState = state.isReadonly;
    this.emit("session");
    return this;
  }
  isShapeOrAncestorLocked(shape: TLShape) {
    return (
      shape.isLocked || this.getShapeAncestors(shape).some((p) => p.isLocked)
    );
  }
  focus() {
    this.container?.focus();
    return this;
  }
  getContainer() {
    if (!this.container) throw new Error("Canvas is not mounted");
    return this.container;
  }
  getViewportScreenBounds() {
    const r = this.container?.getBoundingClientRect();
    return new Box(r?.x ?? 0, r?.y ?? 0, r?.width ?? 1000, r?.height ?? 800);
  }
  getViewportPageBounds() {
    const b = this.getViewportScreenBounds();
    return new Box(
      -this.camera.x,
      -this.camera.y,
      b.w / this.camera.z,
      b.h / this.camera.z,
    );
  }
  getCamera() {
    return this.camera;
  }
  getZoomLevel() {
    return this.camera.z;
  }
  setCamera(
    camera: TLCamera,
    options?: { animation?: { duration: number }; immediate?: boolean },
  ) {
    if (this.cameraFrame && typeof cancelAnimationFrame !== "undefined")
      cancelAnimationFrame(this.cameraFrame);
    const z = Math.max(0.05, Math.min(8, camera.z));
    const target = { ...camera, z };
    if (
      options?.animation?.duration &&
      typeof requestAnimationFrame !== "undefined"
    ) {
      const from = this.camera,
        start = performance.now(),
        duration = options.animation.duration;
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / duration),
          p = 1 - (1 - t) ** 3;
        this.camera = {
          x: from.x + (target.x - from.x) * p,
          y: from.y + (target.y - from.y) * p,
          z: from.z + (target.z - from.z) * p,
        };
        this.emit("session");
        if (t < 1) this.cameraFrame = requestAnimationFrame(step);
        else this.cameraFrame = 0;
      };
      this.cameraFrame = requestAnimationFrame(step);
    } else {
      this.camera = target;
      this.emit("session");
    }
    return this;
  }
  pageToViewport(p: { x: number; y: number }) {
    return {
      x: (p.x + this.camera.x) * this.camera.z,
      y: (p.y + this.camera.y) * this.camera.z,
    };
  }
  screenToPage(p: { x: number; y: number }) {
    const b = this.getViewportScreenBounds();
    return {
      x: (p.x - b.x) / this.camera.z - this.camera.x,
      y: (p.y - b.y) / this.camera.z - this.camera.y,
    };
  }
  zoomToBounds(
    b: { x: number; y: number; w: number; h: number },
    options?: {
      animation?: { duration: number };
      targetZoom?: number;
      inset?: number;
    },
  ) {
    const v = this.getViewportScreenBounds(),
      pad = options?.inset ?? 80,
      z =
        options?.targetZoom ??
        Math.min(
          1,
          (v.w - pad * 2) / Math.max(1, b.w),
          (v.h - pad * 2) / Math.max(1, b.h),
        );
    return this.setCamera(
      { x: v.w / z / 2 - b.x - b.w / 2, y: v.h / z / 2 - b.y - b.h / 2, z },
      options,
    );
  }
  getShapePageTransform(id: string) {
    const shape = this.getShape(id),
      m = shape ? worldMatrix(shape, this.records) : identity;
    return {
      applyToPoint: (p: { x: number; y: number }) => transform(m, p),
      matrix: m,
    };
  }
  getShapeGeometry(shape: TLShape | string): Rectangle2d {
    const s = this.getShape(shape);
    if (!s) return new Rectangle2d({ width: 0, height: 0, isFilled: true });
    const custom = this.renderers.get(s.type);
    if (custom) return custom.geometry(s);
    const p = s.props;
    if (s.type === "text" || s.type === "note") {
      const el = this.container?.querySelector<HTMLElement>(
        `[data-shape-id="${CSS.escape(s.id)}"] .loci-rich-text`,
      );
      const scale = p.scale ?? 1;
      return new Rectangle2d({
        width: el
          ? el.offsetWidth * scale
          : (p.w ??
            Math.max(
              20,
              renderPlaintextFromRichText(p.richText).length *
                fontSize(p.size) *
                0.55,
            )),
        height: el
          ? el.offsetHeight * scale
          : (p.h ??
            fontSize(p.size) *
              1.4 *
              Math.max(
                1,
                renderPlaintextFromRichText(p.richText).split("\n").length,
              )),
        isFilled: true,
      });
    }
    if (s.type === "arrow") {
      const ends = this.arrowEnds(s);
      const b = new Box(
        Math.min(ends.start.x, ends.end.x),
        Math.min(ends.start.y, ends.end.y),
        Math.abs(ends.end.x - ends.start.x) || 1,
        Math.abs(ends.end.y - ends.start.y) || 1,
      );
      const pad = 20 + Math.abs(p.bend ?? 0);
      const g = new Rectangle2d({
        width: b.w + pad * 2,
        height: b.h + pad * 2,
        isFilled: false,
        x: b.x - pad,
        y: b.y - pad,
      });
      const label = renderPlaintextFromRichText(p.richText);
      if (label) {
        const l = new Rectangle2d({
          x: (ends.start.x + ends.end.x) / 2 - label.length * 7,
          y: (ends.start.y + ends.end.y) / 2 - 14,
          width: label.length * 14,
          height: 28,
          isFilled: true,
        });
        l.isLabel = true;
        const group = new Group2d([g, l]);
        group.bounds = unionBoxes([g.bounds, l.bounds]);
        return group;
      }
      return g;
    }
    if (s.type === "draw" || s.type === "highlight") {
      try {
        const pts = strokePoints(s);
        return new Rectangle2d({
          x: Math.min(0, ...pts.map((p) => p[0])) - 4,
          y: Math.min(0, ...pts.map((p) => p[1])) - 4,
          width:
            Math.max(1, ...pts.map((p) => p[0])) -
            Math.min(0, ...pts.map((p) => p[0])) +
            8,
          height:
            Math.max(1, ...pts.map((p) => p[1])) -
            Math.min(0, ...pts.map((p) => p[1])) +
            8,
          isFilled: false,
        });
      } catch {
        return new Rectangle2d({ width: 100, height: 100, isFilled: false });
      }
    }
    if (s.type === "line") {
      const pts = Object.values(p.points ?? {}) as { x: number; y: number }[];
      const x = Math.min(0, ...pts.map((p) => p.x)),
        y = Math.min(0, ...pts.map((p) => p.y));
      return new Rectangle2d({
        x,
        y,
        width: Math.max(1, ...pts.map((p) => p.x)) - x,
        height: Math.max(1, ...pts.map((p) => p.y)) - y,
        isFilled: false,
      });
    }
    if (s.type === "group") {
      const children = this.getCurrentPageShapes().filter(
        (c) => c.parentId === s.id,
      );
      const boxes = children.map((child) => {
        const b = this.getShapeGeometry(child).bounds,
          c = Math.cos(child.rotation),
          sn = Math.sin(child.rotation);
        const corners = [
          { x: b.x, y: b.y },
          { x: b.maxX, y: b.y },
          { x: b.x, y: b.maxY },
          { x: b.maxX, y: b.maxY },
        ].map((p) => ({
          x: child.x + c * p.x - sn * p.y,
          y: child.y + sn * p.x + c * p.y,
        }));
        const x = Math.min(...corners.map((p) => p.x)),
          y = Math.min(...corners.map((p) => p.y));
        return new Box(
          x,
          y,
          Math.max(...corners.map((p) => p.x)) - x,
          Math.max(...corners.map((p) => p.y)) - y,
        );
      });
      const b = unionBoxes(boxes);
      return new Rectangle2d({
        x: b.x,
        y: b.y,
        width: b.w,
        height: b.h,
        isFilled: false,
      });
    }
    return new Rectangle2d({
      width: p.w ?? 100,
      height: (p.h ?? 100) + (p.growY ?? 0),
      isFilled: true,
    });
  }
  getShapePageBounds(shape: TLShape | string) {
    const s = this.getShape(shape);
    if (!s) return undefined;
    const b = this.getShapeGeometry(s).bounds,
      m = worldMatrix(s, this.records),
      corners = [
        { x: b.x, y: b.y },
        { x: b.maxX, y: b.y },
        { x: b.x, y: b.maxY },
        { x: b.maxX, y: b.maxY },
      ].map((p) => transform(m, p));
    const x = Math.min(...corners.map((p) => p.x)),
      y = Math.min(...corners.map((p) => p.y));
    return new Box(
      x,
      y,
      Math.max(...corners.map((p) => p.x)) - x,
      Math.max(...corners.map((p) => p.y)) - y,
    );
  }
  getSelectionPageBounds() {
    const boxes = this.getSelectedShapes()
      .map((s) => this.getShapePageBounds(s))
      .filter((b): b is Box => !!b);
    return boxes.length ? unionBoxes(boxes) : null;
  }
  getShapeAtPoint(
    point: { x: number; y: number },
    options?: { exclude?: string[]; margin?: number; hitInside?: boolean },
  ) {
    const tolerance = options?.margin ?? 6 / this.camera.z;
    const nearLine = (
      p: { x: number; y: number },
      points: { x: number; y: number }[],
      width: number,
    ) =>
      points.some((a, i) => {
        const b = points[i + 1] ?? a,
          dx = b.x - a.x,
          dy = b.y - a.y,
          d = dx * dx + dy * dy,
          t = d
            ? Math.max(
                0,
                Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d),
              )
            : 0;
        return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) <= width;
      });
    return this.getCurrentPageShapesSorted()
      .reverse()
      .find((shape) => {
        if (shape.type === "group" || options?.exclude?.includes(shape.id))
          return false;
        const bounds = this.getShapePageBounds(shape)!;
        if (
          !new Box(
            bounds.x - tolerance,
            bounds.y - tolerance,
            bounds.w + tolerance * 2,
            bounds.h + tolerance * 2,
          ).containsPoint(point)
        )
          return false;
        const local = transform(
            inverse(worldMatrix(shape, this.records)),
            point,
          ),
          size =
            { s: 2, m: 3.5, l: 5, xl: 8 }[shape.props.size as string] ?? 3.5;
        if (shape.type === "draw" || shape.type === "highlight") {
          try {
            return nearLine(
              local,
              strokePoints(shape).map((p) => ({ x: p[0], y: p[1] })),
              tolerance + size * (shape.type === "highlight" ? 3 : 1),
            );
          } catch {
            return true;
          }
        }
        if (shape.type === "line")
          return nearLine(
            local,
            Object.values(shape.props.points ?? {}),
            tolerance + size,
          );
        if (shape.type === "arrow") {
          const { start, end } = this.arrowEnds(shape),
            dx = end.x - start.x,
            dy = end.y - start.y,
            len = Math.hypot(dx, dy) || 1,
            bend = shape.props.bend ?? 0,
            c = {
              x: (start.x + end.x) / 2 - (dy / len) * bend,
              y: (start.y + end.y) / 2 + (dx / len) * bend,
            };
          const points = Array.from({ length: 33 }, (_, i) => {
            const t = i / 32;
            return {
              x: (1 - t) ** 2 * start.x + 2 * (1 - t) * t * c.x + t * t * end.x,
              y: (1 - t) ** 2 * start.y + 2 * (1 - t) * t * c.y + t * t * end.y,
            };
          });
          return (
            nearLine(local, points, tolerance + size) ||
            (this.getShapeGeometry(shape) instanceof Group2d &&
              (this.getShapeGeometry(shape) as Group2d).children.some(
                (g) => g.isLabel && g.bounds.containsPoint(local),
              ))
          );
        }
        return this.getShapeGeometry(shape).bounds.containsPoint(local);
      });
  }
  arrowEnds(shape: TLShape) {
    const ends = {
      start: { ...(shape.props.start ?? { x: 0, y: 0 }) },
      end: { ...(shape.props.end ?? { x: 100, y: 100 }) },
    };
    for (const bind of this.getBindingsFromShape(shape.id)) {
      const target = this.getShape(bind.toId);
      if (!target) continue;
      const b = this.getShapeGeometry(target).bounds,
        a = bind.props.normalizedAnchor;
      const page = transform(worldMatrix(target, this.records), {
        x: b.x + a.x * b.w,
        y: b.y + a.y * b.h,
      });
      ends[bind.props.terminal] = transform(
        inverse(worldMatrix(shape, this.records)),
        page,
      );
    }
    return ends;
  }
  externalFiles: ((info: { files: File[] }) => Promise<void>) | undefined;
  registerExternalContentHandler(
    _type: string,
    fn: (info: { files: File[] }) => Promise<void>,
  ) {
    this.externalFiles = fn;
    return this;
  }
  async toImageDataUrl(
    shapes: (string | TLShape)[],
    options: {
      bounds?: { x: number; y: number; w: number; h: number };
      [key: string]: any;
    } = {},
  ) {
    const ids = shapes.map((s) => (typeof s === "string" ? s : s.id));
    const { toPng, toJpeg } = await import("html-to-image");
    const layer = this.container?.querySelector<HTMLElement>(
      ".loci-capture-layer",
    );
    if (!layer) throw new Error("Canvas capture unavailable");
    const b =
      options.bounds ??
      unionBoxes(
        ids
          .map((id) => this.getShapePageBounds(id))
          .filter((b): b is Box => !!b),
      );
    const selected = new Set(ids);
    const scale = Math.min(1, 1600 / Math.max(b.w, b.h, 1));
    const url = await (options.format === "jpeg" ? toJpeg : toPng)(layer, {
      width: Math.max(1, b.w),
      height: Math.max(1, b.h),
      pixelRatio: scale,
      backgroundColor: "#fdfcfc",
      style: {
        transform: `translate(${-b.x}px, ${-b.y}px)`,
        transformOrigin: "0 0",
      },
      filter: (node) =>
        !(node instanceof HTMLElement) ||
        (!node.matches(
          ".react-flow__resize-control,.react-flow__nodesselection,.loci-text-editor",
        ) &&
          (!node.classList.contains("loci-shape") ||
            selected.has(node.dataset.shapeId ?? ""))),
    });
    return { url, width: b.w * scale, height: b.h * scale };
  }
}
export function fontSize(size: string) {
  return { s: 20, m: 28, l: 36, xl: 44 }[size] ?? 28;
}
function nativeDefaults(type: string): Record<string, any> {
  switch (type) {
    case "text":
      return { richText: toRichText(""), w: 200, autoSize: true, scale: 1 };
    case "arrow":
      return {
        start: { x: 0, y: 0 },
        end: { x: 100, y: 100 },
        bend: 0,
        arrowheadStart: "none",
        arrowheadEnd: "arrow",
        richText: toRichText(""),
      };
    case "draw":
    case "highlight":
      return { segments: [], scale: 1, scaleX: 1, scaleY: 1, isComplete: true };
    default:
      return {
        w: 100,
        h: 100,
        geo: "rectangle",
        richText: toRichText(""),
        fill: "none",
      };
  }
}
