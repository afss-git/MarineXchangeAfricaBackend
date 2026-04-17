"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
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
  Lock,
  Gavel,
  Bell,
  BarChart3,
  Users,
  Package,
  Settings,
  TrendingUp,
  Banknote,
  ClipboardList,
  Search,
  BadgeCheck,
  UserCircle,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { notifications as notifApi } from "@/lib/api";
import { usePageLoader } from "@/components/page-loader";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  roles?: string[];
  badge?: number;
  tourKey?: string;
};

// ── Buyer / Seller nav ────────────────────────────────────────────────────────

const buyerSellerNav: NavItem[] = [
  { href: "/dashboard",          label: "Dashboard",         icon: LayoutDashboard },
  { href: "/marketplace",        label: "Marketplace",       icon: Store,        tourKey: "nav-marketplace" },
  { href: "/auctions",           label: "Auctions",          icon: Gavel },
  { href: "/purchase-requests",  label: "Purchase Requests", icon: FileText },
  { href: "/deals",              label: "My Deals",          icon: Handshake },
  { href: "/seller/listings",    label: "My Listings",       icon: Package,      roles: ["seller", "buyer_seller", "admin"] },
  { href: "/kyc",                label: "KYC Verification",  icon: ShieldCheck,  tourKey: "nav-kyc", roles: ["buyer", "buyer_seller", "admin"] },
  { href: "/profile",            label: "Profile",           icon: User },
];

// ── Admin nav ─────────────────────────────────────────────────────────────────

const adminNav: NavItem[] = [
  { href: "/admin",                   label: "Admin Dashboard",    icon: BarChart3 },
  { href: "/admin/users",             label: "Users",              icon: Users },
  { href: "/admin/buyers",            label: "Buyers",             icon: UserCircle },
  { href: "/admin/sellers",           label: "Sellers",            icon: Building2 },
  { href: "/admin/kyc",               label: "KYC Review",         icon: ShieldCheck },
  { href: "/admin/marketplace",       label: "Marketplace",        icon: Store },
  { href: "/admin/purchase-requests", label: "Purchase Requests",  icon: FileText },
  { href: "/admin/deals",             label: "Deal Management",    icon: Handshake },
  { href: "/admin/auctions",          label: "Auctions",           icon: Gavel },
  { href: "/admin/finance",           label: "Finance Queue",      icon: Banknote },
  { href: "/admin/reports",           label: "Reports",            icon: TrendingUp },
  { href: "/admin/exchange-rates",    label: "Exchange Rates",     icon: TrendingUp },
  { href: "/admin/settings",          label: "Deal Settings",      icon: Settings },
];

// ── Agent nav (verification_agent + buyer_agent) ──────────────────────────────

const agentKycNav: NavItem[] = [
  { href: "/agent/kyc",               label: "KYC Queue",          icon: ShieldCheck },
  { href: "/agent/purchase-requests", label: "Due Diligence",      icon: ClipboardList },
];

const agentVerificationNav: NavItem[] = [
  { href: "/agent/marketplace",       label: "Verification Queue", icon: Search },
];

const agentSharedNav: NavItem[] = [
  { href: "/profile",                 label: "Profile",            icon: User },
];

// ── Nav link component ────────────────────────────────────────────────────────

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      {...(item.tourKey ? { "data-tour": item.tourKey } : {})}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
        active
          ? "bg-white/10 text-white"
          : "text-white/70 hover:text-white hover:bg-white/6"
      )}
    >
      <item.icon className={cn("w-5 h-5 shrink-0", active ? "text-ocean" : "")} />
      <span className="flex-1">{item.label}</span>
      {item.badge != null && item.badge > 0 && (
        <span className="text-xs bg-danger text-white rounded-full min-w-4.5 h-4.5 flex items-center justify-center px-1">
          {item.badge > 99 ? "99+" : item.badge}
        </span>
      )}
    </Link>
  );
}

