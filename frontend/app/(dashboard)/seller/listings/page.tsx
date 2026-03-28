"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import {
  Plus,
  Search,
  Trash2,
  AlertCircle,
  Package,
  ArrowRight,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { seller as sellerApi, type PaginatedProducts } from "@/lib/api"
import { useSellerListings } from "@/lib/hooks"

const PAGE_SIZE = 15

const statusStyle: Record<string, string> = {
  active: "bg-success/10 text-success border-success/20",
  draft: "bg-gray-100 text-text-secondary border-gray-200",
  sold: "bg-ocean/10 text-ocean border-ocean/20",
  pending_review: "bg-warning/10 text-warning border-warning/20",
  rejected: "bg-danger/10 text-danger border-danger/20",
}

const tabs = ["All", "Active", "Draft", "Pending Review", "Sold"]

function RowSkeleton() {
  return (
    <TableRow>
      <TableCell><div className="w-4 h-4 bg-gray-200 rounded animate-pulse" /></TableCell>
      <TableCell><div className="w-12 h-10 bg-gray-200 rounded-lg animate-pulse" /></TableCell>
      <TableCell>
        <div className="space-y-1">
          <div className="h-4 bg-gray-200 rounded w-48 animate-pulse" />
          <div className="h-3 bg-gray-200 rounded w-28 animate-pulse" />
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell"><div className="h-4 bg-gray-200 rounded w-24 animate-pulse" /></TableCell>
      <TableCell><div className="h-5 bg-gray-200 rounded w-16 animate-pulse" /></TableCell>
      <TableCell className="hidden lg:table-cell"><div className="h-4 bg-gray-200 rounded w-20 animate-pulse" /></TableCell>
      <TableCell><div className="flex gap-1 justify-end"><div className="w-16 h-8 bg-gray-200 rounded animate-pulse" /></div></TableCell>
    </TableRow>
  )
}

export default function SellerListingsPage() {
  const [activeTab, setActiveTab] = useState("All")
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(1)

  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { setCurrentPage(1) }, [activeTab, debouncedSearch])

  const tabStatus: Record<string, string> = {
    "Active": "active",
    "Draft": "draft",
    "Pending Review": "pending_review",
    "Sold": "sold",
  }

  const { data, isLoading, error: swrError, mutate } = useSellerListings({
    page: currentPage,
    page_size: PAGE_SIZE,
    status: activeTab !== "All" ? tabStatus[activeTab] : undefined,
  })
  const error = swrError?.message ?? null

  const toggleSelect = (id: string) =>
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])

  const toggleAll = () => {
    const ids = data?.items.map((l) => l.id) ?? []
    setSelected((prev) => prev.length === ids.length ? [] : ids)
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this listing? This cannot be undone.")) return
    setDeleting(id)
    try {
      await sellerApi.deleteListing(id)
      mutate()
    } catch {
      alert("Failed to delete listing.")
    } finally {
      setDeleting(null)
    }
  }

  const allSelected = data ? selected.length === data.items.length && data.items.length > 0 : false

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
          <Input
            placeholder="Search listings..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-white"
          />
        </div>
        <Link href="/seller/listings/new">
          <Button className="bg-ocean hover:bg-ocean-dark text-white shrink-0">
            <Plus className="w-4 h-4 mr-2" /> New Listing
          </Button>
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px shrink-0",
              activeTab === tab
                ? "border-ocean text-ocean"
                : "border-transparent text-text-secondary hover:text-text-primary"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
          <Button variant="outline" size="sm" onClick={() => mutate()} className="ml-auto border-danger/30 text-danger">
            Retry
          </Button>
        </div>
      )}

      {/* Bulk action bar */}
      {selected.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-ocean/5 border border-ocean/20 rounded-lg">
          <span className="text-sm font-medium text-ocean">{selected.length} selected</span>
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" className="text-danger border-danger/30 hover:bg-danger/5">
              <Trash2 className="w-4 h-4 mr-1.5" /> Delete Selected
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  className="border-border"
                />
              </TableHead>
              <TableHead className="w-12" />
              <TableHead>Asset</TableHead>
              <TableHead className="hidden md:table-cell">Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Posted</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} />)
              : data?.items.length === 0
              ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-16 text-center">
                    <Package className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                    <p className="text-text-secondary">No listings in this category</p>
                    <Link href="/seller/listings/new">
                      <Button size="sm" className="mt-4 bg-ocean hover:bg-ocean-dark text-white">
                        <Plus className="w-4 h-4 mr-1.5" /> Create your first listing
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              )
              : data?.items.map((l) => (
                <TableRow key={l.id} className={selected.includes(l.id) ? "bg-ocean/5" : ""}>
                  <TableCell>
                    <Checkbox
                      checked={selected.includes(l.id)}
                      onCheckedChange={() => toggleSelect(l.id)}
                      className="border-border"
                    />
                  </TableCell>
                  <TableCell>
                    {l.primary_image_url
                      ? <img src={l.primary_image_url} alt="" className="w-12 h-10 rounded-lg object-cover" />
                      : <div className="w-12 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                          <Package className="w-5 h-5 text-gray-300" />
                        </div>
                    }
                  </TableCell>
                  <TableCell>
                    <Link href={`/seller/listings/${l.id}`} className="group">
                      <p className="font-medium text-text-primary text-sm line-clamp-1 group-hover:text-ocean transition-colors">{l.title}</p>
                      <p className="text-xs text-text-secondary mt-0.5">{l.category_name ?? "—"}</p>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-text-secondary">
                    ${Number(l.asking_price).toLocaleString()} {l.currency}
                  </TableCell>
                  <TableCell>
                    <Badge className={cn("text-xs border capitalize", statusStyle[l.status] ?? "bg-gray-100 text-text-secondary")}>
                      {l.status.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-text-secondary">
                    {new Date(l.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`/seller/listings/${l.id}`}>
                        <Button variant="ghost" size="sm" className="h-8 px-2.5 text-text-secondary hover:text-ocean gap-1.5 text-xs" title="View listing">
                          View <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                      {(l.status === "draft" || l.status === "rejected") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-text-secondary hover:text-danger"
                          title="Delete"
                          disabled={deleting === l.id}
                          onClick={() => handleDelete(l.id)}
                        >
                          {deleting === l.id
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Trash2 className="w-4 h-4" />}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>

        {/* Pagination */}
        {data && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border">
            <p className="text-sm text-text-secondary">
              Showing {data.items.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, data.total)} of {data.total}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={currentPage === 1 || isLoading} onClick={() => setCurrentPage(p => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={currentPage >= (data.pages ?? 1) || isLoading} onClick={() => setCurrentPage(p => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
