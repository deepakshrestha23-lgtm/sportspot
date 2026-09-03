export type VenueStatus = "DRAFT" | "PENDING" | "NEEDS_CHANGES" | "APPROVED" | "REJECTED" | "SUSPENDED";
export type SlotStatus = "AVAILABLE" | "RESERVED" | "BOOKED" | "BLOCKED" | "CANCELLED";
export type SlotBlockType = "MAINTENANCE" | "TEMPORARY_CLOSURE" | "PRIVATE_USE" | "VENUE_UNAVAILABLE" | "OTHER";
export type BookingStatus = "RESERVED" | "CONFIRMED" | "CANCELLED" | "EXPIRED" | "COMPLETED";
export type PaymentStatus = "PENDING" | "PAID" | "CANCELLED" | "FAILED" | "REFUND_PENDING" | "REFUNDED" | "PARTIALLY_REFUNDED" | "NO_REFUND";
export type RefundStatus = "NOT_REQUIRED" | "PENDING_OWNER_ACTION" | "NOT_ELIGIBLE" | "REJECTED" | "REFUNDED" | "PARTIALLY_REFUNDED";
export type CancellationTier = "NOT_APPLICABLE" | "UNPAID_RELEASE" | "FULL_REFUND" | "PARTIAL_REFUND" | "NO_REFUND" | "OWNER_FULL_REFUND" | "ADMIN_DECISION";

export type CancellationPolicyDetails = {
  version: number;
  full_refund_hours: number;
  partial_refund_enabled: boolean;
  partial_refund_hours: number;
  partial_refund_percent: number;
  additional_notes: string;
  captured_at: string;
  summary: string[];
};

export type CancellationQuote = {
  can_cancel: boolean;
  tier: CancellationTier;
  refund_percentage: number;
  refund_amount: string;
  refund_required: boolean;
  late_cancellation: boolean;
  hours_until_start: number | null;
  message: string;
  policy: Omit<CancellationPolicyDetails, "summary">;
  policy_summary: string[];
};

export type Venue = {
  id: number;
  owner: number;
  owner_name: string;
  name: string;
  description: string;
  address: string;
  city: string;
  area: string;
  latitude: number | string | null;
  longitude: number | string | null;
  location_source: "MANUAL_PIN" | "GEOCODED" | "DEVICE_LOCATION" | "LEGACY_LINK" | "";
  location_confirmed: boolean;
  location_updated_at: string | null;
  map_location: string;
  contact_phone: string;
  opening_time: string | null;
  closing_time: string | null;
  facilities: string[];
  rules: string;
  cancellation_policy: string;
  cancellation_full_refund_hours: number;
  cancellation_partial_refund_enabled: boolean;
  cancellation_partial_refund_hours: number;
  cancellation_partial_refund_percent: number;
  cancellation_policy_version: number;
  cancellation_policy_details: CancellationPolicyDetails;
  is_active: boolean;
  status: VenueStatus;
  front_photo: string;
  court_area_photo: string;
  additional_photo: string;
  verification_document: string;
  verification_document_type: string;
  declaration_accepted: boolean;
  admin_review_note: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  setup_is_complete: boolean;
  minimum_price: string | null;
  bookings_count: number;
  can_delete: boolean;
  delete_block_reason: string;
  courts: Court[];
  photos: VenuePhoto[];
  created_at: string;
  updated_at: string;
};

export type VenuePhotoCategory = "OUTSIDE" | "COURT_AREA" | "ADDITIONAL";

export type VenuePhoto = {
  id: number;
  venue: number;
  category: VenuePhotoCategory;
  image: string;
  uploaded_at: string;
};

export type Court = {
  id: number;
  venue: number | Venue;
  venue_name: string;
  venue_area: string;
  venue_city: string;
  venue_facilities: string[];
  name: string;
  description: string;
  court_type: "INDOOR" | "OUTDOOR" | "COVERED";
  surface_type: "TURF" | "MAT" | "CEMENT" | "ARTIFICIAL_TURF";
  court_photo: string;
  is_active: boolean;
  lowest_price: string | null;
  future_published_slot_count: number;
  bookings_count: number;
  can_delete: boolean;
  delete_block_reason: string;
  created_at: string;
  updated_at: string;
};

export type PublicCourt = Court & {
  venue: Venue;
};

