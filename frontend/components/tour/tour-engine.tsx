"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { X, ArrowRight, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TourStep {
  /** Value of data-tour="…" attribute on the target DOM element */
  selector: string;
  title: string;
  description: string;
}

export interface PageTourProps {
  /** Unique key for this page's tour — used in localStorage */
  pageKey: string;
  userId: string;
  steps: TourStep[];
  /** Delay (ms) before tour starts after mount */
  delay?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const storageKey = (uid: string, page: string) => `mx_tour_v1_${uid}_${page}`;

const PAD = 10;           // padding around spotlight target
const EASE = "380ms cubic-bezier(0.4,0,0.2,1)";

interface Rect { x: number; y: number; w: number; h: number }

function measureEl(selector: string): Rect | null {
  const el = document.querySelector(`[data-tour="${selector}"]`) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return {
    x: r.left   - PAD,
    y: r.top    - PAD,
    w: r.width  + PAD * 2,
    h: r.height + PAD * 2,
  };
}

// ─── Core component ───────────────────────────────────────────────────────────

export function PageTour({ pageKey, userId, steps, delay = 900 }: PageTourProps) {
  const [running,  setRunning]  = useState(false);
  const [visible,  setVisible]  = useState(false);  // controls CSS enter animation
  const [stepIdx,  setStepIdx]  = useState(0);
  const [rect,     setRect]     = useState<Rect | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Start tour once on mount ───────────────────────────────────────────────
  useEffect(() => {
    const key = storageKey(userId, pageKey);
    if (localStorage.getItem(key)) return;

    const t = setTimeout(() => {
      const r = measureEl(steps[0]?.selector ?? "");
      if (r) {
        setRect(r);
        setRunning(true);
        requestAnimationFrame(() => setVisible(true));
      }
    }, delay);
    return () => clearTimeout(t);
  }, [userId, pageKey, steps, delay]);

  // ── Update spotlight rect when step changes ────────────────────────────────
  useEffect(() => {
    if (!running) return;
    clearTimeout(retryRef.current);
    let tries = 0;

    const attempt = () => {
      const r = measureEl(steps[stepIdx]?.selector ?? "");
      if (r) {
        setRect(r);
      } else if (++tries < 6) {
        retryRef.current = setTimeout(attempt, 150);
      } else {
        // element not in DOM — skip this step
        if (stepIdx < steps.length - 1) setStepIdx((i) => i + 1);
        else dismiss();
      }
    };
    attempt();

    return () => clearTimeout(retryRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx, running]);

  // ── Recalculate on resize ──────────────────────────────────────────────────
  useEffect(() => {
    if (!running) return;
    const handler = () => {
      const r = measureEl(steps[stepIdx]?.selector ?? "");
      if (r) setRect(r);
    };
    window.addEventListener("resize", handler, { passive: true });
    return () => window.removeEventListener("resize", handler);
  }, [running, stepIdx, steps]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(() => {
      localStorage.setItem(storageKey(userId, pageKey), "done");
      setRunning(false);
    }, 280);
  }, [userId, pageKey]);

  const next = useCallback(() => {
    if (stepIdx < steps.length - 1) setStepIdx((i) => i + 1);
    else dismiss();
  }, [stepIdx, steps.length, dismiss]);

  const prev = useCallback(() => {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  }, [stepIdx]);

  if (!running || !rect) return null;

  const step = steps[stepIdx];
  const vw   = window.innerWidth;
  const vh   = window.innerHeight;
  const { x, y, w, h } = rect;

  // ── Tooltip placement ──────────────────────────────────────────────────────
  const TW = Math.min(292, vw - 32);
  const TH = 168;

  // Horizontal: centre on spotlight, clamp to screen
  const tLeft = Math.max(12, Math.min(x + w / 2 - TW / 2, vw - TW - 12));

  // Vertical: prefer below, fall back to above
  const below = vh - (y + h) - 16 >= TH;
  const tTop  = below ? y + h + 14 : Math.max(8, y - TH - 14);

  // Arrow: offset within tooltip pointing toward spotlight centre
  const arrowX = Math.max(14, Math.min(x + w / 2 - tLeft - 7, TW - 28));

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[9990] pointer-events-none transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      {/* ── 4 blocking dark/blur strips surrounding the spotlight ── */}
      {/* Top */}
      <div
        style={{
          position: "absolute", inset: "0 0 auto 0",
          height: Math.max(0, y),
          background: "rgba(0,0,0,0.72)",
          backdropFilter: "blur(4px)",
          transition: `height ${EASE}`,
          pointerEvents: "all",
        }}
      />
      {/* Bottom */}
      <div
        style={{
          position: "absolute", inset: "auto 0 0 0",
          top: Math.max(0, y + h),
          background: "rgba(0,0,0,0.72)",
          backdropFilter: "blur(4px)",
          transition: `top ${EASE}`,
          pointerEvents: "all",
        }}
      />
      {/* Left */}
      <div
        style={{
          position: "absolute",
          top: Math.max(0, y), left: 0,
          width: Math.max(0, x),
          height: Math.max(0, h),
          background: "rgba(0,0,0,0.72)",
          backdropFilter: "blur(4px)",
          transition: `top ${EASE}, width ${EASE}, height ${EASE}`,
          pointerEvents: "all",
        }}
      />
      {/* Right */}
      <div
        style={{
          position: "absolute",
          top: Math.max(0, y),
          left: Math.max(0, x + w),
          right: 0,
          height: Math.max(0, h),
          background: "rgba(0,0,0,0.72)",
          backdropFilter: "blur(4px)",
          transition: `top ${EASE}, left ${EASE}, height ${EASE}`,
          pointerEvents: "all",
        }}
      />

      {/* ── Spotlight glow ring ─────────────────────────────────── */}
      <div
        style={{
          position: "absolute",
          top: y, left: x, width: w, height: h,
          borderRadius: 10,
          boxShadow: "0 0 0 2.5px #0891b2, 0 0 28px 8px rgba(8,145,178,0.35)",
          transition: `top ${EASE}, left ${EASE}, width ${EASE}, height ${EASE}`,
          pointerEvents: "none",
        }}
      />

      {/* ── Pulsing ring ────────────────────────────────────────── */}
      <div
        className="animate-ping"
        style={{
          position: "absolute",
          top: y + 5, left: x + 5,
          width: w - 10, height: h - 10,
          borderRadius: 8,
          border: "1.5px solid rgba(8,145,178,0.5)",
          transition: `top ${EASE}, left ${EASE}, width ${EASE}, height ${EASE}`,
          pointerEvents: "none",
          animationDuration: "1.8s",
        }}
      />

      {/* ── Tooltip card ────────────────────────────────────────── */}
      <div
        style={{
          position: "absolute",
          top: tTop, left: tLeft, width: TW,
          transition: `top ${EASE}, left ${EASE}`,
          pointerEvents: "all",
          zIndex: 10000,
        }}
      >
        {/* Arrow pointing toward spotlight */}
        {below ? (
          <div style={{
            position: "absolute", top: -7, left: arrowX,
            borderLeft: "7px solid transparent", borderRight: "7px solid transparent",
            borderBottom: "8px solid rgba(255,255,255,0.97)",
          }} />
        ) : (
          <div style={{
            position: "absolute", bottom: -7, left: arrowX,
            borderLeft: "7px solid transparent", borderRight: "7px solid transparent",
            borderTop: "8px solid rgba(255,255,255,0.97)",
          }} />
        )}

        {/* Card */}
        <div
          className="rounded-2xl overflow-hidden shadow-2xl border border-white/20"
          style={{ background: "rgba(255,255,255,0.97)", backdropFilter: "blur(20px)" }}
        >
          {/* Ocean accent bar */}
          <div className="h-[3px]" style={{ background: "linear-gradient(to right,#0891b2,#0e1f3b)" }} />

          <div className="p-4">
            {/* Header row */}
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: "#0891b2" }}>
                  {stepIdx + 1} of {steps.length}
                </p>
                <h3 className="text-sm font-bold text-gray-900 leading-snug">{step.title}</h3>
              </div>
              <button
                onClick={dismiss}
                className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors mt-0.5"
                aria-label="Close tour"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <p className="text-xs text-gray-500 leading-relaxed mb-4">{step.description}</p>

            {/* Action row */}
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={dismiss}
                className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
              >
                Skip tour
              </button>
              <div className="flex items-center gap-1.5">
                {stepIdx > 0 && (
                  <button
                    onClick={prev}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                  >
                    <ChevronLeft className="w-3 h-3" /> Back
                  </button>
                )}
                <button
                  onClick={next}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors"
                  style={{ background: "#0891b2" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#0e7490")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#0891b2")}
                >
                  {stepIdx === steps.length - 1 ? "Done ✓" : (<>Next <ArrowRight className="w-3 h-3" /></>)}
                </button>
              </div>
            </div>

            {/* Progress dots */}
            <div className="flex justify-center items-center gap-1.5 mt-3 pt-3 border-t border-gray-100">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className="rounded-full transition-all duration-300"
                  style={{
                    width:  i === stepIdx ? 20 : 6,
                    height: 6,
                    background:
                      i === stepIdx ? "#0891b2"
                      : i < stepIdx  ? "rgba(8,145,178,0.35)"
                      : "#e5e7eb",
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
