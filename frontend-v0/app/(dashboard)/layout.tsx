"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Store,
  FileText,
  Handshake,
  ShieldCheck,
  User,
  LogOut,
  Menu,
  X,
  Anchor,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/marketplace", label: "Marketplace", icon: Store },
  { href: "/purchase-requests", label: "Purchase Requests", icon: FileText },
  { href: "/deals", label: "My Deals", icon: Handshake },
  { href: "/kyc", label: "KYC Verification", icon: ShieldCheck },
  { href: "/profile", label: "Profile", icon: User },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-surface">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-60 bg-navy flex flex-col transition-transform duration-300 lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-5 py-5 border-b border-white/10">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-ocean">
            <Anchor className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-semibold text-white">MarineXchange</span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto lg:hidden text-white/70 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-ocean/20 text-ocean border-l-2 border-ocean"
                    : "text-white/70 hover:text-white hover:bg-white/5"
                )}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-3 py-4 border-t border-white/10">
          <button className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/5 transition-colors">
            <LogOut className="w-5 h-5 shrink-0" />
            <span>Logout</span>
          </button>
          <div className="flex items-center gap-2 px-3 py-3 mt-2 text-xs text-white/40">
            <Lock className="w-3.5 h-3.5" />
            <span>256-bit encrypted</span>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="lg:pl-60">
        {/* Top header */}
        <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 bg-white border-b border-border lg:px-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-2 rounded-lg lg:hidden hover:bg-gray-100"
            >
              <Menu className="w-5 h-5 text-text-primary" />
            </button>
            <h1 className="text-lg font-semibold text-text-primary capitalize">
              {pathname === "/dashboard" ? "Dashboard" : pathname.split("/").filter(Boolean)[0]?.replace(/-/g, " ") || "Dashboard"}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm font-medium text-text-primary sm:block">
              James Okonkwo
            </span>
            <Avatar className="w-9 h-9">
              <AvatarFallback className="bg-ocean/10 text-ocean text-sm font-medium">
                JO
              </AvatarFallback>
            </Avatar>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
