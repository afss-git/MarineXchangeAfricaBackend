"use client"

import { createContext, useCallback, useContext, useState, useTransition } from "react"

// ── Context ───────────────────────────────────────────────────────────────────

interface PageLoaderContextValue {
  show: () => void
  hide: () => void
  loading: boolean
}

const PageLoaderContext = createContext<PageLoaderContextValue | null>(null)

export function usePageLoader() {
  const ctx = useContext(PageLoaderContext)
  if (!ctx) throw new Error("usePageLoader must be used within PageLoaderProvider")
  return ctx
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function PageLoaderProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0)
  const loading = count > 0

  const show = useCallback(() => setCount((n) => n + 1), [])
  const hide = useCallback(() => setCount((n) => Math.max(0, n - 1)), [])

  return (
    <PageLoaderContext.Provider value={{ show, hide, loading }}>
      {children}
      {loading && <PageLoaderOverlay />}
    </PageLoaderContext.Provider>
  )
}

// ── Overlay ───────────────────────────────────────────────────────────────────

function PageLoaderOverlay() {
  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{ backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", backgroundColor: "rgba(15,42,68,0.45)" }}
      aria-label="Loading"
    >
      {/* Animated brand SVG */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="-13 -13 45 45"
        width="72"
        height="72"
        aria-hidden="true"
      >
        <style>{`
          .mx-dot {
            transform-origin: 50% 50%;
            fill: #0EA5E9;
          }
          .mx-dot:nth-child(1) { fill: #0EA5E9; animation: mxBox1 4s infinite; }
          .mx-dot:nth-child(2) { fill: #0C7AB8; animation: mxBox2 4s infinite; }
          .mx-dot:nth-child(3) { fill: #0F2A44; animation: mxBox3 4s infinite; }
          .mx-dot:nth-child(4) { fill: #0EA5E9; animation: mxBox4 4s infinite; }
          .mx-dot:nth-child(5) { fill: #0C7AB8; animation: mxBox5 4s infinite; }
          .mx-dot:nth-child(6) { fill: #0F2A44; animation: mxBox6 4s infinite; }
          .mx-dot:nth-child(7) { fill: #0EA5E9; animation: mxBox7 4s infinite; }
          .mx-dot:nth-child(8) { fill: #0C7AB8; animation: mxBox8 4s infinite; }
          .mx-dot:nth-child(9) { fill: #0F2A44; animation: mxBox9 4s infinite; }

          @keyframes mxBox1 {
            9.09%  { transform: translate(-12px,0); }
            18.18% { transform: translate(0,0); }
            27.27% { transform: translate(0,0); }
            36.36% { transform: translate(12px,0); }
            45.45% { transform: translate(12px,12px); }
            54.55% { transform: translate(12px,12px); }
            63.64% { transform: translate(12px,12px); }
            72.73% { transform: translate(12px,0); }
            81.82% { transform: translate(0,0); }
            90.91% { transform: translate(-12px,0); }
            100%   { transform: translate(0,0); }
          }
          @keyframes mxBox2 {
            9.09%  { transform: translate(0,0); }
            18.18% { transform: translate(12px,0); }
            27.27% { transform: translate(0,0); }
            36.36% { transform: translate(12px,0); }
            45.45% { transform: translate(12px,12px); }
            54.55% { transform: translate(12px,12px); }
            63.64% { transform: translate(12px,12px); }
            72.73% { transform: translate(12px,12px); }
            81.82% { transform: translate(0,12px); }
            90.91% { transform: translate(0,12px); }
            100%   { transform: translate(0,0); }
          }
          @keyframes mxBox3 {
            9.09%  { transform: translate(-12px,0); }
            18.18% { transform: translate(-12px,0); }
            27.27% { transform: translate(0,0); }
            36.36% { transform: translate(-12px,0); }
            45.45% { transform: translate(-12px,0); }
            54.55% { transform: translate(-12px,0); }
            63.64% { transform: translate(-12px,0); }
            72.73% { transform: translate(-12px,0); }
            81.82% { transform: translate(-12px,-12px); }
            90.91% { transform: translate(0,-12px); }
            100%   { transform: translate(0,0); }
          }
          @keyframes mxBox4 {
            9.09%  { transform: translate(-12px,0); }
            18.18% { transform: translate(-12px,0); }
            27.27% { transform: translate(-12px,-12px); }
            36.36% { transform: translate(0,-12px); }
            45.45% { transform: translate(0,0); }
            54.55% { transform: translate(0,-12px); }
            63.64% { transform: translate(0,-12px); }
            72.73% { transform: translate(0,-12px); }
            81.82% { transform: translate(-12px,-12px); }
            90.91% { transform: translate(-12px,0); }
            100%   { transform: translate(0,0); }
          }
          @keyframes mxBox5 {
            9.09%  { transform: translate(0,0); }
            18.18% { transform: translate(0,0); }
            27.27% { transform: translate(0,0); }
            36.36% { transform: translate(12px,0); }
            45.45% { transform: translate(12px,0); }
            54.55% { transform: translate(12px,0); }
            63.64% { transform: translate(12px,0); }
            72.73% { transform: translate(12px,0); }
            81.82% { transform: translate(12px,-12px); }
            90.91% { transform: translate(0,-12px); }
            100%   { transform: translate(0,0); }
          }
          @keyframes mxBox6 {
            9.09%  { transform: translate(0,0); }
            18.18% { transform: translate(-12px,0); }
            27.27% { transform: translate(-12px,0); }
            36.36% { transform: translate(0,0); }
            45.45% { transform: translate(0,0); }
            54.55% { transform: translate(0,0); }
            63.64% { transform: translate(0,0); }
            72.73% { transform: translate(0,12px); }
            81.82% { transform: translate(-12px,12px); }
            90.91% { transform: translate(-12px,0); }
            100%   { transform: translate(0,0); }
          }
          @keyframes mxBox7 {
            9.09%  { transform: translate(12px,0); }
            18.18% { transform: translate(12px,0); }
            27.27% { transform: translate(12px,0); }
            36.36% { transform: translate(0,0); }
            45.45% { transform: translate(0,-12px); }
            54.55% { transform: translate(12px,-12px); }
            63.64% { transform: translate(0,-12px); }
            72.73% { transform: translate(0,-12px); }
            81.82% { transform: translate(0,0); }
            90.91% { transform: translate(12px,0); }
            100%   { transform: translate(0,0); }
          }
          @keyframes mxBox8 {
            9.09%  { transform: translate(0,0); }
            18.18% { transform: translate(-12px,0); }
            27.27% { transform: translate(-12px,-12px); }
            36.36% { transform: translate(0,-12px); }
            45.45% { transform: translate(0,-12px); }
            54.55% { transform: translate(0,-12px); }
            63.64% { transform: translate(0,-12px); }
            72.73% { transform: translate(0,-12px); }
            81.82% { transform: translate(12px,-12px); }
            90.91% { transform: translate(12px,0); }
            100%   { transform: translate(0,0); }
          }
          @keyframes mxBox9 {
            9.09%  { transform: translate(-12px,0); }
            18.18% { transform: translate(-12px,0); }
            27.27% { transform: translate(0,0); }
            36.36% { transform: translate(-12px,0); }
            45.45% { transform: translate(0,0); }
            54.55% { transform: translate(0,0); }
            63.64% { transform: translate(-12px,0); }
            72.73% { transform: translate(-12px,0); }
            81.82% { transform: translate(-24px,0); }
            90.91% { transform: translate(-12px,0); }
            100%   { transform: translate(0,0); }
          }
        `}</style>
        <g>
          <circle className="mx-dot" cx="13" cy="1"  r="5" />
          <circle className="mx-dot" cx="13" cy="1"  r="5" />
          <circle className="mx-dot" cx="25" cy="25" r="5" />
          <circle className="mx-dot" cx="13" cy="13" r="5" />
          <circle className="mx-dot" cx="13" cy="13" r="5" />
          <circle className="mx-dot" cx="25" cy="13" r="5" />
          <circle className="mx-dot" cx="1"  cy="25" r="5" />
          <circle className="mx-dot" cx="13" cy="25" r="5" />
          <circle className="mx-dot" cx="25" cy="25" r="5" />
        </g>
      </svg>

      {/* Brand wordmark */}
      <p className="mt-5 text-sm font-semibold tracking-widest uppercase select-none">
        <span style={{ color: "#e0eaf5" }}>Harbours</span>
        <span style={{ color: "#0EA5E9" }}>360</span>
      </p>
    </div>
  )
}
