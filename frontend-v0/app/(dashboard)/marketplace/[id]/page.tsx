"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Star,
  Lock,
  FileCheck,
  Download,
  Heart,
  ChevronLeft,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const specifications = [
  { label: "Year Built", value: "2018" },
  { label: "Length", value: "85m" },
  { label: "Gross Tonnage", value: "3,200 GT" },
  { label: "Engine", value: "Caterpillar 3516C" },
  { label: "Flag State", value: "Nigeria" },
  { label: "Classification", value: "Bureau Veritas" },
  { label: "Condition", value: "Used – Good" },
];

const documents = [
  { name: "Technical Specs.pdf", icon: FileText },
  { name: "Survey Report.pdf", icon: FileText },
  { name: "Class Certificate.pdf", icon: FileText },
];

const similarListings = [
  {
    id: "2",
    title: "Platform Supply Vessel — 2019",
    category: "Vessels & Ships",
    country: "Ghana",
    flag: "🇬🇭",
    price: "$2,100,000 – $2,400,000",
    verified: true,
  },
  {
    id: "3",
    title: "Anchor Handling Tug — 2017",
    category: "Vessels & Ships",
    country: "Angola",
    flag: "🇦🇴",
    price: "$3,200,000 – $3,600,000",
    verified: true,
  },
  {
    id: "4",
    title: "Crew Boat — 2020 Build",
    category: "Vessels & Ships",
    country: "Nigeria",
    flag: "🇳🇬",
    price: "$850,000 – $950,000",
    verified: false,
  },
  {
    id: "5",
    title: "Fast Support Vessel — 2016",
    category: "Vessels & Ships",
    country: "South Africa",
    flag: "🇿🇦",
    price: "$1,800,000 – $2,100,000",
    verified: true,
  },
];

