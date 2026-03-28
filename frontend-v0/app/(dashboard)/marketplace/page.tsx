"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Search,
  SlidersHorizontal,
  ChevronDown,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
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

const categories = [
  { id: "vessels", label: "Vessels & Ships" },
  { id: "offshore", label: "Offshore Equipment" },
  { id: "machinery", label: "Industrial Machinery" },
  { id: "spare-parts", label: "Spare Parts & Components" },
  { id: "electronics", label: "Marine Electronics" },
  { id: "other", label: "Other" },
];

const conditions = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "used", label: "Used" },
  { id: "refurbished", label: "Refurbished" },
];

const africanCountries = [
  "Nigeria",
  "South Africa",
  "Ghana",
  "Kenya",
  "Egypt",
  "Morocco",
  "Tanzania",
  "Angola",
  "Mozambique",
  "Senegal",
];

const listings = [
  {
    id: "1",
    title: "Offshore Supply Vessel — 2018 Build",
    description: "Well-maintained OSV with dynamic positioning system. Ideal for offshore operations.",
    category: "Vessels & Ships",
    country: "Nigeria",
    flag: "🇳🇬",
    priceRange: "$2,400,000 – $2,800,000",
    postedDays: 2,
    verified: true,
  },
  {
    id: "2",
    title: "Caterpillar 3516C Marine Engine",
    description: "Low-hour diesel engine, fully overhauled. Comes with documentation and warranty.",
    category: "Spare Parts",
    country: "South Africa",
    flag: "🇿🇦",
    priceRange: "$120,000 – $150,000",
    postedDays: 5,
    verified: true,
  },
  {
    id: "3",
    title: "Anchor Handling Tug Supply Vessel",
    description: "AHTS vessel suitable for anchor handling and towing operations in deep water.",
    category: "Vessels & Ships",
    country: "Ghana",
    flag: "🇬🇭",
    priceRange: "$3,200,000 – $3,800,000",
    postedDays: 1,
    verified: false,
  },
  {
    id: "4",
    title: "Offshore Crane — 50 Ton Capacity",
    description: "Liebherr offshore crane with pedestal mount. Recently inspected and certified.",
    category: "Offshore Equipment",
    country: "Angola",
    flag: "🇦🇴",
    priceRange: "$450,000 – $520,000",
    postedDays: 7,
    verified: true,
  },
  {
    id: "5",
    title: "Marine Navigation System Bundle",
    description: "Complete bridge navigation package including radar, ECDIS, and AIS systems.",
    category: "Marine Electronics",
    country: "Kenya",
    flag: "🇰🇪",
    priceRange: "$85,000 – $95,000",
    postedDays: 3,
    verified: true,
  },
  {
    id: "6",
    title: "Industrial Generator Set 2MW",
    description: "Cummins QSK60 generator set. Suitable for marine or industrial applications.",
    category: "Industrial Machinery",
    country: "Egypt",
    flag: "🇪🇬",
    priceRange: "$280,000 – $320,000",
    postedDays: 4,
    verified: false,
  },
];

