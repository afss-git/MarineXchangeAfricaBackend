"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { PageTour } from "@/components/tour/tour-engine";
import { MARKETPLACE_TOUR } from "@/components/tour/tour-definitions";
import Link from "next/link";
import {
  Search,
  SlidersHorizontal,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type CategoryResponse } from "@/lib/api";
import { useMarketplace, useMarketplaceCategories } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const conditions = [
  { id: "all", label: "All Conditions" },
  { id: "new", label: "New" },
  { id: "used", label: "Used" },
  { id: "refurbished", label: "Refurbished" },
];

const africanCountries = [
  "Nigeria", "South Africa", "Ghana", "Kenya", "Egypt",
  "Morocco", "Tanzania", "Angola", "Mozambique", "Senegal",
];

function CardSkeleton() {
  return (
    <div className="bg-white border border-border rounded-xl overflow-hidden animate-pulse">
      <div className="h-48 bg-gray-200" />
      <div className="p-4 space-y-3">
        <div className="h-4 bg-gray-200 rounded w-3/4" />
        <div className="h-3 bg-gray-200 rounded w-full" />
        <div className="h-3 bg-gray-200 rounded w-2/3" />
        <div className="h-4 bg-gray-200 rounded w-1/2 mt-2" />
        <div className="h-9 bg-gray-200 rounded mt-3" />
      </div>
    </div>
  );
}

function countryFlag(country: string): string {
  const flags: Record<string, string> = {
    nigeria: "🇳🇬", "south africa": "🇿🇦", ghana: "🇬🇭", kenya: "🇰🇪",
    egypt: "🇪🇬", morocco: "🇲🇦", tanzania: "🇹🇿", angola: "🇦🇴",
    mozambique: "🇲🇿", senegal: "🇸🇳",
  };
  return flags[country.toLowerCase()] ?? "🌍";
}

