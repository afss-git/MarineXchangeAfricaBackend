"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Gavel, Plus, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { auctionAdmin } from "@/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

// Convert a local datetime-local string to UTC ISO string for the API
function toUTC(local: string): string {
  if (!local) return local
  return new Date(local).toISOString()
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NewAuctionPage() {
  const router = useRouter()

  const [productId, setProductId]           = useState("")
  const [title, setTitle]                   = useState("")
  const [description, setDescription]       = useState("")
  const [startingBid, setStartingBid]       = useState("")
  const [reservePrice, setReservePrice]     = useState("")
  const [currency, setCurrency]             = useState("USD")
  const [minIncrement, setMinIncrement]     = useState("500")
  const [startTime, setStartTime]           = useState("")
  const [endTime, setEndTime]               = useState("")
  const [autoExtend, setAutoExtend]         = useState("10")
  const [maxExtensions, setMaxExtensions]   = useState("3")
  const [adminNotes, setAdminNotes]         = useState("")

  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!productId.trim()) { setError("Product ID is required."); return }
    if (!title.trim())     { setError("Title is required."); return }
    if (!startingBid || isNaN(parseFloat(startingBid))) { setError("Starting bid must be a valid number."); return }
    if (!startTime) { setError("Start time is required."); return }
    if (!endTime)   { setError("End time is required."); return }
    if (new Date(startTime) >= new Date(endTime)) { setError("End time must be after start time."); return }

    setSaving(true)
    setError(null)
    try {
      const auction = await auctionAdmin.create({
        product_id:   productId.trim(),
        title:        title.trim(),
        starting_bid: parseFloat(startingBid),
        start_time:   toUTC(startTime),
        end_time:     toUTC(endTime),
        currency:     currency || "USD",
        ...(description   ? { description }                                    : {}),
        ...(reservePrice  ? { reserve_price: parseFloat(reservePrice) }        : {}),
        ...(minIncrement  ? { min_bid_increment_usd: parseFloat(minIncrement) } : {}),
        ...(autoExtend    ? { auto_extend_minutes: parseInt(autoExtend) }       : {}),
        ...(maxExtensions ? { max_extensions: parseInt(maxExtensions) }         : {}),
        ...(adminNotes    ? { admin_notes: adminNotes }                         : {}),
      })
      router.push(`/admin/auctions/${auction.id}`)
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to create auction.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost" size="sm"
          onClick={() => router.push("/admin/auctions")}
          className="gap-1.5 text-text-secondary"
        >
          <ArrowLeft className="w-4 h-4" />Auctions
        </Button>
        <span className="text-text-secondary">/</span>
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-ocean/10">
            <Gavel className="w-4 h-4 text-ocean" />
          </div>
          <h1 className="text-lg font-bold text-text-primary">New Auction</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Basic info */}
        <div className="bg-white rounded-xl border border-border shadow-sm p-5 space-y-4">
          <h2 className="font-semibold text-text-primary">Auction Details</h2>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-text-secondary block mb-1">
                Product ID <span className="text-danger">*</span>
              </label>
              <input
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                placeholder="UUID of the marketplace listing"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean font-mono"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-text-secondary block mb-1">
                Auction Title <span className="text-danger">*</span>
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. 2019 Offshore Supply Vessel — Sealed Bid Auction"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-text-secondary block mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Optional description visible to bidders…"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean resize-none"
              />
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div className="bg-white rounded-xl border border-border shadow-sm p-5 space-y-4">
          <h2 className="font-semibold text-text-primary">Pricing</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">
                Starting Bid <span className="text-danger">*</span>
              </label>
              <input
                type="number"
                step="1"
                value={startingBid}
                onChange={(e) => setStartingBid(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">
                Reserve Price
                <span className="text-text-secondary font-normal ml-1">(hidden from bidders)</span>
              </label>
              <input
                type="number"
                step="1"
                value={reservePrice}
                onChange={(e) => setReservePrice(e.target.value)}
                placeholder="Optional"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean bg-white"
              >
                {["USD", "EUR", "GBP", "ZAR", "NGN", "KES", "GHS"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Min Bid Increment (USD)</label>
              <input
                type="number"
                step="1"
                value={minIncrement}
                onChange={(e) => setMinIncrement(e.target.value)}
                placeholder="500"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
              />
            </div>
          </div>
        </div>

        {/* Timing */}
        <div className="bg-white rounded-xl border border-border shadow-sm p-5 space-y-4">
          <h2 className="font-semibold text-text-primary">Timing</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">
                Start Time <span className="text-danger">*</span>
              </label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">
                End Time <span className="text-danger">*</span>
              </label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">
                Auto-extend (minutes)
                <span className="text-text-secondary font-normal ml-1">— extends if bid placed in final N mins</span>
              </label>
              <input
                type="number"
                step="1"
                min="0"
                value={autoExtend}
                onChange={(e) => setAutoExtend(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Max Extensions</label>
              <input
                type="number"
                step="1"
                min="0"
                value={maxExtensions}
                onChange={(e) => setMaxExtensions(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
              />
            </div>
          </div>
        </div>

        {/* Admin notes */}
        <div className="bg-white rounded-xl border border-border shadow-sm p-5 space-y-3">
          <h2 className="font-semibold text-text-primary">Admin Notes</h2>
          <textarea
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            rows={2}
            placeholder="Internal notes (not visible to bidders)…"
            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean resize-none"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}

        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={saving}
            className="bg-ocean hover:bg-ocean-dark text-white gap-1.5"
          >
            <Plus className="w-4 h-4" />
            {saving ? "Creating…" : "Create Auction"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push("/admin/auctions")} disabled={saving}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
