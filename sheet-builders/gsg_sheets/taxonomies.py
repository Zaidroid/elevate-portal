"""Canonical taxonomies for Elevate Cohort 3.

Single source of truth consumed by every builder so dropdowns, statuses,
and fund codes stay aligned across workbooks.
"""

COHORT = "E3"

FUND_CODES = ["97060", "91763"]  # Dutch, SIDA/TechRise
FUND_LABELS = {"97060": "Dutch (97060)", "91763": "SIDA/TechRise (91763)"}

INTERVENTION_TYPES = [
    "TTH",
    "Upskilling",
    "MKG",
    "MA",
    "MA-ElevateBridge",
    "MA-Market Registration",
    "MA-MKG Agency",
    "MA-Resource Placement",
    "MA-Legal",
    "C-Suite",
    "Conferences",
]

COMPANY_STATUS = [
    "Applicant",
    "Shortlisted",
    "Interviewed",
    "Reviewing",
    "Recommended",
    "Selected",
    "Onboarded",
    "Active",
    "Graduated",
    "Withdrawn",
]

# Granular funnel stage for Cohort 3 (used alongside status for finer tracking).
# Maps to the Selection Data pipeline: Source Data -> 1st Filtration -> Doc Reviews
# -> Company Needs -> Scoring -> Interviews -> final Filtration/Assessment/Selection
# -> Onboarding -> Active execution -> Graduation.
COMPANY_STAGE = [
    "Applied",
    "1st Filtration",
    "Doc Review",
    "Needs Assessed",
    "Scored",
    "Interviewed",
    "Final Assessment",
    "Selected",
    "Onboarded",
    "Active",
    "Graduated",
    "Rejected",
    "Withdrew",
]

ASSIGNMENT_STATUS = ["Planned", "In Progress", "Completed", "Cancelled"]

PROCUREMENT_STATUS = [
    "Draft",
    "Submitted",
    "Under Review",
    "Awarded",
    "Delivered",
    "Cancelled",
]

PAYMENT_STATUS = [
    "Pending Approval",
    "Approved",
    "Sent to Finance",
    "Paid",
    "Rejected",
]

PAYEE_TYPE = ["Vendor", "Advisor", "Participant", "Conference"]

AGREEMENT_TYPE = ["MJPSA", "Addendum", "NDA", "Commitment Letter"]

AGREEMENT_STATUS = ["Drafted", "Sent", "Signed", "Countersigned", "Executed"]

CONFERENCE_TIER = ["T1", "T2", "T3"]

CONFERENCE_DECISION = ["Nominated", "Committed", "Withdrawn", "Attended"]

FREELANCER_TRACK = ["Upwork", "Social Media", "Other"]

FREELANCER_ROLE = ["Individual", "Job Hunter", "Agency"]

# ElevateBridge is a matching engine, not an intake funnel. The 203 freelancers
# already in the pool have been pre-vetted; the team's job is to pair them
# with Cohort 3 companies so they can act as a sales funnel (write Upwork
# proposals, run social campaigns, sell company services on platforms). The
# pipeline reflects that workflow.
FREELANCER_STATUS = [
    "Available",          # in pool, ready to be matched with a company
    "Matched",            # assigned to a company, onboarding to its services
    "Active",             # executing — writing proposals, running outreach
    "Producing",          # closing deals / generating qualified leads
    "On Hold",            # temporarily paused (freelancer or company side)
    "Released",           # engagement ended; back into the Available cycle
    "Dropped",            # permanently out of the program
    "Archived",           # historical; not part of any active triage
]

# Days the team expects each pipeline status to last before the UI flags
# the freelancer as stuck.
FREELANCER_SLA_DAYS = {
    "Available": 30,    # if unmatched > 30d, time to re-engage or rematch
    "Matched": 14,      # onboarding window
    "Active": 90,       # long engagement; nudge if no production after 90d
    "Producing": 365,   # success state; revisit annually
    "On Hold": 14,
    "Released": 30,     # if released > 30d, time to re-match or move to On File
    "Dropped": 9999,
    "Archived": 9999,
}

GOVERNORATES = [
    "Gaza",
    "Khan Younis",
    "Rafah",
    "Deir al Balah",
    "North Gaza",
    "Ramallah",
    "Nablus",
    "Hebron",
    "Bethlehem",
    "Jenin",
    "Tulkarm",
    "Qalqilya",
    "Jericho",
    "Tubas",
    "Salfit",
    "East Jerusalem",
]

SECTORS = [
    "SaaS",
    "FinTech",
    "HealthTech",
    "EdTech",
    "E-commerce",
    "AI/ML",
    "Cybersecurity",
    "DevTools",
    "Marketing/AdTech",
    "GovTech",
    "AgriTech",
    "CleanTech",
    "Gaming",
    "Media",
    "Outsourcing Services",
    "Other",
]

# Procurement thresholds (USD) and SLA working days per Mercy Corps rules.
PROCUREMENT_THRESHOLDS = [
    {"class": "Micro", "max_usd": 5_000, "sla_days": 5},
    {"class": "Small", "max_usd": 25_000, "sla_days": 10},
    {"class": "Standard", "max_usd": 150_000, "sla_days": 25},
    {"class": "High Value", "max_usd": None, "sla_days": 35},
]
