SPORTSPOT_DISTRICTS = ["Kathmandu", "Lalitpur", "Bhaktapur"]

SPORTSPOT_AREAS_BY_DISTRICT = {
    "Kathmandu": [
        "Baneshwor",
        "Boudha",
        "Chabahil",
        "Kageshwori",
        "Kalanki",
        "Kirtipur",
        "Koteshwor",
        "Maharajgunj",
        "Maitidevi",
        "New Road",
        "Thamel",
        "Tripureshwor",
    ],
    "Lalitpur": [
        "Gwarko",
        "Imadol",
        "Jawalakhel",
        "Lagankhel",
        "Patan",
        "Pulchowk",
        "Satdobato",
    ],
    "Bhaktapur": [
        "Bhaktapur Durbar Square",
        "Duwakot",
        "Lokanthali",
        "Madhyapur Thimi",
        "Suryabinayak",
    ],
}

SPORTSPOT_FACILITIES = [
    "Parking",
    "Changing Room",
    "Washroom",
    "Drinking Water",
    "Lighting",
    "Seating",
    "Shower",
    "Locker",
    "Cafe",
    "Equipment Rental",
]

SPORTSPOT_TIME_PERIODS = [
    {"value": "morning", "label": "Morning", "start": "00:00", "end": "12:00", "description": "Before 12:00 PM"},
    {"value": "afternoon", "label": "Afternoon", "start": "12:00", "end": "17:00", "description": "12:00 PM to 5:00 PM"},
    {"value": "evening", "label": "Evening", "start": "17:00", "end": "23:59", "description": "After 5:00 PM"},
]

SPORTSPOT_DURATIONS = [60, 120, 180]

# Planning times are preferences used before a specific venue is selected.
# Actual bookability is checked later against the selected venue's slots.
SPORTSPOT_PLANNING_START_TIMES = [
    f"{hour:02d}:{minute:02d}"
    for hour in range(6, 24)
    for minute in (0, 30)
]

# Plan-first games use explicit cutoffs. These values describe the safe
# handoff window; they do not limit the host to a fixed number of hours.
SPORTSPOT_MATCHMAKING_DEADLINE_CONFIG = {
    "minimum_booking_lead_minutes": 60,
    "minimum_recruitment_to_booking_minutes": 30,
    "minimum_plan_lead_minutes": 120,
    "recommended_recruitment_lead_minutes": 24 * 60,
    "recommended_booked_game_recruitment_lead_minutes": 2 * 60,
    "recommended_booking_lead_minutes": 12 * 60,
    # A changed schedule needs a finite response window. The deadline is also
    # capped before the game starts so an unresolved participant cannot block
    # a valid roster at the last minute.
    "minimum_reconfirmation_notice_minutes": 30,
    "maximum_reconfirmation_response_hours": 24,
}