export default function MarketplacePage() {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCondition, setSelectedCondition] = useState("all");
  const [priceRange, setPriceRange] = useState([0, 5000000]);
  const [selectedCountry, setSelectedCountry] = useState("all");
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const [selectedCategoryId, setSelectedCategoryId] = useState("");

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, selectedCondition, selectedCountry, selectedCategoryId, priceRange]);

  const { data, isLoading, error: swrError, mutate } = useMarketplace({
    page: currentPage,
    page_size: 12,
    q: debouncedSearch || undefined,
    condition: selectedCondition !== "all" ? selectedCondition : undefined,
    location_country: selectedCountry !== "all" ? selectedCountry : undefined,
    category_id: selectedCategoryId || undefined,
    min_price: priceRange[0] > 0 ? priceRange[0] : undefined,
    max_price: priceRange[1] < 5000000 ? priceRange[1] : undefined,
  });
  const { data: categories = [] } = useMarketplaceCategories();
  const error = swrError?.message ?? null;

  const clearFilters = () => {
    setSelectedCategoryId("");
    setSelectedCondition("all");
    setPriceRange([0, 5000000]);
    setSelectedCountry("all");
    setSearchQuery("");
  };

  return (
    <div className="space-y-6">
      {user?.id && (
        <PageTour pageKey="marketplace" userId={String(user.id)} steps={MARKETPLACE_TOUR} />
      )}

      {/* Top Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div data-tour="marketplace-search" className="relative flex-1 max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
          <Input
            type="text"
            placeholder="Search vessels, equipment, machinery..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-11 bg-white border-border"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="lg:hidden"
            onClick={() => setShowMobileFilters(!showMobileFilters)}
          >
            <SlidersHorizontal className="w-4 h-4 mr-2" />
            Filters
          </Button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Filter Sidebar */}
        <aside
          className={cn(
            showMobileFilters ? "fixed inset-0 z-50 bg-white p-4 overflow-y-auto" : "hidden",
            "lg:block lg:static lg:w-64 lg:shrink-0"
          )}
        >
          <div className="bg-white border border-border rounded-xl p-5 space-y-6 lg:sticky lg:top-24">
            <div className="flex items-center justify-between lg:hidden">
              <h3 className="font-semibold text-text-primary">Filters</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowMobileFilters(false)}>
                Close
              </Button>
            </div>

            {/* Categories from API */}
            {categories.length > 0 && (
              <div>
                <h4 className="font-medium text-text-primary mb-3">Categories</h4>
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2.5">
                    <Checkbox
                      id="cat-all"
                      checked={selectedCategoryId === ""}
                      onCheckedChange={() => setSelectedCategoryId("")}
                      className="border-border data-[state=checked]:bg-ocean data-[state=checked]:border-ocean"
                    />
                    <Label htmlFor="cat-all" className="text-sm text-text-secondary cursor-pointer">
                      All Categories
                    </Label>
                  </div>
                  {categories.map((cat) => (
                    <div key={cat.id} className="flex items-center gap-2.5">
                      <Checkbox
                        id={cat.id}
                        checked={selectedCategoryId === cat.id}
                        onCheckedChange={() =>
                          setSelectedCategoryId(selectedCategoryId === cat.id ? "" : cat.id)
                        }
                        className="border-border data-[state=checked]:bg-ocean data-[state=checked]:border-ocean"
                      />
                      <Label htmlFor={cat.id} className="text-sm text-text-secondary cursor-pointer">
                        {cat.name}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Price Range */}
            <div>
              <h4 className="font-medium text-text-primary mb-3">Price Range (USD)</h4>
              <div className="space-y-4">
                <Slider
                  value={priceRange}
                  onValueChange={setPriceRange}
                  min={0}
                  max={5000000}
                  step={50000}
                  className="[&_[data-slot=slider-range]]:bg-ocean [&_[data-slot=slider-thumb]]:border-ocean"
                />
                <div className="flex items-center justify-between text-xs text-text-secondary">
                  <span>{priceRange[0] > 0 ? `$${(priceRange[0] / 1000).toFixed(0)}K` : "Any"}</span>
                  <span>{priceRange[1] < 5000000 ? `$${(priceRange[1] / 1000000).toFixed(1)}M` : "Any"}</span>
                </div>
              </div>
            </div>

            {/* Condition */}
            <div>
              <h4 className="font-medium text-text-primary mb-3">Condition</h4>
              <div className="space-y-2.5">
                {conditions.map((condition) => (
                  <div key={condition.id} className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      id={`condition-${condition.id}`}
                      name="condition"
                      checked={selectedCondition === condition.id}
                      onChange={() => setSelectedCondition(condition.id)}
                      className="w-4 h-4 text-ocean border-border focus:ring-ocean"
                    />
                    <Label
                      htmlFor={`condition-${condition.id}`}
                      className="text-sm text-text-secondary cursor-pointer"
                    >
                      {condition.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* Country */}
            <div>
              <h4 className="font-medium text-text-primary mb-3">Country</h4>
              <Select value={selectedCountry} onValueChange={setSelectedCountry}>
                <SelectTrigger className="w-full bg-white">
                  <SelectValue placeholder="Any country" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any country</SelectItem>
                  {africanCountries.map((country) => (
                    <SelectItem key={country} value={country}>
                      {country}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <button
              onClick={clearFilters}
              className="w-full text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              Clear All Filters
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Results count */}
          <p className="text-sm text-text-secondary mb-4">
            {isLoading
              ? "Loading listings..."
              : data
              ? <>Showing <span className="font-medium text-text-primary">{data.items.length}</span> of{" "}
                  <span className="font-medium text-text-primary">{data.total}</span> listings</>
              : ""}
          </p>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger mb-4">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span className="text-sm">{error}</span>
              <Button variant="outline" size="sm" onClick={() => mutate()} className="ml-auto border-danger/30 text-danger">
                Retry
              </Button>
            </div>
          )}

          {/* Listing Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)
              : data?.items.length === 0
              ? (
                <div className="col-span-full flex flex-col items-center justify-center py-20 text-center">
                  <Package className="w-12 h-12 text-gray-200 mb-4" />
                  <p className="text-text-primary font-medium">No listings found</p>
                  <p className="text-text-secondary text-sm mt-1">Try adjusting your filters or search term</p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                    Clear Filters
                  </Button>
                </div>
              )
              : data?.items.map((listing, index) => (
                <div
                  key={listing.id}
                  {...(index === 0 ? { "data-tour": "marketplace-first-card" } : {})}
                  className="bg-white border border-border rounded-xl overflow-hidden hover:shadow-lg transition-shadow group"
                >
                  {/* Image */}
                  <div className="relative h-48 bg-gray-100">
                    {listing.primary_image_url ? (
                      <img
                        src={listing.primary_image_url}
                        alt={listing.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="w-10 h-10 text-gray-300" />
                      </div>
                    )}
                    {listing.category_name && (
                      <Badge className="absolute top-3 left-3 bg-ocean hover:bg-ocean text-white text-xs">
                        {listing.category_name}
                      </Badge>
                    )}
                  </div>

                  {/* Body */}
                  <div className="p-4">
                    <h3 className="font-semibold text-text-primary line-clamp-1 group-hover:text-ocean transition-colors">
                      {listing.title}
                    </h3>
                    <div className="flex items-center gap-1 mt-2 text-sm text-text-secondary">
                      <span>{countryFlag(listing.location_country)}</span>
                      <span>{listing.location_country}</span>
                      {listing.location_port && <span>· {listing.location_port}</span>}
                    </div>
                    <p className="font-semibold text-navy mt-2">
                      ${Number(listing.asking_price).toLocaleString()} {listing.currency}
                    </p>
                    <p className="text-xs text-text-secondary mt-1 capitalize">
                      {listing.condition} · {listing.availability_type.replace(/_/g, " ")}
                    </p>
                  </div>

                  <div className="px-4 pb-4">
                    <Link href={`/marketplace/${listing.id}`}>
                      <Button className="w-full bg-ocean hover:bg-ocean-dark text-white">
                        View Details
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
          </div>

          {/* Pagination */}
          {data && data.pages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1 || isLoading}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              {Array.from({ length: Math.min(data.pages, 5) }, (_, i) => i + 1).map((page) => (
                <Button
                  key={page}
                  variant={currentPage === page ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCurrentPage(page)}
                  className={currentPage === page ? "bg-ocean hover:bg-ocean-dark text-white" : ""}
                >
                  {page}
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === data.pages || isLoading}
                onClick={() => setCurrentPage((p) => Math.min(data.pages, p + 1))}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}

          {/* Security Badge */}
          <div className="flex items-center justify-center gap-2 mt-8 py-4 text-sm text-text-secondary">
            <ShieldCheck className="w-5 h-5 text-ocean" />
            <span>All sellers are KYC-verified. Transactions are escrow-protected.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