export type CourtReview = {
  id: number;
  court: number;
  court_name: string;
  booking: number;
  reviewer: number;
  reviewer_name: string;
  rating: number;
  comment: string;
  is_author: boolean;
  like_count: number;
  dislike_count: number;
  my_reaction: "LIKE" | "DISLIKE" | null;
  created_at: string;
  updated_at: string;
};

export type CourtReviewsResponse = {
  court: {
    id: number;
    name: string;
  };
  summary: {
    average_rating: string | null;
    review_count: number;
    comment_count: number;
    distribution: Array<{ rating: number; count: number }>;
  };
  reviews: CourtReview[];
  comments: CourtReviewComment[];
  my_review: CourtReview | null;
  my_comments: CourtReviewComment[];
  eligibility: {
    can_review: boolean;
    can_comment: boolean;
    reason: string;
    booking_id: number | null;
    booking_code: string;
  };
};

export type CourtReviewComment = {
  id: number;
  court: number;
  court_name: string;
  booking: number;
  reviewer: number;
  reviewer_name: string;
  comment: string;
  is_author: boolean;
  like_count: number;
  dislike_count: number;
  my_reaction: "LIKE" | "DISLIKE" | null;
  created_at: string;
  updated_at: string;
};

export type OwnerFeedbackItem = {
  id: number;
  content_type: "review" | "comment";
  court_id: number;
  court_name: string;
  reviewer_name: string;
  rating: number | null;
  comment: string;
  like_count: number;
  dislike_count: number;
  created_at: string;
  updated_at: string;
};

export type OwnerFeedbackCourt = {
  id: number;
  name: string;
  is_active: boolean;
  average_rating: string | null;
  rating_count: number;
  comment_count: number;
};

export type OwnerReviewsResponse = {
  venue: { id: number; name: string; area: string; city: string; status: VenueStatus } | null;
  filters: {
    court_id: number | null;
    type: "all" | "reviews" | "comments";
    rating: number | null;
    period: "all" | "30" | "90" | "custom";
    start_date: string | null;
    end_date: string | null;
    sort: "newest" | "oldest" | "highest" | "lowest";
  };
  summary: {
    average_rating: string | null;
    rating_count: number;
    comment_count: number;
    total_feedback: number;
    positive_rating_count: number;
    latest_feedback_at: string | null;
  };
  distribution: Array<{ rating: number; count: number }>;
  courts: OwnerFeedbackCourt[];
  feedback: OwnerFeedbackItem[];
  pagination: { page: number; page_size: number; total: number; has_more: boolean };
};

export type PublicVenue = Venue & {
  courts: Court[];
  court_count: number;
};
export type DiscoveryFilterOption = {
  value: string;
  label: string;
  count?: number;
};

export type DiscoveryVenueTypeOption = DiscoveryFilterOption & {
  value: "INDOOR" | "OUTDOOR" | "COVERED";
};

export type VenueDiscoveryItem = PublicVenue & {
  primary_image: string;
  is_verified: boolean;
  starting_price: string | null;
  available_court_count: number;
  available_slot_count: number;
  next_available_time: string | null;
  availability_label: string;
  court_types: DiscoveryVenueTypeOption[];
  court_type_summary: string;
  important_facilities: string[];
  average_rating: string | null;
  review_count: number;
  recommendation?: VenueRecommendation;
};

export type VenueRecommendation = {
  fit_label: "Strong fit" | "Good fit" | "Worth a look";
  reasons: string[];
  distance_km: number | null;
};

export type VenueDiscoveryRecommendations = {
  available: boolean;
  profile_complete: boolean;
  missing: string[];
};

export type VenueDiscoveryFilters = {
  districts: DiscoveryFilterOption[];
  areas_by_district: Record<string, DiscoveryFilterOption[]>;
  facilities: DiscoveryFilterOption[];
  venue_types: DiscoveryVenueTypeOption[];
  time_periods: Array<{ value: string; label: string; start: string; end: string; description: string }>;
  durations: number[];
  price_min: string | null;
  price_max: string | null;
  supports_rating: boolean;
  supports_nearest: boolean;
  total_approved_venues?: number;
  total_active_courts?: number;
};

export type VenueDiscoveryResponse = {
  venues: VenueDiscoveryItem[];
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
  filters: VenueDiscoveryFilters;
  recommendations: VenueDiscoveryRecommendations;
  applied: {
    search: string;
    district: string;
    area: string;
    date: string;
    time_window: string;
    start_time: string;
    duration: number;
    min_price: string | null;
    max_price: string | null;
    venue_types: string[];
    facilities: string[];
    sort: string;
    page: number;
    page_size: number;
  };
};


