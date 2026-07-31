import type { Court } from "@/types/venue";

export type WishlistItemType = "VENUE" | "COURT";

export type WishlistVenueSummary = {
  id: number;
  name: string;
  area: string;
  city: string;
  address: string;
  facilities: string[];
  court_count: number;
  minimum_price: string | null;
  primary_image: string;
};

export type WishlistCourtSummary = Pick<Court, "id" | "name" | "court_type" | "surface_type" | "venue"> & {
  venue_name: string;
  venue_area: string;
  venue_city: string;
  lowest_price: string | null;
  primary_image: string;
};

export type WishlistItem = {
  id: number;
  item_type: WishlistItemType;
  venue: number | null;
  court: number | null;
  venue_detail: WishlistVenueSummary | null;
  court_detail: WishlistCourtSummary | null;
  note: string;
  created_at: string;
};

export type WishlistSummary = {
  venue_ids: number[];
  court_ids: number[];
};
