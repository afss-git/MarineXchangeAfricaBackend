"use client";

import {
  Eye,
  ShoppingCart,
  Handshake,
  ShieldCheck,
  ArrowRight,
  Check,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const stats = [
  {
    label: "Active Listings Viewed",
    value: "24",
    icon: Eye,
    badge: null,
  },
  {
    label: "Purchase Requests Sent",
    value: "3",
    icon: ShoppingCart,
    badge: { text: "2 pending", variant: "warning" as const },
  },
  {
    label: "Open Deals",
    value: "1",
    icon: Handshake,
    badge: null,
  },
  {
    label: "KYC Status",
    value: "Pending",
    icon: ShieldCheck,
    badge: { text: "Action needed", variant: "warning" as const },
  },
];

const purchaseRequests = [
  {
    id: 1,
    asset: "MV Pacific Star",
    seller: "OceanFreight Ltd",
    date: "Mar 15, 2024",
    status: "pending",
  },
  {
    id: 2,
    asset: "Offshore Crane Unit",
    seller: "Delta Equipment",
    date: "Mar 12, 2024",
    status: "accepted",
  },
  {
    id: 3,
    asset: "Cargo Vessel Hull",
    seller: "MarineWorks Co",
    date: "Mar 8, 2024",
    status: "rejected",
  },
];

const marketplaceActivity = [
  {
    id: 1,
    name: "Bulk Carrier 2019",
    category: "Vessel",
    priceRange: "$2.5M - $3.2M",
  },
  {
    id: 2,
    name: "Hydraulic Winch System",
    category: "Equipment",
    priceRange: "$45K - $60K",
  },
  {
    id: 3,
    name: "Offshore Platform Module",
    category: "Offshore",
    priceRange: "$1.8M - $2.1M",
  },
];

const kycSteps = [
  { label: "Email Verified", completed: true },
  { label: "KYC Submitted", completed: false, current: true },
  { label: "KYC Approved", completed: false },
  { label: "Trading Enabled", completed: false },
];

function getStatusStyles(status: string) {
  switch (status) {
    case "accepted":
      return "bg-success/10 text-success border-success/20";
    case "rejected":
      return "bg-danger/10 text-danger border-danger/20";
    default:
      return "bg-warning/10 text-warning border-warning/20";
  }
}

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-xl border border-border p-5 shadow-sm"
          >
            <div className="flex items-start justify-between">
              <div className="p-2.5 rounded-lg bg-ocean/10">
                <stat.icon className="w-5 h-5 text-ocean" />
              </div>
              {stat.badge && (
                <Badge
                  className={cn(
                    "text-xs border",
                    stat.badge.variant === "warning"
                      ? "bg-warning/10 text-warning border-warning/20"
                      : ""
                  )}
                >
                  {stat.badge.text}
                </Badge>
              )}
            </div>
            <div className="mt-4">
              <p className="text-2xl font-semibold text-text-primary">
                {stat.value}
              </p>
              <p className="mt-1 text-sm text-text-secondary">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Two Column Section */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Purchase Requests */}
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center justify-between p-5 border-b border-border">
            <h2 className="text-base font-semibold text-text-primary">
              Recent Purchase Requests
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="text-ocean hover:text-ocean-dark hover:bg-ocean/5"
            >
              View all
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-text-secondary">Asset</TableHead>
                <TableHead className="text-text-secondary">Seller</TableHead>
                <TableHead className="text-text-secondary hidden sm:table-cell">
                  Date
                </TableHead>
                <TableHead className="text-text-secondary text-right">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchaseRequests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="font-medium text-text-primary">
                    {request.asset}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {request.seller}
                  </TableCell>
                  <TableCell className="text-text-secondary hidden sm:table-cell">
                    {request.date}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge
                      className={cn(
                        "capitalize text-xs border",
                        getStatusStyles(request.status)
                      )}
                    >
                      {request.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Marketplace Activity */}
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center justify-between p-5 border-b border-border">
            <h2 className="text-base font-semibold text-text-primary">
              Marketplace Activity
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="text-ocean hover:text-ocean-dark hover:bg-ocean/5"
            >
              Browse all
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
          <div className="divide-y divide-border">
            {marketplaceActivity.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors"
              >
                {/* Thumbnail placeholder */}
                <div className="w-16 h-12 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                  <div className="w-8 h-6 bg-gray-200 rounded" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-text-primary truncate">
                    {item.name}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge
                      variant="secondary"
                      className="text-xs bg-ocean/10 text-ocean border-0"
                    >
                      {item.category}
                    </Badge>
                    <span className="text-sm text-text-secondary">
                      {item.priceRange}
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 border-ocean text-ocean hover:bg-ocean hover:text-white"
                >
                  View
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* KYC Banner */}
      <div className="bg-navy rounded-xl p-6 text-white shadow-lg">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1">
            <h3 className="text-lg font-semibold">
              Complete KYC to unlock full trading
            </h3>
            <p className="mt-1 text-sm text-white/70">
              Verify your identity to access all marketplace features and start
              transacting securely.
            </p>

            {/* Progress Steps */}
            <div className="mt-5">
              <div className="flex items-center gap-2">
                {kycSteps.map((step, index) => (
                  <div key={step.label} className="flex items-center">
                    <div className="flex flex-col items-center">
                      <div
                        className={cn(
                          "flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-colors",
                          step.completed
                            ? "bg-success text-white"
                            : step.current
                            ? "bg-ocean text-white"
                            : "bg-white/20 text-white/60"
                        )}
                      >
                        {step.completed ? (
                          <Check className="w-4 h-4" />
                        ) : (
                          index + 1
                        )}
                      </div>
                      <span
                        className={cn(
                          "mt-2 text-xs whitespace-nowrap",
                          step.completed || step.current
                            ? "text-white"
                            : "text-white/50"
                        )}
                      >
                        {step.label}
                      </span>
                    </div>
                    {index < kycSteps.length - 1 && (
                      <div
                        className={cn(
                          "w-8 h-0.5 mx-1 mb-6 lg:w-12",
                          step.completed ? "bg-success" : "bg-white/20"
                        )}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <Button
            size="lg"
            className="bg-ocean hover:bg-ocean-dark text-white shrink-0"
          >
            Start KYC
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}
