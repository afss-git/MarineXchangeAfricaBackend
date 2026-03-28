"use client"

import { SWRConfig } from "swr"

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        // Show cached data immediately on revisit; revalidate silently in BG
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        // Dedupe identical requests fired within 2s
        dedupingInterval: 2000,
        // Retry up to 2 times on failure (don't hammer a cold backend)
        errorRetryCount: 2,
        errorRetryInterval: 5000,
        // Keep data in cache even when the component unmounts
        // This ensures cached data is available on next mount
        keepPreviousData: true,
      }}
    >
      {children}
    </SWRConfig>
  )
}
