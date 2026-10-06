"use client";
import React, { createContext, useContext, useSyncExternalStore } from "react";
import { Editor } from "./editor";
import { Rectangle2d, type TLShape } from "./model";
export const EditorContext = createContext<Editor | null>(null);
let atomVersion = 0;
const atomListeners = new Set<() => void>();
export function atom<T>(_name: string, initial: T) {
  let value = initial;
  const set = (next: T) => {
    value = next;
    atomVersion++;
    for (const fn of atomListeners) fn();
  };
  return {
    get: () => value,
    set,
    update: (fn: (value: T) => T) => set(fn(value)),
  };
}
const subscribeAtoms = (fn: () => void) => {
  atomListeners.add(fn);
  return () => {
    atomListeners.delete(fn);
  };
};
export function useEditor() {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error("Canvas context is missing");
  return editor;
}
const noopSubscribe = () => () => {};
export function useValue<T>(_name: string, get: () => T, _deps?: unknown[]) {
  const editor = useContext(EditorContext);
  useSyncExternalStore(
    editor?.subscribe ?? noopSubscribe,
    editor?.getVersion ?? (() => 0),
    () => 0,
  );
  useSyncExternalStore(
    subscribeAtoms,
    () => atomVersion,
    () => 0,
  );
  return get();
}
export const useIsEditing = (id: string) => {
  const editor = useEditor();
  return useValue("editing", () => editor.getEditingShapeId() === id, [
    editor,
    id,
  ]);
};
export function HTMLContainer(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        ...props.style,
      }}
    />
  );
}
export const stopEventPropagation = (event: { stopPropagation: () => void }) =>
  event.stopPropagation();
export type RecordProps<S extends TLShape> = {
  [K in keyof S["props"]]: unknown;
};
export interface TLResizeInfo<S extends TLShape> {
  scaleX: number;
  scaleY: number;
  initialShape: S;
  newPoint?: { x: number; y: number };
  handle?: string;
}
export function resizeBox<S extends TLShape>(shape: S, info: TLResizeInfo<S>) {
  return {
    id: shape.id,
    type: shape.type,
    props: {
      w: Math.max(1, shape.props.w * Math.abs(info.scaleX)),
      h: Math.max(1, shape.props.h * Math.abs(info.scaleY)),
    },
  };
}
/** Renderer interface retained to reuse Loci's components; it has no SDK dependency. */
export class ShapeUtil<S extends TLShape = TLShape> {
  static type: string;
  static props: Record<string, unknown>;
  constructor(public editor: Editor) {}
  getDefaultProps(): S["props"] {
    return {} as S["props"];
  }
  getGeometry(shape: S) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }
  component(_shape: S): React.ReactNode {
    return null;
  }
  isAspectRatioLocked() {
    return false;
  }
  canEdit() {
    return false;
  }
  canResize() {
    return true;
  }
  hideRotateHandle() {
    return false;
  }
  canReceiveNewChildrenOfType(_shape: S, _type: string) {
    return false;
  }
  onResize(shape: S, info: TLResizeInfo<S>) {
    return resizeBox(shape, info);
  }
  getText(_shape: S): string | undefined {
    return "";
  }
  toSvg(_shape: S): React.ReactNode | Promise<React.ReactNode> {
    return null;
  }
}
export const GeoShapeGeoStyle = "geo";
