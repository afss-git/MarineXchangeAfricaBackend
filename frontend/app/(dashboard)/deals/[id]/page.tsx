"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  ChevronLeft, ShieldCheck, Lock, FileText, CheckCircle2,
  Clock, DollarSign, AlertCircle, Handshake, Upload,
  CreditCard, X, Loader2, RefreshCw, ChevronDown, ChevronUp,
  Eye, Ban, TrendingUp, Download, Receipt, FolderOpen,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  deals as dealsApi, payments, documents as documentsApi,
  type DealDetail, type PaymentScheduleOut, type ScheduleItemOut,
  type PaymentRecordOut, type DealPaymentSummary,
  type DocumentOut, type InvoiceOut,
  ApiRequestError,
} from "@/lib/api"

// ── Constants ──────────────────────────────────────────────────────────────────

const DEAL_STATUS: Record<string, { label: string; style: string }> = {
  draft:            { label: "Preparing Offer",  style: "bg-gray-100 text-text-secondary border-gray-200" },
  pending_approval: { label: "Pending Approval", style: "bg-warning/10 text-warning border-warning/20" },
  offer_sent:       { label: "Offer Sent",        style: "bg-ocean/10 text-ocean border-ocean/20" },
  accepted:         { label: "Accepted",          style: "bg-success/10 text-success border-success/20" },
  active:           { label: "Active",            style: "bg-ocean/10 text-ocean border-ocean/20" },
  completed:        { label: "Completed",         style: "bg-gray-100 text-text-secondary border-gray-200" },
  disputed:         { label: "Disputed",          style: "bg-danger/10 text-danger border-danger/20" },
  cancelled:        { label: "Cancelled",         style: "bg-gray-100 text-text-secondary border-gray-200" },
}

const ITEM_STATUS: Record<string, { label: string; style: string }> = {
  pending:        { label: "Pending",    style: "bg-warning/10 text-warning border-warning/20" },
  pending_review: { label: "In Review", style: "bg-ocean/10 text-ocean border-ocean/20" },
  verified:       { label: "Verified",  style: "bg-success/10 text-success border-success/20" },
  overdue:        { label: "Overdue",   style: "bg-danger/10 text-danger border-danger/20" },
  waived:         { label: "Waived",    style: "bg-gray-100 text-text-secondary border-gray-200" },
}

const RECORD_STATUS: Record<string, { label: string; style: string }> = {
  pending_review: { label: "Under Review", style: "bg-ocean/10 text-ocean border-ocean/20" },
  verified:       { label: "Verified",     style: "bg-success/10 text-success border-success/20" },
  rejected:       { label: "Rejected",     style: "bg-danger/10 text-danger border-danger/20" },
}

const PAYMENT_METHODS = [
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "wire_transfer", label: "Wire Transfer" },
  { value: "swift",         label: "SWIFT Transfer" },
  { value: "cheque",        label: "Cheque" },
  { value: "cash",          label: "Cash" },
  { value: "other",         label: "Other" },
]

const MILESTONES = [
  "Deal Created", "Contract Signed", "Buyer Deposits Escrow",
  "Physical Inspection", "Seller Confirms Handover",
  "Funds Released to Seller", "Deal Completed",
]
const STATUS_MILESTONE: Record<string, number> = {
  offer_sent: 1, accepted: 2, active: 2,
  completed: 6, disputed: 2, cancelled: 1,
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="space-y-5 max-w-5xl animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-32" />
      <div className="h-32 bg-gray-200 rounded-xl" />
      <div className="h-20 bg-gray-200 rounded-xl" />
      <div className="flex gap-5">
        <div className="flex-1 space-y-4">
          <div className="h-64 bg-gray-200 rounded-xl" />
          <div className="h-48 bg-gray-200 rounded-xl" />
        </div>
        <div className="w-64 space-y-4">
          <div className="h-48 bg-gray-200 rounded-xl" />
          <div className="h-32 bg-gray-200 rounded-xl" />
        </div>
      </div>
    </div>
  )
}

// ── Payment record row (with evidence) ────────────────────────────────────────