export type CourtSlot = {
  id: number;
  court: number;
  court_name: string;
  venue_name: string;
  date: string;
  start_time: string;
  end_time: string;
  display_time: string;
  slot_duration_minutes: number;
  price: string;
  status: SlotStatus;
  block_type: SlotBlockType | "";
  block_type_display: string;
  block_reason: string;
  blocked_at: string | null;
  blocked_by_name: string;
  is_past: boolean;
  is_in_progress: boolean;
  active_booking: SlotBookingSummary | null;
  reserved_until: string | null;
  created_at: string;
  updated_at: string;
};

export type SlotBookingSummary = {
  id: number;
  booking_code: string;
  player_name: string;
  status: BookingStatus;
  payment_status: PaymentStatus;
};

export type Booking = {
  id: number;
  booking_code: string;
  player: number;
  player_name: string;
  venue: number;
  venue_name: string;
  venue_address: string;
  venue_area: string;
  venue_city: string;
  venue_latitude: number | string | null;
  venue_longitude: number | string | null;
  venue_map_location: string;
  court_photo: string;
  venue_primary_image: string;
  venue_cancellation_policy: string;
  court: number;
  court_name: string;
  slot: number;
  slot_date: string;
  slot_start_time: string;
  slot_end_time: string;
  slot_display_time: string;
  slots: BookingSlotSummary[];
  slot_ids: number[];
  booking_start_time: string;
  booking_end_time: string;
  booking_display_time: string;
  slots_count: number;
  total_duration_minutes: number;
  slot_start_at: string | null;
  can_cancel: boolean;
  cancellation_refund_preview: string;
  cancellation_quote: CancellationQuote;
  cancellation_policy_details: CancellationPolicyDetails;
  amount: string;
  status: BookingStatus;
  payment_status: PaymentStatus;
  payment_provider: "MOCK" | "KHALTI";
  khalti_pidx: string;
  khalti_payment_url: string;
  khalti_transaction_id: string;
  khalti_status: string;
  refund_status: RefundStatus;
  refund_reason: string;
  refund_owner_note: string;
  refund_requested_at: string | null;
  refund_reviewed_at: string | null;
  refund_reviewed_by: number | null;
  refund_reviewed_by_name: string;
  reserved_until: string;
  confirmed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: number | null;
  cancelled_by_name: string;
  cancellation_actor_role: string;
  cancellation_reason: string;
  cancellation_slot_action: string;
  cancellation_policy_snapshot: Omit<CancellationPolicyDetails, "summary">;
  matchmaking_game: number | null;
  matchmaking_game_title: string;
  cancellation_tier: CancellationTier;
  refund_percentage: number;
  refund_amount: string;
  venue_messages: BookingMessage[];
  check_in: BookingCheckIn | null;
  created_at: string;
  updated_at: string;
};

export type BookingCheckIn = {
  status: "NOT_AVAILABLE" | "NOT_YET_OPEN" | "READY" | "CHECKED_IN" | "CLOSED";
  message: string;
  window_start: string | null;
  window_end: string | null;
  checked_in_at: string | null;
  checked_in_by_name: string;
  scan_count: number;
  qr_token: string | null;
};

export type BookingMessage = {
  id: number;
  booking: number;
  sender: number;
  sender_name: string;
  message_type:
    | "ENTRY_INSTRUCTIONS"
    | "MAINTENANCE_NOTICE"
    | "ACCESS_UPDATE"
    | "VENUE_CLOSURE"
    | "GENERAL";
  message_type_display: string;
  message: string;
  created_at: string;
};

export type BookingSlotSummary = {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  display_time: string;
  slot_duration_minutes: number;
  price: string;
};
export type OwnerLifecycleState =
  | "NO_VENUE"
  | "SETUP_INCOMPLETE"
  | "PENDING_VERIFICATION"
  | "CHANGES_REQUIRED"
  | "ACTIVE"
  | "TEMPORARILY_INACTIVE"
  | "SUSPENDED";

export type OwnerOverviewSummary = {
  today_bookings: number;
  today_revenue: string;
  today_expected_revenue: string;
  today_payment_holds: number;
  courts_in_use: number;
  total_active_courts: number;
  pending_refund_requests: number;
};

