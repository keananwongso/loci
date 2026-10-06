"use client";
import { useEffect, useRef, useState } from "react";
import { type TLRecord, type TLStoreSnapshot } from "@/lib/whiteboard";
import { loadBoard } from "@/lib/whiteboard/persistence";
import {
  readWorkspaces,
  canvasKey,
  type Workspace,
} from "@/lib/storage/workspaces";
import { loadConversation } from "@/lib/storage/conversation";
import { getBlob } from "@/lib/storage/blobs";
import { loadLesson } from "@/lib/storage/lesson";
import {
  CloudError,
  createBoard,
  saveBoard,
  uploadFile,
} from "@/lib/storage/cloud";

/** Which of this browser's boards have gone to which account, so each is copied once. */
const doneKey = (userId: string) => `loci:device-import:${userId}`;
function readDone(userId: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(doneKey(userId)) || "{}");
  } catch {
    return {};
  }
}
function markDone(userId: string, localId: string, result: string) {
  try {
    localStorage.setItem(
      doneKey(userId),
      JSON.stringify({ ...readDone(userId), [localId]: result }),
    );
  } catch {}
}
export function pendingDeviceBoards(userId: string): Workspace[] {
  try {
    const done = readDone(userId);
    return readWorkspaces().boards.filter((b) => !done[b.id]);
  } catch {
    return [];
  }
}

export interface ImportSummary {
  imported: number;
  limitReached: boolean;
  failed: number;
}
let running = false;
/** Boards being copied right now; a canvas that mounts twice must not copy a board twice. */
const copying = new Set<string>();

/** Copy one device board, with its pages, conversation and replays, into the account. */
async function copyBoard(
  board: Workspace,
  snapshot: TLStoreSnapshot,
): Promise<"imported" | "empty"> {
  const records = Object.values(snapshot.store) as TLRecord[];
  const shapes = records.filter((r) => r.typeName === "shape");
  const conversation = await loadConversation(board.id).catch(() => []);
  if (!shapes.length && !conversation.length) return "empty";
  const cloud = await createBoard(board.name);
  const uploads: Promise<void>[] = [];
  const upload = async (key: string, blob: Blob | undefined) => {
    if (blob) uploads.push(uploadFile(key, blob, cloud.id));
  };
  for (const shape of records.filter(
    (r) => r.typeName === "shape" || r.typeName === "asset",
  )) {
    const key = (shape.props as { blobKey?: unknown }).blobKey;
    if (typeof key === "string" && key) await upload(key, await getBlob(key));
  }
  for (const turn of conversation) {
    if (!turn.lessonId) continue;
    const lesson = await loadLesson(turn.lessonId).catch(() => undefined);
    if (!lesson) continue;
    await upload(
      `lesson-${turn.lessonId}`,
      new Blob([JSON.stringify(lesson)], { type: "application/json" }),
    );
    for (const cue of lesson.cues)
      if (cue.audioKey) await upload(cue.audioKey, await getBlob(cue.audioKey));
  }
  // The board is saved once its material is in the account, so it never points at a missing page.
  await Promise.all(uploads);
  await saveBoard(cloud.id, { baseVersion: 0, snapshot, conversation });
  return "imported";
}

/**
 * After signing in, the boards made in this browser as a visitor move into the account. Each is
 * read directly from the versioned document store or legacy database, copied
 * with its material, and remembered so it is never copied twice.
 */
export function DeviceImport({
  userId,
  onProgress,
  onDone,
}: {
  userId: string;
  onProgress: (message: string) => void;
  onDone: (summary: ImportSummary) => void;
}) {
  const [queue] = useState(() => (running ? [] : pendingDeviceBoards(userId)));
  const [index, setIndex] = useState(0);
  const summary = useRef<ImportSummary>({
    imported: 0,
    limitReached: false,
    failed: 0,
  });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!queue.length) {
      onDone(summary.current);
      return;
    }
    running = true;
    return () => {
      running = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const board = queue[index];
  useEffect(() => {
    if (!board || summary.current.limitReached) return;
    onProgress(
      `Saving board ${index + 1} of ${queue.length} from this browser to your account…`,
    );
    if (copying.has(board.id) || readDone(userId)[board.id]) return;
    copying.add(board.id);
    loadBoard(canvasKey(board.id))
      .then((saved) =>
        copyBoard(board, saved?.snapshot ?? { schema: { loci: 1 }, store: {} }),
      )
      .then((result) => {
        markDone(userId, board.id, result);
        if (result === "imported") summary.current.imported++;
      })
      .catch((err) => {
        if (err instanceof CloudError && err.data.limitReached === "boards")
          summary.current.limitReached = true;
        else summary.current.failed++;
      })
      .finally(() => {
        copying.delete(board.id);
        if (index + 1 < queue.length && !summary.current.limitReached)
          setIndex(index + 1);
        else {
          running = false;
          onDone(summary.current);
        }
      });
  }, [board, index, queue.length, userId, onDone, onProgress]);
  return null;
}