export default function MarketplacePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedCondition, setSelectedCondition] = useState("all");
  const [priceRange, setPriceRange] = useState([0, 5000000]);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const toggleCategory = (categoryId: string) => {
    setSelectedCategories((prev) =>
      prev.includes(categoryId)
        ? prev.filter((c) => c !== categoryId)
        : [...prev, categoryId]
    );
  };

  const clearFilters = () => {
    setSelectedCategories([]);
    setSelectedCondition("all");
    setPriceRange([0, 5000000]);
  };

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-xl">
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
          <Select defaultValue="newest">
            <SelectTrigger className="w-40 h-10 bg-white">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="price-low">Price: Low to High</SelectItem>
              <SelectItem value="price-high">Price: High to Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Filter Sidebar */}
        <aside
          className={`
            ${showMobileFilters ? "fixed inset-0 z-50 bg-white p-4 overflow-y-auto" : "hidden"}
            lg:block lg:static lg:w-72 lg:shrink-0
          `}
        >
          <div className="bg-white border border-border rounded-xl p-5 space-y-6 lg:sticky lg:top-24">
            {/* Mobile close button */}
            <div className="flex items-center justify-between lg:hidden">
              <h3 className="font-semibold text-text-primary">Filters</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowMobileFilters(false)}>
                Close
              </Button>
            </div>

            {/* Categories */}
            <div>
              <h4 className="font-medium text-text-primary mb-3">Categories</h4>
              <div className="space-y-2.5">
                {categories.map((category) => (
                  <div key={category.id} className="flex items-center gap-2.5">
                    <Checkbox
                      id={category.id}
                      checked={selectedCategories.includes(category.id)}
                      onCheckedChange={() => toggleCategory(category.id)}
                      className="border-border data-[state=checked]:bg-ocean data-[state=checked]:border-ocean"
                    />
                    <Label
                      htmlFor={category.id}
                      className="text-sm text-text-secondary cursor-pointer"
                    >
                      {category.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* Price Range */}
            <div>
              <h4 className="font-medium text-text-primary mb-3">Price Range</h4>
              <div className="space-y-4">
                <Slider
                  value={priceRange}
                  onValueChange={setPriceRange}
                  min={0}
                  max={5000000}
                  step={50000}
                  className="[&_[data-slot=slider-range]]:bg-ocean [&_[data-slot=slider-thumb]]:border-ocean"
                />
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    placeholder="Min USD"
                    value={priceRange[0] > 0 ? `$${priceRange[0].toLocaleString()}` : ""}
                    readOnly
                    className="h-9 text-sm bg-white"
                  />
                  <span className="text-text-secondary">–</span>
                  <Input
                    type="text"
                    placeholder="Max USD"
                    value={priceRange[1] < 5000000 ? `$${priceRange[1].toLocaleString()}` : ""}
                    readOnly
                    className="h-9 text-sm bg-white"
                  />
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
              <Select>
                <SelectTrigger className="w-full bg-white">
                  <SelectValue placeholder="Select countries" />
                </SelectTrigger>
                <SelectContent>
                  {africanCountries.map((country) => (
                    <SelectItem key={country} value={country.toLowerCase()}>
                      {country}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-2">
              <Button className="w-full bg-ocean hover:bg-ocean-dark text-white">
                Apply Filters
              </Button>
              <button
                onClick={clearFilters}
                className="w-full text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                Clear All
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Results count */}
          <p className="text-sm text-text-secondary mb-4">
            Showing <span className="font-medium text-text-primary">12</span> of{" "}
            <span className="font-medium text-text-primary">48</span> listings
          </p>

          {/* Listing Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {listings.map((listing) => (
              <div
                key={listing.id}
                className="bg-white border border-border rounded-xl overflow-hidden hover:shadow-lg transition-shadow group"
              >
                {/* Image */}
                <div className="relative h-48 bg-gray-200">
                  <Badge className="absolute top-3 left-3 bg-ocean hover:bg-ocean text-white text-xs">
                    {listing.category}
                  </Badge>
                  {listing.verified && (
                    <div className="absolute top-3 right-3 flex items-center gap-1 bg-green-500 text-white text-xs px-2 py-1 rounded-full">
                      <ShieldCheck className="w-3 h-3" />
                      <span>Verified Seller</span>
                    </div>
                  )}
                </div>

                {/* Body */}
                <div className="p-4">
                  <h3 className="font-semibold text-text-primary line-clamp-1 group-hover:text-ocean transition-colors">
                    {listing.title}
                  </h3>
                  <p className="text-sm text-text-secondary mt-1 line-clamp-2">
                    {listing.description}
                  </p>
                  <div className="flex items-center gap-1 mt-3 text-sm text-text-secondary">
                    <span>{listing.flag}</span>
                    <span>{listing.country}</span>
                  </div>
                  <p className="font-semibold text-navy mt-2">{listing.priceRange}</p>
                  <p className="text-xs text-text-secondary mt-1">
                    Posted {listing.postedDays} day{listing.postedDays !== 1 ? "s" : ""} ago
                  </p>
                </div>

                {/* Footer */}
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
          <div className="flex items-center justify-center gap-2 mt-8">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            {[1, 2, 3, 4].map((page) => (
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
              disabled={currentPage === 4}
              onClick={() => setCurrentPage((p) => Math.min(4, p + 1))}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          {/* Security Badge */}
          <div className="flex items-center justify-center gap-2 mt-8 py-4 text-sm text-text-secondary">
            <ShieldCheck className="w-5 h-5 text-ocean" />
            <span>
              All sellers are KYC-verified. Transactions are escrow-protected.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