export type OwnerScheduleItem = {
  id: number;
  booking_code: string;
  player_name: string;
  court_name: string;
  start_at: string | null;
  end_at: string | null;
  display_time: string;
  duration_minutes: number;
  booking_status: BookingStatus;
  payment_status: PaymentStatus;
  amount: string;
  action_url: string;
};

export type OwnerNextBooking = {
  id: number;
  booking_code: string;
  player_name: string;
  court_name: string;
  start_at: string | null;
  end_at: string | null;
  display_time: string;
  payment_status: PaymentStatus;
  amount: string;
  action_url: string;
};

export type OwnerPendingAction = {
  id: string;
  title: string;
  reason: string;
  priority: "NORMAL" | "IMPORTANT" | "URGENT";
  action_label: string;
  action_url: string;
};

export type OwnerCourtStatus = {
  court_id: number;
  court_name: string;
  status: "AVAILABLE" | "OCCUPIED" | "BLOCKED" | "UNDER_MAINTENANCE" | "INACTIVE";
  status_label: string;
  current_booking_end_at: string | null;
  next_booking_start_at: string | null;
  next_booking_label: string;
};

export type OwnerRecentActivity = {
  id: number;
  title: string;
  message: string;
  created_at: string;
  priority: "NORMAL" | "IMPORTANT" | "URGENT";
  action_url: string;
};

export type OwnerQuickAction = {
  label: string;
  href: string;
  tone: "primary" | "secondary" | "warning";
};

export type OwnerOverviewResponse = {
  server_now: string;
  local_date: string;
  venue: Venue | null;
  lifecycle_state: OwnerLifecycleState;
  summary: OwnerOverviewSummary;
  today_schedule: OwnerScheduleItem[];
  next_booking: OwnerNextBooking | null;
  pending_actions: OwnerPendingAction[];
  court_statuses: OwnerCourtStatus[];
  recent_activity: OwnerRecentActivity[];
  quick_actions: OwnerQuickAction[];
};

export type OwnerCalendarViewMode = "day" | "week";

export type OwnerCalendarStats = {
  bookings_count: number;
  confirmed_bookings: number;
  completed_bookings: number;
  reserved_holds: number;
  blocked_slots: number;
  available_slots: number;
};

export type OwnerCalendarResponse = {
  server_now: string;
  date: string;
  view: OwnerCalendarViewMode;
  week_start: string;
  week_end: string;
  venue: Venue | null;
  courts: Court[];
  slots: CourtSlot[];
  bookings: Booking[];
  opening_time: string | null;
  closing_time: string | null;
  stats: OwnerCalendarStats;
};

export type OwnerReportSummary = {
  booking_count: number;
  confirmed_booking_count: number;
  completed_booking_count: number;
  reserved_booking_count: number;
  cancelled_booking_count: number;
  expired_booking_count: number;
  paid_booking_count: number;
  paid_value: string;
  processed_refund_value: string;
  pending_refund_count: number;
  pending_refund_value: string;
  net_value: string;
  check_in_count: number;
  published_slot_count: number;
  booked_slot_count: number;
  reserved_slot_count: number;
  blocked_slot_count: number;
  utilization_percent: number;
};

export type OwnerReportCourt = {
  id: number;
  name: string;
  is_active: boolean;
  booking_count: number;
  paid_booking_count: number;
  paid_value: string;
  processed_refund_value: string;
  pending_refund_value: string;
  net_value: string;
  check_in_count: number;
  published_slot_count: number;
  booked_slot_count: number;
  reserved_slot_count: number;
  blocked_slot_count: number;
  utilization_percent: number;
};

export type OwnerReportDay = {
  date: string;
  booking_count: number;
  paid_booking_count: number;
  paid_value: string;
  processed_refund_value: string;
  pending_refund_value: string;
  net_value: string;
  booked_slot_count: number;
  published_slot_count: number;
  utilization_percent: number;
};

export type OwnerReportsResponse = {
  server_now: string;
  venue: { id: number; name: string; area: string; city: string; status: VenueStatus } | null;
  period: { days: number; start_date: string; end_date: string; mode: "preset" | "custom" };
  summary: OwnerReportSummary;
  courts: OwnerReportCourt[];
  trend: OwnerReportDay[];
};

export type OwnerCalendarBlockConflict = {
  slot_id: number;
  court_name: string;
  date: string;
  display_time: string;
  status: SlotStatus;
  booking: SlotBookingSummary | null;
};