function RecordRow({ record }: { record: PaymentRecordOut }) {
  const [open, setOpen] = useState(false)
  const rs = RECORD_STATUS[record.status] ?? RECORD_STATUS["pending_review"]
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary">
            ${Number(record.amount_paid).toLocaleString()} {record.currency}
            <span className="ml-2 text-xs text-text-secondary font-normal capitalize">
              via {record.payment_method.replace(/_/g, " ")}
            </span>
          </p>
          <p className="text-xs text-text-secondary mt-0.5">
            {new Date(record.payment_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            {record.bank_name ? ` · ${record.bank_name}` : ""}
            {record.bank_reference ? ` · Ref: ${record.bank_reference}` : ""}
          </p>
        </div>
        <Badge className={cn("text-xs border shrink-0", rs.style)}>{rs.label}</Badge>
        {open ? <ChevronUp className="w-4 h-4 text-text-secondary shrink-0" /> : <ChevronDown className="w-4 h-4 text-text-secondary shrink-0" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-0 border-t border-border bg-gray-50/50 space-y-2 text-sm">
          {record.notes && <p className="text-text-secondary">{record.notes}</p>}
          {record.rejection_reason && (
            <div className="flex items-start gap-2 p-2 bg-danger/5 border border-danger/20 rounded text-danger text-xs">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Rejection reason: {record.rejection_reason}</span>
            </div>
          )}
          {record.evidence.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs text-text-secondary font-medium">Evidence files:</p>
              {record.evidence.map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-xs text-ocean">
                  <FileText className="w-3 h-3" />
                  {e.file_name}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-secondary/60">No evidence files attached.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Pay installment panel ─────────────────────────────────────────────────────

interface PayPanelProps {
  item: ScheduleItemOut
  dealId: string
  onSuccess: () => void
  onClose: () => void
}

function PayPanel({ item, dealId, onSuccess, onClose }: PayPanelProps) {
  const [amount, setAmount]       = useState(item.amount)
  const [currency, setCurrency]   = useState(item.currency)
  const [method, setMethod]       = useState("bank_transfer")
  const [date, setDate]           = useState(new Date().toISOString().slice(0, 10))
  const [bankName, setBankName]   = useState("")
  const [bankRef, setBankRef]     = useState("")
  const [notes, setNotes]         = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [newRecord, setNewRecord] = useState<PaymentRecordOut | null>(null)

  // Evidence upload after record created
  const fileRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadDone, setUploadDone]   = useState(false)

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setError(null)
    try {
      const record = await payments.buyer.submitPayment(dealId, item.id, {
        amount_paid: Number(amount),
        currency,
        payment_method: method,
        payment_date: date,
        bank_name:      bankName || undefined,
        bank_reference: bankRef  || undefined,
        notes:          notes    || undefined,
      })
      setNewRecord(record)
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Failed to submit payment.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEvidence = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !newRecord) return
    setIsUploading(true)
    const fd = new FormData()
    fd.append("file", file)
    try {
      await payments.buyer.uploadEvidence(newRecord.id, dealId, fd)
      setUploadDone(true)
    } catch { /* evidence is optional */ }
    finally {
      setIsUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  if (newRecord) {
    return (
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-3 p-3 bg-success/10 border border-success/20 rounded-lg text-success">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Payment record submitted</p>
            <p className="text-xs mt-0.5">Our team will verify within 1–2 business days.</p>
          </div>
        </div>

        {!uploadDone ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-text-primary">Attach evidence (optional)</p>
            <p className="text-xs text-text-secondary">Bank receipt, transfer screenshot, or transaction confirmation.</p>
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={handleEvidence} />
            <Button
              variant="outline"
              className="w-full border-dashed"
              disabled={isUploading}
              onClick={() => fileRef.current?.click()}
            >
              {isUploading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading…</>
                : <><Upload className="w-4 h-4 mr-2" /> Upload Evidence</>}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-success text-sm">
            <CheckCircle2 className="w-4 h-4" /> Evidence uploaded successfully.
          </div>
        )}

        <Button className="w-full bg-ocean hover:bg-ocean-dark text-white" onClick={() => { onSuccess(); onClose() }}>
          Done
        </Button>
      </div>
    )
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-text-primary">Record Payment</h3>
          <p className="text-xs text-text-secondary mt-0.5">
            {item.label} — Due {new Date(item.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
        <button onClick={onClose} className="p-1 text-text-secondary hover:text-text-primary">
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Amount Paid <span className="text-danger">*</span></Label>
          <div className="flex gap-2">
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="w-20 shrink-0"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["USD","EUR","GBP","NGN","GHS","KES"].map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="number" min="0" step="0.01" value={amount}
              onChange={(e) => setAmount(e.target.value)} className="flex-1" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Payment Date <span className="text-danger">*</span></Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Payment Method <span className="text-danger">*</span></Label>
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {PAYMENT_METHODS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Bank Name</Label>
          <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. First Bank Nigeria" />
        </div>
        <div className="space-y-1.5">
          <Label>Transaction Reference</Label>
          <Input value={bankRef} onChange={(e) => setBankRef(e.target.value)} placeholder="e.g. TXN-20240318-001" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Notes</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
          rows={3} placeholder="Any additional information..." className="resize-none" />
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button
          className="flex-1 bg-ocean hover:bg-ocean-dark text-white"
          onClick={handleSubmit}
          disabled={isSubmitting || !amount || !date || !method}
        >
          {isSubmitting
            ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Submitting…</>
            : <><CreditCard className="w-4 h-4 mr-1.5" /> Submit Payment</>}
        </Button>
      </div>
    </div>
  )
}

// ── Documents panel (buyer view) ──────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  contract: "Contract", inspection_report: "Inspection Report",
  receipt: "Receipt", invoice: "Invoice", identification: "Identification",
  bank_statement: "Bank Statement", title_deed: "Title Deed",
  survey_report: "Survey Report", correspondence: "Correspondence", other: "Other",
}

function DocumentsPanel({
  dealId,
  docs,
  onAcknowledge,
}: {
  dealId: string
  docs: DocumentOut[]
  onAcknowledge: (updated: DocumentOut) => void
}) {
  const [downloading, setDownloading] = useState<string | null>(null)
  const [acknowledging, setAcknowledging] = useState<string | null>(null)

  async function handleDownload(doc: DocumentOut) {
    setDownloading(doc.id)
    try {
      const res = await documentsApi.downloadDocument(doc.id)
      window.open(res.signed_url, "_blank", "noopener")
    } catch (e) {
      alert((e as Error)?.message ?? "Download failed.")
    } finally {
      setDownloading(null)
    }
  }

  async function handleAcknowledge(doc: DocumentOut) {
    setAcknowledging(doc.id)
    try {
      await documentsApi.acknowledgeDocument(doc.id)
      onAcknowledge({ ...doc, acknowledged_at: new Date().toISOString() })
    } catch (e) {
      alert((e as Error)?.message ?? "Acknowledge failed.")
    } finally {
      setAcknowledging(null)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
        <FolderOpen className="w-4 h-4 text-ocean" />
        <h2 className="font-semibold text-text-primary">Deal Documents</h2>
        <span className="text-xs text-text-secondary ml-1">· {docs.length} file{docs.length !== 1 ? "s" : ""}</span>
      </div>

      {docs.length === 0 ? (
        <div className="py-12 text-center">
          <FolderOpen className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-text-secondary">No documents uploaded yet.</p>
          <p className="text-xs text-text-secondary/70 mt-1">Documents will appear here when shared by the admin.</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-4 px-5 py-4">
              <div className="p-2.5 rounded-lg bg-ocean/10 shrink-0">
                <FileText className="w-4 h-4 text-ocean" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{doc.file_name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-text-secondary">
                    {DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type}
                  </span>
                  {doc.file_size_bytes && (
                    <span className="text-xs text-text-secondary/60">
                      · {(doc.file_size_bytes / 1024).toFixed(1)} KB
                    </span>
                  )}
                  <span className="text-xs text-text-secondary/60">
                    · {new Date(doc.uploaded_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </div>
                {doc.description && (
                  <p className="text-xs text-text-secondary mt-0.5">{doc.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {doc.acknowledged_at ? (
                  <span className="inline-flex items-center gap-1 text-xs text-success font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Acknowledged
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={acknowledging === doc.id}
                    onClick={() => handleAcknowledge(doc)}
                    className="gap-1.5 text-xs"
                  >
                    {acknowledging === doc.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Acknowledge
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={downloading === doc.id}
                  onClick={() => handleDownload(doc)}
                  className="gap-1.5 text-xs"
                >
                  {downloading === doc.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Download className="w-3.5 h-3.5" />}
                  Download
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Invoices panel (buyer view) ───────────────────────────────────────────────

const INVOICE_STATUS_STYLE: Record<string, string> = {
  draft: "bg-gray-100 text-text-secondary border-gray-200",
  issued: "bg-success/10 text-success border-success/20",
  void: "bg-danger/10 text-danger border-danger/20",
}

function InvoicesPanel({ invoices }: { invoices: InvoiceOut[] }) {
  const [downloading, setDownloading] = useState<string | null>(null)

  async function handleDownload(inv: InvoiceOut) {
    if (!inv.has_pdf) { alert("No PDF available for this invoice yet."); return }
    setDownloading(inv.id)
    try {
      const res = await documentsApi.downloadInvoice(inv.id)
      window.open(res.signed_url, "_blank", "noopener")
    } catch (e) {
      alert((e as Error)?.message ?? "Download failed.")
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
        <Receipt className="w-4 h-4 text-ocean" />
        <h2 className="font-semibold text-text-primary">Invoices</h2>
        <span className="text-xs text-text-secondary ml-1">· {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}</span>
      </div>

      {invoices.length === 0 ? (
        <div className="py-12 text-center">
          <Receipt className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-text-secondary">No invoices issued yet.</p>
          <p className="text-xs text-text-secondary/70 mt-1">Invoices will appear here once generated by admin.</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {invoices.map((inv) => (
            <div key={inv.id} className="flex items-center gap-4 px-5 py-4">
              <div className="p-2.5 rounded-lg bg-ocean/10 shrink-0">
                <Receipt className="w-4 h-4 text-ocean" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-mono font-semibold text-text-primary">{inv.invoice_ref}</p>
                  <span className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize",
                    INVOICE_STATUS_STYLE[inv.status] ?? "bg-gray-100 text-text-secondary border-gray-200"
                  )}>
                    {inv.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs font-semibold text-navy">
                    {inv.currency} {Number(inv.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                  <span className="text-xs text-text-secondary capitalize">· {inv.invoice_type}</span>
                  {inv.due_date && (
                    <span className="text-xs text-text-secondary">
                      · Due {new Date(inv.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  )}
                  {inv.issued_at && (
                    <span className="text-xs text-text-secondary">
                      · Issued {new Date(inv.issued_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  )}
                </div>
                {inv.notes && <p className="text-xs text-text-secondary mt-0.5">{inv.notes}</p>}
                {inv.void_reason && (
                  <p className="text-xs text-danger mt-0.5">Voided: {inv.void_reason}</p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={downloading === inv.id || !inv.has_pdf}
                onClick={() => handleDownload(inv)}
                className="gap-1.5 text-xs shrink-0"
                title={!inv.has_pdf ? "PDF not available" : "Download invoice PDF"}
              >
                {downloading === inv.id
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Download className="w-3.5 h-3.5" />}
                {inv.has_pdf ? "Download" : "No PDF"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "overview" | "documents" | "invoices"

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>()

  const [deal, setDeal]         = useState<DealDetail | null>(null)
  const [schedule, setSchedule] = useState<PaymentScheduleOut | null>(null)
  const [records, setRecords]   = useState<PaymentRecordOut[]>([])
  const [summary, setSummary]   = useState<DealPaymentSummary | null>(null)
  const [docs, setDocs]         = useState<DocumentOut[]>([])
  const [invoices, setInvoices] = useState<InvoiceOut[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [payingItem, setPayingItem] = useState<ScheduleItemOut | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>("overview")

  const loadDeal = useCallback(async () => {
    if (!id) return
    setIsLoading(true)
    setError(null)
    try {
      const found = await dealsApi.getMyDeal(id)
      setDeal(found)

      // Load all deal data in parallel — silently ignore if not available yet
      const [schedRes, recRes, sumRes, docsRes, invoicesRes] = await Promise.allSettled([
        payments.buyer.getSchedule(id),
        payments.buyer.listRecords(id),
        payments.buyer.getSummary(id),
        documentsApi.listDocuments(id),
        documentsApi.listInvoices(id),
      ])
      if (schedRes.status === "fulfilled") setSchedule(schedRes.value)
      if (recRes.status === "fulfilled") setRecords(recRes.value)
      if (sumRes.status === "fulfilled") setSummary(sumRes.value)
      if (docsRes.status === "fulfilled") setDocs(docsRes.value)
      if (invoicesRes.status === "fulfilled") setInvoices(invoicesRes.value)
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Failed to load deal.")
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => { loadDeal() }, [loadDeal])

  if (isLoading) return <PageSkeleton />

  if (error || !deal) {
    return (
      <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger max-w-2xl">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <span className="text-sm">{error ?? "Deal not found."}</span>
        <Link href="/deals">
          <Button variant="outline" size="sm" className="ml-auto border-danger/30 text-danger">Back</Button>
        </Link>
      </div>
    )
  }

  const config      = DEAL_STATUS[deal.status] ?? DEAL_STATUS["offer_sent"]
  const milestoneIdx = STATUS_MILESTONE[deal.status] ?? 1
  const price       = deal.total_price
  const milestones  = MILESTONES.map((label, i) => ({
    label,
    completed: i < milestoneIdx,
    current:   i === milestoneIdx && deal.status !== "completed",
  }))

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })

  const pendingItems  = schedule?.items.filter((i) => i.status === "pending" || i.status === "overdue") ?? []
  const reviewedItems = schedule?.items.filter((i) => i.status !== "pending" && i.status !== "overdue") ?? []

  // Group records by item
  const recordsByItem = records.reduce<Record<string, PaymentRecordOut[]>>((acc, r) => {
    const key = r.schedule_item_id
    acc[key] = acc[key] ?? []
    acc[key].push(r)
    return acc
  }, {})

  return (
    <div className="space-y-5 max-w-5xl">
      <Link href="/deals" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-ocean transition-colors">
        <ChevronLeft className="w-4 h-4" /> Back to Deals
      </Link>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="w-full sm:w-24 h-20 bg-navy/5 rounded-lg shrink-0 overflow-hidden flex items-center justify-center">
            {deal.product_primary_image_url ? (
              <img
                src={deal.product_primary_image_url}
                alt={deal.product_title ?? "Product"}
                className="w-full h-full object-cover"
              />
            ) : (
              <Handshake className="w-8 h-8 text-navy/30" />
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h1 className="text-lg font-bold text-text-primary">
                  {deal.product_title ?? `Deal ${deal.deal_ref}`}
                </h1>
                <p className="text-sm font-mono text-text-secondary mt-0.5">{deal.deal_ref}</p>
              </div>
              <Badge className={cn("text-xs border", config.style)}>{config.label}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 mt-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-text-secondary">Agreed Price</p>
                <p className="text-sm font-bold text-navy">${Number(price).toLocaleString()} {deal.currency}</p>
              </div>
              <div>
                <p className="text-xs text-text-secondary">Payment Type</p>
                <p className="text-sm text-text-secondary capitalize">
                  {deal.deal_type.replace(/_/g, " ")}
                </p>
              </div>
              <div>
                <p className="text-xs text-text-secondary">Created</p>
                <p className="text-sm text-text-secondary">{formatDate(deal.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-text-secondary">Last Updated</p>
                <p className="text-sm text-text-secondary">{formatDate(deal.updated_at)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Status banners */}
      {deal.status === "offer_sent" && (
        <div className="bg-ocean/5 border border-ocean/20 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-ocean shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-text-primary">Deal Offer Awaiting Your Review</p>
            <p className="text-sm text-text-secondary mt-0.5">
              A formal deal offer has been sent to your email. Please check your inbox for the review link to accept or discuss the terms.
            </p>
          </div>
        </div>
      )}
      {deal.status === "accepted" && !schedule && (
        <div className="bg-warning/5 border border-warning/20 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-text-primary">Payment Required</p>
            <p className="text-sm text-text-secondary mt-0.5">
              Check your email for the secure deal portal link with payment instructions. Once a payment schedule is set up by admin, it will appear here.
            </p>
          </div>
        </div>
      )}
      {deal.status === "completed" && (
        <div className="flex items-center gap-3 p-4 bg-success/10 border border-success/20 rounded-xl text-success">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span className="text-sm font-medium">Deal completed. Funds have been released to the seller.</span>
        </div>
      )}
      {deal.status === "disputed" && (
        <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm font-medium">A dispute has been raised. Our team is reviewing it.</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          { key: "overview",   label: "Overview",   icon: Handshake },
          { key: "documents",  label: "Documents",  icon: FolderOpen, count: docs.length },
          { key: "invoices",   label: "Invoices",   icon: Receipt,    count: invoices.length },
        ] as { key: Tab; label: string; icon: React.ElementType; count?: number }[]).map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              activeTab === key
                ? "bg-white text-ocean shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
            {count !== undefined && count > 0 && (
              <span className={cn(
                "ml-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold",
                activeTab === key ? "bg-ocean/10 text-ocean" : "bg-gray-200 text-text-secondary"
              )}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Documents tab */}
      {activeTab === "documents" && (
        <DocumentsPanel
          dealId={id}
          docs={docs}
          onAcknowledge={(updated) =>
            setDocs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)))
          }
        />
      )}

      {/* Invoices tab */}
      {activeTab === "invoices" && (
        <InvoicesPanel invoices={invoices} />
      )}

      {activeTab === "overview" && (
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {/* LEFT */}
        <div className="flex-1 space-y-5">

          {/* Payment summary bar */}
          {summary && summary.total_items > 0 && (
            <div className="bg-white rounded-xl border border-border p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-text-primary">Payment Summary</h2>
                {summary.is_complete && (
                  <Badge className="text-xs border bg-success/10 text-success border-success/20">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> All Paid
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Total",       value: `$${Number(summary.total_amount).toLocaleString()}`,       color: "text-navy" },
                  { label: "Verified",    value: `$${Number(summary.verified_amount).toLocaleString()}`,    color: "text-success" },
                  { label: "Outstanding", value: `$${Number(summary.outstanding_amount).toLocaleString()}`, color: "text-warning" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-gray-50 rounded-lg px-3 py-2.5 text-center">
                    <p className={cn("text-lg font-bold", color)}>{value}</p>
                    <p className="text-xs text-text-secondary mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
              {/* Progress bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-text-secondary">
                  <span>{summary.verified_count} of {summary.total_items} installments verified</span>
                  <span>{summary.total_items > 0 ? Math.round((summary.verified_count / summary.total_items) * 100) : 0}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-success rounded-full transition-all"
                    style={{ width: `${summary.total_items > 0 ? (summary.verified_count / summary.total_items) * 100 : 0}%` }}
                  />
                </div>
                {summary.overdue_count > 0 && (
                  <p className="text-xs text-danger font-medium">
                    {summary.overdue_count} installment{summary.overdue_count !== 1 ? "s" : ""} overdue
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Payment schedule */}
          {schedule && schedule.items.length > 0 && (
            <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div>
                  <h2 className="text-base font-semibold text-text-primary">Payment Schedule</h2>
                  <p className="text-xs text-text-secondary mt-0.5 capitalize">{schedule.mode} schedule · {schedule.total_items} installments</p>
                </div>
              </div>

              {/* Pay panel slide-in */}
              {payingItem && (
                <div className="border-b border-border bg-ocean/5">
                  <PayPanel
                    item={payingItem}
                    dealId={id}
                    onSuccess={loadDeal}
                    onClose={() => setPayingItem(null)}
                  />
                </div>
              )}

              <div className="divide-y divide-border">
                {schedule.items.map((item) => {
                  const is = ITEM_STATUS[item.status] ?? ITEM_STATUS["pending"]
                  const itemRecords = recordsByItem[item.id] ?? []
                  const canPay = (item.status === "pending" || item.status === "overdue") && !payingItem
                  return (
                    <div key={item.id} className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        {/* Installment number */}
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold",
                          item.status === "verified" ? "bg-success text-white"
                          : item.status === "overdue" ? "bg-danger text-white"
                          : item.status === "waived"  ? "bg-gray-200 text-text-secondary"
                          : "bg-ocean/10 text-ocean"
                        )}>
                          {item.installment_number}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-text-primary">{item.label}</p>
                          <p className="text-xs text-text-secondary">
                            Due {new Date(item.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-navy">
                            ${Number(item.amount).toLocaleString()} {item.currency}
                          </p>
                        </div>
                        <Badge className={cn("text-xs border shrink-0 ml-2", is.style)}>{is.label}</Badge>
                        {canPay && (
                          <Button
                            size="sm"
                            className="shrink-0 bg-ocean hover:bg-ocean-dark text-white h-7 text-xs"
                            onClick={() => setPayingItem(item)}
                          >
                            <CreditCard className="w-3 h-3 mr-1" /> Pay
                          </Button>
                        )}
                        {item.status === "waived" && item.waiver_reason && (
                          <span className="text-xs text-text-secondary italic ml-2">Waived: {item.waiver_reason}</span>
                        )}
                      </div>

                      {/* Payment records for this item */}
                      {itemRecords.length > 0 && (
                        <div className="ml-11 mt-3 space-y-2">
                          {itemRecords.map((rec) => <RecordRow key={rec.id} record={rec} />)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Milestones */}
          <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
            <h2 className="text-base font-semibold text-text-primary mb-5">Deal Milestones</h2>
            <div className="space-y-0">
              {milestones.map((m, i) => (
                <div key={m.label} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                      m.completed ? "bg-success text-white"
                      : m.current  ? "bg-ocean text-white ring-4 ring-ocean/20"
                      : "bg-gray-100 text-text-secondary"
                    )}>
                      {m.completed ? <CheckCircle2 className="w-4 h-4" />
                        : m.current  ? <Clock className="w-4 h-4" />
                        : <span className="text-xs font-semibold">{i + 1}</span>}
                    </div>
                    {i < milestones.length - 1 && (
                      <div className={cn("w-0.5 flex-1 my-1", m.completed ? "bg-success" : "bg-gray-200")} />
                    )}
                  </div>
                  <div className="pb-5">
                    <p className={cn("text-sm font-medium", m.completed || m.current ? "text-text-primary" : "text-text-secondary")}>
                      {m.label}
                    </p>
                    {m.current && (
                      <p className="text-xs text-ocean font-medium mt-0.5 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-ocean animate-pulse inline-block" />
                        Current stage
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT sidebar */}
        <div className="lg:w-64 shrink-0 space-y-4">

          {/* Summary stats if no full schedule */}
          {summary && (
            <div className="bg-white rounded-xl border border-border p-4 shadow-sm space-y-2.5 text-sm">
              <h3 className="text-sm font-semibold text-text-primary">Payment Status</h3>
              {[
                { label: "Pending",  value: summary.pending_count,  color: "text-warning" },
                { label: "Verified", value: summary.verified_count, color: "text-success" },
                { label: "Overdue",  value: summary.overdue_count,  color: "text-danger"  },
                { label: "Waived",   value: summary.waived_count,   color: "text-text-secondary" },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex justify-between">
                  <span className="text-text-secondary">{label}</span>
                  <span className={cn("font-bold", color)}>{value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Parties */}
          <div className="bg-white rounded-xl border border-border p-4 shadow-sm space-y-3">
            <h3 className="text-sm font-semibold text-text-primary">Deal Parties</h3>
            {[
              { role: "Buyer", initials: "ME", label: "You" },
              { role: "Seller", initials: (deal.seller_name ?? "SE").slice(0, 2).toUpperCase(), label: deal.seller_name ?? "Seller" },
            ].map(({ role, initials, label }) => (
              <div key={role} className="flex items-center gap-3">
                <Avatar className="w-8 h-8">
                  <AvatarFallback className="bg-ocean/10 text-ocean text-xs font-semibold">{initials}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-xs text-text-secondary">{role}</p>
                  <p className="text-sm font-medium text-text-primary">{label}</p>
                </div>
                <ShieldCheck className="w-4 h-4 text-success ml-auto shrink-0" />
              </div>
            ))}
          </div>

          {/* Trust indicators */}
          <div className="bg-navy/5 border border-navy/10 rounded-xl p-4 space-y-2.5">
            {[
              { icon: ShieldCheck, text: "Escrow-protected funds" },
              { icon: Lock,        text: "Encrypted communications" },
              { icon: FileText,    text: "Immutable audit trail" },
              { icon: Handshake,   text: "KYC-verified parties" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2 text-sm text-text-primary">
                <Icon className="w-4 h-4 text-ocean shrink-0" />
                <span>{text}</span>
              </div>
            ))}
          </div>

          {deal.status !== "completed" && deal.status !== "cancelled" && (
            <Button variant="outline" className="w-full text-danger border-danger/30 hover:bg-danger/5 text-sm">
              <AlertCircle className="w-4 h-4 mr-2" /> Raise a Dispute
            </Button>
          )}
        </div>
      </div>
      )} {/* end activeTab === "overview" */}
    </div>
  )
}
