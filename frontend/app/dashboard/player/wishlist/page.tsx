"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { DashboardPageHeader } from "@/components/player-dashboard/DashboardPageHeader";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { emitToast } from "@/lib/toast";
import type { WishlistItem } from "@/types/wishlist";

export default function PlayerWishlistPage() {
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadWishlist();
  }, []);

  async function loadWishlist() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<{ items: WishlistItem[] }>("/api/wishlist/");
      setItems(response.data.items);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load your wishlist right now."));
    } finally {
      setIsLoading(false);
    }
  }

  async function removeItem(itemId: number) {
    try {
      await api.delete(`/api/wishlist/${itemId}/`);
      setItems((currentItems) => currentItems.filter((item) => item.id !== itemId));
      emitToast({ message: "Removed from wishlist.", type: "info", dedupeKey: `wishlist-remove-${itemId}` });
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not update your wishlist."), type: "error" });
    }
  }

  const venueItems = items.filter((item) => item.item_type === "VENUE" && item.venue_detail);
  const courtItems = items.filter((item) => item.item_type === "COURT" && item.court_detail);

  return (
    <main className="space-y-6">
      <DashboardPageHeader description="Keep favourite Cricksal venues and courts ready for your next booking." eyebrow="Saved places" title="My Wishlist" />

      {isLoading ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => <WishlistSkeleton key={index} />)}
        </section>
      ) : error ? (
        <section className="sport-error-state text-center">
          <h2 className="text-xl font-black text-sportNavy">Wishlist could not be loaded.</h2>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
          <button className="sport-primary-button mt-5" onClick={loadWishlist} type="button">Try Again</button>
        </section>
      ) : items.length === 0 ? (
        <section className="sport-empty-state">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-xl font-black text-sportGreen">♡</div>
          <h2 className="mt-5 text-2xl font-black text-sportNavy">Your wishlist is empty.</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">Save venues from Court Discovery so you can compare and book them later.</p>
          <Link className="sport-primary-button mt-5" href="/courts">Find Courts</Link>
        </section>
      ) : (
        <div className="space-y-8">
          {venueItems.length ? (
            <WishlistSection title="Saved Venues">
              {venueItems.map((item) => <VenueWishlistCard item={item} key={item.id} onRemove={removeItem} />)}
            </WishlistSection>
          ) : null}

          {courtItems.length ? (
            <WishlistSection title="Saved Courts">
              {courtItems.map((item) => <CourtWishlistCard item={item} key={item.id} onRemove={removeItem} />)}
            </WishlistSection>
          ) : null}
        </div>
      )}
    </main>
  );
}

function WishlistSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section>
      <h2 className="text-xl font-black text-sportNavy">{title}</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function VenueWishlistCard({ item, onRemove }: { item: WishlistItem; onRemove: (itemId: number) => void }) {
  const venue = item.venue_detail!;
  return (
    <article className="sport-surface overflow-hidden">
      <CardImage alt={venue.name} image={venue.primary_image} name={venue.name} />
      <div className="p-4">
        <h3 className="text-lg font-black text-sportNavy">{venue.name}</h3>
        <p className="mt-1 text-sm font-semibold text-slate-600">{venue.area}, {venue.city}</p>
        <p className="mt-3 text-sm font-black text-sportNavy">{venue.minimum_price ? `From NPR ${Number(venue.minimum_price).toLocaleString("en-NP")}/hour` : "Price not listed"}</p>
        <div className="mt-4 flex gap-2">
          <Link className="sport-primary-button flex-1" href={`/courts/${venue.id}`}>View Courts</Link>
          <button className="sport-secondary-button border-red-200 text-red-700 hover:bg-red-50" onClick={() => onRemove(item.id)} type="button">Remove</button>
        </div>
      </div>
    </article>
  );
}

function CourtWishlistCard({ item, onRemove }: { item: WishlistItem; onRemove: (itemId: number) => void }) {
  const court = item.court_detail!;
  return (
    <article className="sport-surface overflow-hidden">
      <CardImage alt={court.name} image={court.primary_image} name={court.name} />
      <div className="p-4">
        <h3 className="text-lg font-black text-sportNavy">{court.name}</h3>
        <p className="mt-1 text-sm font-semibold text-slate-600">{court.venue_name} · {court.venue_area}, {court.venue_city}</p>
        <p className="mt-3 text-sm font-black text-sportNavy">{court.lowest_price ? `From NPR ${Number(court.lowest_price).toLocaleString("en-NP")}/slot` : "Price not listed"}</p>
        <div className="mt-4 flex gap-2">
          <Link className="sport-primary-button flex-1" href={`/courts/${court.venue}`}>View Venue</Link>
          <button className="sport-secondary-button border-red-200 text-red-700 hover:bg-red-50" onClick={() => onRemove(item.id)} type="button">Remove</button>
        </div>
      </div>
    </article>
  );
}

function CardImage({ alt, image, name }: { alt: string; image: string; name: string }) {
  return image ? (
    <img alt={alt} className="h-40 w-full object-cover" src={image} />
  ) : (
    <div className="flex h-40 items-center justify-center bg-sportNavy text-3xl font-black text-white">{getInitials(name)}</div>
  );
}

function WishlistSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="h-40 animate-pulse bg-slate-200" />
      <div className="space-y-3 p-4">
        <div className="h-5 w-2/3 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
        <div className="h-10 animate-pulse rounded bg-slate-200" />
      </div>
    </div>
  );
}

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "SS";
}