export default function AssetDetailPage() {
  const [selectedImage, setSelectedImage] = useState(0);
  const [isSaved, setIsSaved] = useState(false);

  return (
    <div className="space-y-8">
      {/* Back button */}
      <Link
        href="/marketplace"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-ocean transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Marketplace
      </Link>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Left Column */}
        <div className="lg:col-span-3 space-y-6">
          {/* Image Gallery */}
          <div className="space-y-3">
            <div className="relative h-72 md:h-96 bg-gray-200 rounded-xl overflow-hidden">
              <div className="absolute inset-0 flex items-center justify-center text-text-secondary">
                Main Image
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {[0, 1, 2, 3].map((i) => (
                <button
                  key={i}
                  onClick={() => setSelectedImage(i)}
                  className={`shrink-0 w-20 h-20 bg-gray-200 rounded-lg overflow-hidden border-2 transition-colors ${
                    selectedImage === i ? "border-ocean" : "border-transparent"
                  }`}
                >
                  <div className="w-full h-full flex items-center justify-center text-xs text-text-secondary">
                    Thumb {i + 1}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Title & Tags */}
          <div className="space-y-3">
            <div className="flex items-start gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-text-primary">
                Offshore Supply Vessel — 2018 Build
              </h1>
              <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                <ShieldCheck className="w-3 h-3 mr-1" />
                Verified Listing
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">Vessels & Ships</Badge>
              <Badge variant="secondary">🇳🇬 Nigeria</Badge>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">Description</h2>
            <div className="prose prose-sm text-text-secondary max-w-none">
              <p>
                This well-maintained Offshore Supply Vessel (OSV) was built in 2018 and has been
                operating primarily in West African waters. The vessel is equipped with a dynamic
                positioning system (DP2) and features a spacious deck area suitable for cargo
                transportation and offshore support operations.
              </p>
              <p>
                The vessel has undergone regular maintenance and all class certificates are current.
                The engines have been recently overhauled and are in excellent working condition.
                This is an ideal vessel for companies looking to expand their offshore support fleet
                in the region.
              </p>
            </div>
          </div>

          {/* Specifications */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">Specifications</h2>
            <div className="grid grid-cols-2 gap-3">
              {specifications.map((spec) => (
                <div
                  key={spec.label}
                  className="flex justify-between py-2.5 px-3 bg-gray-50 rounded-lg"
                >
                  <span className="text-sm text-text-secondary">{spec.label}</span>
                  <span className="text-sm font-medium text-text-primary">{spec.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Documents */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">Documents Available</h2>
            <div className="space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.name}
                  className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <doc.icon className="w-5 h-5 text-text-secondary" />
                    <span className="text-sm text-text-primary">{doc.name}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled
                    className="text-text-secondary"
                    title="Available after purchase request accepted"
                  >
                    <Download className="w-4 h-4 mr-1" />
                    Download
                  </Button>
                </div>
              ))}
              <p className="text-xs text-text-secondary">
                Documents are available after your purchase request is accepted.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-border rounded-xl p-6 shadow-sm lg:sticky lg:top-24 space-y-5">
            {/* Price */}
            <div>
              <p className="text-2xl font-bold text-navy">$2,400,000 – $2,800,000</p>
              <Badge className="mt-2 bg-green-100 text-green-700 hover:bg-green-100">
                Negotiable
              </Badge>
            </div>

            {/* Seller Info */}
            <div className="flex items-start gap-3 py-4 border-t border-b border-border">
              <Avatar className="w-12 h-12">
                <AvatarFallback className="bg-ocean/10 text-ocean font-semibold">OA</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-text-primary">Ocean Assets Ltd</p>
                <div className="flex items-center gap-1 text-sm text-green-600 mt-0.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Verified Seller</span>
                </div>
                <p className="text-sm text-text-secondary mt-1">Lagos, Nigeria</p>
                <p className="text-xs text-text-secondary">Member since 2022</p>
                <div className="flex items-center gap-1 mt-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`w-4 h-4 ${
                        star <= 4 ? "fill-ocean text-ocean" : "fill-ocean/30 text-ocean/30"
                      }`}
                    />
                  ))}
                  <span className="text-sm text-text-secondary ml-1">4.8 (12 reviews)</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <Button className="w-full h-12 bg-ocean hover:bg-ocean-dark text-white font-semibold">
                Send Purchase Request
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setIsSaved(!isSaved)}
              >
                <Heart
                  className={`w-4 h-4 mr-2 ${isSaved ? "fill-red-500 text-red-500" : ""}`}
                />
                {isSaved ? "Saved to Watchlist" : "Save to Watchlist"}
              </Button>
            </div>

            {/* Security Assurance */}
            <div className="bg-navy/5 border border-navy/10 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <ShieldCheck className="w-4 h-4 text-ocean shrink-0" />
                <span className="text-text-primary">Escrow-protected transaction</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Lock className="w-4 h-4 text-ocean shrink-0" />
                <span className="text-text-primary">KYC-verified seller</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <FileCheck className="w-4 h-4 text-ocean shrink-0" />
                <span className="text-text-primary">Audited deal trail</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Similar Listings */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-text-primary">Similar Listings</h2>
        <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 lg:mx-0 lg:px-0">
          {similarListings.map((listing) => (
            <Link
              key={listing.id}
              href={`/marketplace/${listing.id}`}
              className="shrink-0 w-72 bg-white border border-border rounded-xl overflow-hidden hover:shadow-lg transition-shadow group"
            >
              <div className="relative h-36 bg-gray-200">
                <Badge className="absolute top-3 left-3 bg-ocean hover:bg-ocean text-white text-xs">
                  {listing.category}
                </Badge>
                {listing.verified && (
                  <div className="absolute top-3 right-3 flex items-center gap-1 bg-green-500 text-white text-xs px-2 py-1 rounded-full">
                    <ShieldCheck className="w-3 h-3" />
                    <span>Verified</span>
                  </div>
                )}
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-text-primary line-clamp-1 group-hover:text-ocean transition-colors">
                  {listing.title}
                </h3>
                <div className="flex items-center gap-1 mt-2 text-sm text-text-secondary">
                  <span>{listing.flag}</span>
                  <span>{listing.country}</span>
                </div>
                <p className="font-semibold text-navy mt-2 text-sm">{listing.price}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
