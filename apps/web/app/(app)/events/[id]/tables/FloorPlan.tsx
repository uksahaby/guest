"use client";

import { useCallback, useRef, useState } from "react";

/**
 * The room, with the tables where the organiser put them.
 *
 * Positions are percentages of the room, not pixels, so the same plan is
 * right on a laptop, a phone and the projector at the venue. A drag writes
 * the new position on drop — not on every pointer move, which would be a
 * request per pixel over Nigerian mobile data.
 *
 * Pointer events rather than mouse events: the organiser doing the seating
 * chart on a tablet the night before is a real person.
 */

export type PlanTable = {
  id: string;
  name: string;
  kind: string | null;
  capacity: number;
  assigned: number;
  is_active: boolean;
  pos_x: number | null;
  pos_y: number | null;
};

/** Tables nobody has placed yet, laid out so they are reachable. */
function seed(i: number): { x: number; y: number } {
  const perRow = 5;
  return {
    x: 12 + (i % perRow) * 19,
    y: 16 + Math.floor(i / perRow) * 22,
  };
}

function tone(t: PlanTable): string {
  if (!t.is_active) return "inactive";
  if (t.assigned >= t.capacity) return "full";
  if (t.assigned === 0) return "empty";
  return "part";
}

export function FloorPlan({ tables }: { tables: PlanTable[] }) {
  const room = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>(() =>
    Object.fromEntries(
      tables.map((t, i) => {
        const s = seed(i);
        return [
          t.id,
          {
            x: t.pos_x === null ? s.x : Number(t.pos_x),
            y: t.pos_y === null ? s.y : Number(t.pos_y),
          },
        ];
      }),
    ),
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [saving, setSaving] = useState<string | null>(null);

  const move = useCallback((id: string, clientX: number, clientY: number) => {
    const box = room.current?.getBoundingClientRect();
    if (!box) return;
    const x = Math.max(4, Math.min(96, ((clientX - box.left) / box.width) * 100));
    const y = Math.max(6, Math.min(94, ((clientY - box.top) / box.height) * 100));
    setPos((p) => ({ ...p, [id]: { x, y } }));
  }, []);

  const drop = useCallback(
    async (id: string) => {
      setDragging(null);
      const p = pos[id];
      if (!p) return;
      setSaving(id);
      try {
        await fetch(`/api/tables/${id}/plan`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pos_x: p.x, pos_y: p.y }),
        });
      } finally {
        setSaving(null);
      }
    },
    [pos],
  );

  return (
    <>
      <div className="plan-bar">
        <span className="sub sm">Drag tables to move them around</span>
        <div className="plan-zoom">
          <button type="button" aria-label="Zoom out"
            onClick={() => setZoom((z) => Math.max(60, z - 10))}>
            −
          </button>
          <span>{zoom}%</span>
          <button type="button" aria-label="Zoom in"
            onClick={() => setZoom((z) => Math.min(160, z + 10))}>
            +
          </button>
        </div>
      </div>

      <div className="plan-scroll">
        <div
          className="room"
          ref={room}
          style={{ width: `${zoom}%` }}
          onPointerMove={(e) => dragging && move(dragging, e.clientX, e.clientY)}
          onPointerUp={() => dragging && drop(dragging)}
          onPointerLeave={() => dragging && drop(dragging)}
        >
          {tables.map((t) => {
            const p = pos[t.id] ?? { x: 50, y: 50 };
            return (
              <button
                key={t.id}
                type="button"
                className={`ptable ${tone(t)}${dragging === t.id ? " dragging" : ""}`}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                onPointerDown={(e) => {
                  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                  setDragging(t.id);
                }}
                title={`${t.name}${t.kind ? ` · ${t.kind}` : ""} — ${t.assigned} of ${t.capacity}`}
              >
                <span className="pt-n">{t.name.replace(/^Table\s*/i, "")}</span>
                <span className="pt-seats">
                  {t.is_active ? `${t.assigned}/${t.capacity}` : "Inactive"}
                </span>
                {saving === t.id && <span className="pt-saving" aria-hidden="true" />}
              </button>
            );
          })}
          <div className="room-entrance">ENTRANCE</div>
        </div>
      </div>
    </>
  );
}