function NavSection({ label, items, pathname, onNavigate }: { label: string; items: NavItem[]; pathname: string; onNavigate: () => void }) {
  return (
    <div className="space-y-1">
      <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/40">
        {label}
      </p>
      {items.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          onNavigate={onNavigate}
          active={
            item.href === "/dashboard" || item.href === "/admin" || item.href === "/agent/kyc"
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(item.href + "/")
          }
        />
      ))}
    </div>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const { show: showLoader, hide: hideLoader } = usePageLoader();
  const loaderRef = useRef({ show: showLoader, hide: hideLoader });
  loaderRef.current = { show: showLoader, hide: hideLoader };
  const prevPathname = useRef(pathname);

  // Hide loader once the new route has rendered
  useEffect(() => {
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname;
      loaderRef.current.hide();
    }
  }, [pathname]);

  // Show loader while auth is resolving, hide once done
  useEffect(() => {
    if (isLoading) {
      loaderRef.current.show();
    } else {
      loaderRef.current.hide();
      if (!isAuthenticated) router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    notifApi.unreadCount()
      .then((res) => setUnreadCount(res.unread_count))
      .catch(() => {/* silent */});
  }, [isAuthenticated, pathname]);

  if (isLoading) {
    // PageLoaderProvider is above us in the tree — render blank bg, loader overlay handles it
    return <div className="min-h-screen bg-surface" />;
  }

  if (!isAuthenticated) return null;

  const roles = user?.roles ?? [];
  const isAdmin        = roles.includes("admin") || roles.includes("finance_admin");
  const isKycAgent     = roles.includes("buyer_agent");
  const isVerifAgent   = roles.includes("verification_agent");
  const isAgent        = isKycAgent || isVerifAgent;

  // Build nav items based on role priority: admin > agent > buyer/seller
  const renderNav = () => {
    if (isAdmin) {
      return (
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {adminNav.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              onNavigate={showLoader}
              active={
                item.href === "/admin"
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(item.href + "/")
              }
            />
          ))}
        </nav>
      );
    }

    if (isAgent) {
      return (
        <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-2">
          {isKycAgent && (
            <NavSection label="KYC & Due Diligence" items={agentKycNav} pathname={pathname} onNavigate={showLoader} />
          )}
          {isVerifAgent && (
            <NavSection label="Marketplace" items={agentVerificationNav} pathname={pathname} onNavigate={showLoader} />
          )}
          <NavSection label="Account" items={agentSharedNav} pathname={pathname} onNavigate={showLoader} />
        </nav>
      );
    }

    // Buyer / Seller
    const filtered = buyerSellerNav.filter((item) => {
      if (!item.roles) return true;
      return item.roles.some((r) => roles.includes(r));
    });
    return (
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {filtered.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            onNavigate={showLoader}
            active={
              item.href === "/dashboard"
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(item.href + "/")
            }
          />
        ))}
      </nav>
    );
  };

  // Role badge label + color
  const roleBadge = (() => {
    if (roles.includes("admin"))          return { label: "Admin Panel",         className: "bg-warning/10 border-warning/20 text-warning" };
    if (roles.includes("finance_admin"))  return { label: "Finance Admin",       className: "bg-ocean/10 border-ocean/20 text-ocean" };
    if (isKycAgent && isVerifAgent)       return { label: "Agent",               className: "bg-success/10 border-success/20 text-success" };
    if (isKycAgent)                       return { label: "KYC / Due Diligence Agent", className: "bg-success/10 border-success/20 text-success" };
    if (isVerifAgent)                     return { label: "Verification Agent",  className: "bg-success/10 border-success/20 text-success" };
    return null;
  })();

  const initials = user?.full_name
    ? user.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "?";

  // Derive readable page title from pathname
  const segments = pathname.split("/").filter(Boolean);
  const pageTitle = (() => {
    if (pathname === "/dashboard") return "Dashboard";
    if (pathname === "/admin")     return "Admin Dashboard";
    const toTitle = (s: string) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    if (pathname.startsWith("/admin/"))  return segments.slice(1).map(toTitle).join(" / ");
    if (pathname.startsWith("/agent/"))  return segments.slice(1).map(toTitle).join(" / ");
    if (pathname.startsWith("/seller/listings/new")) return "New Listing";
    if (pathname.match(/^\/seller\/listings\/[^/]+$/)) return "Listing Details";
    if (pathname.startsWith("/seller/listings"))     return "My Listings";
    if (segments[segments.length - 1]?.match(/^[a-z]+-\d+$|^\d+$/)) {
      return segments[segments.length - 2]?.replace(/-/g, " ") ?? "";
    }
    return segments[0]?.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ?? "Dashboard";
  })();

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
          "fixed inset-y-0 left-0 z-50 w-60 flex flex-col transition-transform duration-300 lg:translate-x-0 sidebar-gradient",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-5 py-5 border-b border-white/10">
          <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center bg-white/10">
            <Image src="/logo.jpeg" alt="Harbours360" width={36} height={36} className="w-full h-full object-contain" />
          </div>
          <div className="flex items-baseline tracking-tight">
            <span className="text-lg font-extrabold text-white">Harbours</span>
            <span className="text-lg font-extrabold text-ocean">360</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto lg:hidden text-white/70 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Role badge */}
        {roleBadge && (
          <div className={cn("mx-4 mt-3 px-3 py-1.5 rounded-lg border", roleBadge.className)}>
            <div className="flex items-center justify-center gap-1.5">
              <BadgeCheck className="w-3.5 h-3.5" />
              <p className="text-xs font-semibold text-center">{roleBadge.label}</p>
            </div>
          </div>
        )}

        {/* Navigation */}
        {renderNav()}

        {/* Footer */}
        <div className="px-3 py-4 border-t border-white/10">
          <button
            onClick={() => logout()}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/6 transition-colors"
          >
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
        <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 bg-white/95 backdrop-blur-sm border-b border-border shadow-[0_1px_3px_0_rgb(0_0_0/0.06)] lg:px-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-2 rounded-lg lg:hidden hover:bg-gray-100"
            >
              <Menu className="w-5 h-5 text-text-primary" />
            </button>
            <h1 className="text-lg font-semibold text-text-primary">
              {pageTitle}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {/* Notifications bell */}
            <Link href="/notifications" data-tour="notifications-bell">
              <Button variant="ghost" size="sm" className="relative w-9 h-9 p-0">
                <Bell className="w-5 h-5 text-text-secondary" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Button>
            </Link>

            <span className="hidden text-sm font-medium text-text-primary sm:block">
              {user?.full_name ?? ""}
            </span>
            <Link href="/profile" data-tour="profile-link">
              <Avatar className="w-9 h-9 cursor-pointer hover:ring-2 hover:ring-ocean/30 transition-all">
                <AvatarFallback className="bg-ocean/10 text-ocean text-sm font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </Link>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 lg:p-6">{children}</main>
      </div>

    </div>
  );
}
