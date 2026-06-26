#!/usr/bin/env python3
"""
Fortellis CSV Processor for EZ-Wins Onboarding

Takes a Fortellis ez-wins CSV export, compares against a memory file of
previously-seen dealerships, and outputs a ClickUp-importable CSV containing
only the NEW entries with: Task Name, Description, Brand, Group, Region.
"""

import csv
import json
import os
import re
import sys
from pathlib import Path

# ─── Known automotive brands ───────────────────────────────────────────────
# These are matched against dealership names to identify brand(s).
# Order matters: longer/more-specific names first to avoid partial matches.
BRANDS = [
    "Mercedes-Benz", "Mercedes Benz", "Mercedez-Benz",
    "Alfa Romeo", "INEOS Grenadier",
    "Land Rover", "Rolls-Royce",
    "Chevrolet", "Chrysler", "Volkswagen", "Mitsubishi", "Maserati",
    "Cadillac", "Lincoln", "Porsche", "Genesis", "Hyundai", "Ferrari",
    "Bentley", "Infiniti", "Jaguar",
    "Toyota", "Honda", "Nissan", "Subaru", "Mazda", "Volvo", "Buick",
    "Dodge", "Lexus", "Acura", "Audi", "Ford", "Jeep", "Fiat", "Mini",
    "Ram", "BMW", "GMC", "Kia",
]

# Normalize brand name variations for output
BRAND_NORMALIZE = {
    "mercedes-benz": "Mercedes-Benz",
    "mercedes benz": "Mercedes-Benz",
    "mercedez-benz": "Mercedes-Benz",
    "ineos grenadier": "INEOS Grenadier",
    "alfa romeo": "Alfa Romeo",
    "land rover": "Land Rover",
    "rolls-royce": "Rolls-Royce",
    "vw": "Volkswagen",
}

# ─── MOC Region mapping ──────────────────────────────────────────────────
# States that map directly to a region (no ambiguity).
# CA and NV require city-level logic — handled separately in detect_region().
STATE_TO_REGION = {
    # MOC PNW
    "OR": "MOC PNW",
    "WA": "MOC PNW",
    "MT": "MOC PNW",
    "ID": "MOC PNW",
    # MOC Central
    "CO": "MOC Central",
    "TX": "MOC Central",
    "WY": "MOC Central",
    "NM": "MOC Central",
    "OK": "MOC Central",
    "LA": "MOC Central",
    "MS": "MOC Central",
    # MOC Mid-Atlantic
    "NC": "MOC Mid-Atlantic",
    "SC": "MOC Mid-Atlantic",
    "VA": "MOC Mid-Atlantic",
    "MD": "MOC Mid-Atlantic",
    "WV": "MOC Mid-Atlantic",
    # Confirmed Other Distributors (not covered by any MOC region)
    "GA": "Other Distributors",
    "IN": "Other Distributors",
    "AZ": "Other Distributors",
    "UT": "Other Distributors",
}

# Canadian province abbreviations
CANADIAN_PROVINCES = {
    "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
}

# ─── California city classification ──────────────────────────────────────
# NorCal: Bay Area, Salinas, and everything north of that.
# SoCal: LA and everything south of that.
# Cities in between (Bakersfield, Fresno, etc.) are ambiguous → "ASK".
NORCAL_CITIES = {
    # Bay Area
    "san francisco", "oakland", "san jose", "palo alto", "fremont",
    "sunnyvale", "santa clara", "mountain view", "redwood city",
    "san mateo", "berkeley", "hayward", "concord", "walnut creek",
    "richmond", "daly city", "san rafael", "novato", "marin",
    "milpitas", "cupertino", "pleasanton", "livermore", "dublin",
    "union city", "newark", "alameda", "san leandro", "san ramon",
    "danville", "lafayette", "orinda", "moraga", "piedmont",
    "half moon bay", "pacifica", "menlo park", "atherton",
    "los gatos", "campbell", "saratoga", "gilroy", "morgan hill",
    "capitola", "scotts valley", "santa cruz", "aptos", "watsonville",
    "hollister", "san benito",
    # Salinas area
    "salinas", "monterey", "seaside", "marina", "pacific grove",
    "carmel", "carmel-by-the-sea", "soledad", "king city", "gonzales",
    "greenfield",
    # North of Bay Area
    "santa rosa", "petaluma", "napa", "vallejo", "fairfield",
    "vacaville", "davis", "sacramento", "elk grove", "roseville",
    "folsom", "rancho cordova", "citrus heights", "rocklin",
    "lincoln", "auburn", "grass valley", "nevada city",
    "woodland", "west sacramento",
    "stockton", "lodi", "manteca", "tracy", "modesto", "turlock",
    "merced", "los banos", "clovis", "madera",
    "pittsburg", "antioch", "brentwood", "oakley", "discovery bay",
    "chico", "redding", "red bluff", "eureka", "arcata",
    "ukiah", "clearlake", "lakeport",
    "yuba city", "marysville",
    "san luis obispo", "paso robles", "atascadero", "arroyo grande",
    "pismo beach", "grover beach", "morro bay",
    "santa maria", "lompoc", "buellton", "solvang",
    "santa barbara", "goleta", "carpinteria",
}

SOCAL_CITIES = {
    # LA metro
    "los angeles", "la", "hollywood", "beverly hills", "santa monica",
    "west hollywood", "culver city", "inglewood", "compton",
    "huntington park", "florence", "south los angeles", "south la",
    "torrance", "long beach", "carson", "gardena", "hawthorne",
    "el segundo", "manhattan beach", "redondo beach", "hermosa beach",
    "pasadena", "glendale", "burbank", "arcadia", "monrovia",
    "azusa", "glendora", "covina", "west covina", "pomona",
    "claremont", "la verne", "diamond bar", "rowland heights",
    "whittier", "pico rivera", "montebello", "alhambra",
    "el monte", "temple city", "rosemead", "san gabriel",
    "south gate", "downey", "norwalk", "cerritos", "lakewood",
    "bellflower", "paramount", "lynwood",
    "lancaster", "palmdale",
    "northridge", "encino", "sherman oaks", "van nuys", "reseda",
    "woodland hills", "canoga park", "chatsworth", "sylmar",
    "sun valley", "north hollywood", "studio city", "tarzana",
    "calabasas", "agoura hills", "thousand oaks", "westlake village",
    "simi valley", "moorpark", "camarillo", "oxnard", "ventura",
    "santa paula", "fillmore",
    "sandy springs",
    "downtown los angeles",
    # Orange County
    "anaheim", "santa ana", "irvine", "costa mesa", "newport beach",
    "huntington beach", "fullerton", "orange", "garden grove",
    "westminster", "fountain valley", "tustin", "yorba linda",
    "brea", "placentia", "buena park", "cypress", "la habra",
    "laguna beach", "laguna niguel", "laguna hills", "aliso viejo",
    "dana point", "san clemente", "san juan capistrano",
    "mission viejo", "lake forest", "rancho santa margarita",
    # Inland Empire
    "riverside", "san bernardino", "ontario", "rancho cucamonga",
    "fontana", "rialto", "redlands", "moreno valley", "corona",
    "temecula", "murrieta", "perris", "hemet", "menifee",
    "beaumont", "banning", "palm springs", "palm desert",
    "indio", "coachella", "cathedral city", "la quinta",
    "victorville", "hesperia", "apple valley", "barstow",
    "upland", "montclair", "chino", "chino hills",
    # San Diego
    "san diego", "chula vista", "oceanside", "escondido", "carlsbad",
    "el cajon", "vista", "san marcos", "encinitas", "national city",
    "la mesa", "santee", "poway", "del mar", "solana beach",
    "imperial beach",
}

# Nevada city classification
NORCAL_NV_CITIES = {"reno", "sparks", "carson city", "incline village", "tahoe"}
SOCAL_NV_CITIES = {"las vegas", "north las vegas", "henderson", "boulder city", "mesquite", "pahrump"}


def detect_region(state: str, city: str) -> str:
    """
    Determine the MOC Region based on state and city.

    Returns one of:
        "MOC NorCal", "MOC SoCal", "MOC PNW", "MOC Central",
        "MOC Mid-Atlantic", "MOC Canada", "Other Distributors", or "ASK"

    "ASK" means the city/state combo is ambiguous (e.g. central CA) and
    the user should be asked during review.
    """
    state = state.upper().strip()
    city_lower = city.lower().strip()

    # Canadian provinces
    if state in CANADIAN_PROVINCES:
        return "MOC Canada"

    # Direct state mapping (non-CA, non-NV)
    if state in STATE_TO_REGION:
        return STATE_TO_REGION[state]

    # California — needs city-level logic
    if state == "CA":
        if city_lower in NORCAL_CITIES:
            return "MOC NorCal"
        if city_lower in SOCAL_CITIES:
            return "MOC SoCal"
        # Ambiguous — Bakersfield, Fresno, Visalia, etc.
        return "ASK"

    # Nevada — split by city
    if state == "NV":
        if city_lower in NORCAL_NV_CITIES:
            return "MOC NorCal"
        if city_lower in SOCAL_NV_CITIES:
            return "MOC SoCal"
        return "ASK"

    # Unknown state — ask the user during review rather than guessing
    return "ASK"


def extract_brands(name: str) -> str:
    """
    Extract car brand(s) from a dealership name.

    Returns a comma-separated string of brands, or "False" if no
    recognizable brand is found.

    Examples:
        "DEMONTROND FORD" -> "Ford"
        "DeMontrond Buick GMC" -> "Buick, GMC"
        "Tonkin Italian Cars, LLC" -> "False"
        "CDJR CHESAPEAKE" -> "Chrysler, Dodge, Jeep, Ram"
    """
    name_upper = name.upper()
    found = []

    # Special abbreviation handling
    if "CDJR" in name_upper:
        found.extend(["Chrysler", "Dodge", "Jeep", "Ram"])

    # VW = Volkswagen
    if re.search(r'(?<![A-Za-z])VW(?![A-Za-z])', name_upper):
        found.append("Volkswagen")

    for brand in BRANDS:
        # Use word-boundary-aware matching
        pattern = r'(?<![A-Za-z])' + re.escape(brand) + r'(?![A-Za-z])'
        if re.search(pattern, name, re.IGNORECASE):
            # Normalize the brand name
            normalized = BRAND_NORMALIZE.get(brand.lower(), brand)
            if normalized not in found:
                found.append(normalized)

    return ", ".join(found) if found else "False"


def detect_group(name: str, all_names: list[str]) -> str:
    """
    Detect if a dealership belongs to a group based on shared name prefixes
    with other dealerships.

    A group is identified when 2+ dealerships share a common prefix that
    looks like a group name (not a city or generic word).

    Returns the group name or empty string.
    """
    # Known group prefixes mapped to their actual group name.
    # Prefix -> Group Name. Longer prefixes come first to match before shorter ones.
    # When a dealership name starts with the prefix, return the group name.
    KNOWN_GROUPS = {
        "Capitol": "DGDG Group",
        "Team": "DGDG Group",
        "George Gee": "Gee Automotive Companies",
        "Jim Ellis": "Jim Ellis",
        "DeMontrond": "DeMontrond",
        "Demontrond": "DeMontrond",
        "Ron Tonkin": "Ron Tonkin",
        "Tonkin": "Ron Tonkin",
        "Hansel": "Hansel",
        "Hanlees": "Hanlees",
        "Car Pros": "Car Pros",
        "Doggett": "Doggett",
        "Don Ayres": "Don Ayres",
        "Southern": "Southern",
        "United": "United",
        "Manly": "Manly",
        "Lyle Pearson": "Lyle Pearson",
        "Winter": "Winter",
        "Weatherford": "Weatherford",
        "Midlands": "Midlands",
    }
    # NOTE: "Stevens Creek" is a location, not a group
    # NOTE: "BMW of Downtown" is a single store, not a group

    name_lower = name.lower().strip()
    for prefix, group_name in KNOWN_GROUPS.items():
        if name_lower.startswith(prefix.lower()):
            return group_name

    # Dynamic detection: look for 2+ orgs sharing first word(s)
    # Skip single common words and city names
    SKIP_PREFIXES = {
        "the", "of", "auto", "east", "west", "north", "south",
        "new", "san", "los", "el", "la", "st", "ft",
        "seattle", "tucson", "roseville", "fremont", "concord",
        "anaheim", "huntington", "garden", "sacramento",
    }

    words = name.split()
    if len(words) >= 2:
        candidate = words[0]
        if candidate.lower() not in SKIP_PREFIXES:
            matches = sum(
                1 for n in all_names
                if n.upper().startswith(candidate.upper())
                and n.upper() != name.upper()
            )
            if matches >= 1:
                return candidate

    return ""


# US state name to abbreviation mapping
STATE_ABBREV = {
    "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR",
    "CALIFORNIA": "CA", "COLORADO": "CO", "CONNECTICUT": "CT", "DELAWARE": "DE",
    "FLORIDA": "FL", "GEORGIA": "GA", "HAWAII": "HI", "IDAHO": "ID",
    "ILLINOIS": "IL", "INDIANA": "IN", "IOWA": "IA", "KANSAS": "KS",
    "KENTUCKY": "KY", "LOUISIANA": "LA", "MAINE": "ME", "MARYLAND": "MD",
    "MASSACHUSETTS": "MA", "MICHIGAN": "MI", "MINNESOTA": "MN",
    "MISSISSIPPI": "MS", "MISSOURI": "MO", "MONTANA": "MT", "NEBRASKA": "NE",
    "NEVADA": "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ",
    "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC",
    "NORTH DAKOTA": "ND", "OHIO": "OH", "OKLAHOMA": "OK", "OREGON": "OR",
    "PENNSYLVANIA": "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC",
    "SOUTH DAKOTA": "SD", "TENNESSEE": "TN", "TEXAS": "TX", "UTAH": "UT",
    "VERMONT": "VT", "VIRGINIA": "VA", "WASHINGTON": "WA",
    "WEST VIRGINIA": "WV", "WISCONSIN": "WI", "WYOMING": "WY",
    "DISTRICT OF COLUMBIA": "DC",
}


def parse_address(address_str: str) -> dict:
    """
    Parse a Fortellis multi-line address into components.

    Address format (from CSV):
        "3944 US HWY 59 S
        CLEVELAND TEXAS 77328-1234
        US"
    """
    lines = [l.strip() for l in address_str.strip().split('\n') if l.strip()]
    result = {"street": "", "city": "", "state": "", "zip": ""}

    if len(lines) >= 1:
        result["street"] = lines[0]

    if len(lines) >= 2:
        # Second line: CITY STATE ZIP (e.g., "CLEVELAND TEXAS 77328-1234")
        # Data can be messy: missing state, extra spaces, etc.
        parts = re.sub(r'\s+', ' ', lines[1].strip())  # normalize whitespace

        # Try matching: CITY STATE ZIP (2-letter abbreviation)
        match = re.match(
            r'^(.+?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$',
            parts, re.IGNORECASE
        )
        if match:
            result["city"] = match.group(1).strip().title()
            result["state"] = match.group(2).upper()
            result["zip"] = match.group(3)
        else:
            # Try: CITY FULLSTATENAME ZIP
            tokens = parts.split()
            zip_match = re.search(r'(\d{5}(?:-\d{4})?)$', parts)

            if zip_match:
                result["zip"] = zip_match.group(1)
                before_zip = parts[:zip_match.start()].strip()
                tokens_before = before_zip.split()

                # Try 2-word state names first, then 1-word
                found_state = False
                for num_words in [2, 1]:
                    if len(tokens_before) >= num_words + 1:
                        candidate = " ".join(tokens_before[-num_words:]).upper()
                        if candidate in STATE_ABBREV:
                            result["state"] = STATE_ABBREV[candidate]
                            result["city"] = " ".join(tokens_before[:-num_words]).title()
                            found_state = True
                            break

                if not found_state:
                    # No state found — just city + zip (state missing in data)
                    result["city"] = before_zip.title()
                    result["state"] = ""
            else:
                result["city"] = parts.title()

    return result


def extract_department_id(dms_attrs: str) -> str:
    """
    Extract the first department ID from the DMS Attributes JSON string.

    The DMS Attributes field contains a JSON array with department info.
    We want the first department ID we find.
    """
    try:
        data = json.loads(dms_attrs)
        if isinstance(data, list):
            for item in data:
                depts = item.get("departments", [])
                for dept in depts:
                    dept_id = dept.get("id", "")
                    if dept_id:
                        return dept_id
    except (json.JSONDecodeError, TypeError):
        pass
    return ""



def title_case_name(name: str) -> str:
    """Convert ALL CAPS dealership names to proper title case.
    Leave mixed-case names unchanged."""
    if name == name.upper() and len(name) > 1:
        preserve_upper = {"BMW", "GMC", "CDJR", "VW", "KIA", "MINI", "LLC", "INC", "CDK"}
        lowercase_words = {"of", "the", "and", "at", "in", "on", "for", "by", "to"}
        words = name.title().split()
        result = []
        for i, w in enumerate(words):
            if w.upper() in preserve_upper:
                result.append(w.upper())
            elif i > 0 and w.lower() in lowercase_words:
                result.append(w.lower())
            else:
                result.append(w)
        return " ".join(result)
    return name


def build_description(org_name: str, brand_str: str, address: dict,
                      subscription_id: str, department_id: str, group: str = '') -> str:
    """
    Build the ClickUp task description in the standard onboarding format.
    """
    lines = [
        f"Dealership Name: {org_name}",
        f"Brand: {brand_str if brand_str != 'False' else ''}",
        f"Owner: {group if group else org_name}",
        f"Dealership Address: {address['street']}",
        f"City: {address['city']}",
        f"State: {address['state']}",
        f"Zip Code: {address['zip']}",
        "",
        "API Platform: Fortellis",
        "Door Rate: $225",
        "DMS: CDK",
        "",
        f"Fortellis Subscription ID: {subscription_id}",
        f"Fortellis Department ID: {department_id}",
        "",
        "Fluids Provider: MOC Products",
    ]
    return "\n".join(lines)


def load_memory(memory_path: str) -> tuple[set, list, dict]:
    """Load the full memory file: seen_orgs, seen_groups, and the raw dict.

    Returns (seen_orgs_set, seen_groups_list, full_data_dict).
    The raw dict is preserved so save_memory can round-trip every key.
    """
    if os.path.exists(memory_path):
        with open(memory_path, 'r') as f:
            data = json.load(f)
            seen_orgs = set(data.get("seen_orgs", []))
            seen_groups = data.get("seen_groups", [])
            return seen_orgs, seen_groups, data
    return set(), [], {}


def save_memory(memory_path: str, seen_orgs: set, seen_groups: list):
    """Save the updated memory, preserving both seen_orgs and seen_groups."""
    with open(memory_path, 'w') as f:
        json.dump({
            "seen_orgs": sorted(seen_orgs),
            "seen_groups": sorted(set(seen_groups))
        }, f, indent=2)


def process_fortellis_csv(input_path: str, output_path: str,
                          memory_path: str) -> dict:
    """
    Main processing function.

    Reads a Fortellis CSV, identifies new entries, extracts brand/group/region,
    and writes a ClickUp-importable CSV.

    Returns a summary dict with counts.
    """
    # Load memory (preserves seen_groups across runs)
    seen_orgs, seen_groups, _raw = load_memory(memory_path)
    initial_count = len(seen_orgs)

    # Read all org names from CSV first (for group detection)
    all_org_names = []
    rows = []
    with open(input_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            org_name = row.get("Organization Name", "").strip()
            if org_name:
                all_org_names.append(org_name)
                rows.append(row)

    # Combine with memory for better group detection
    all_names_for_groups = list(seen_orgs) + all_org_names

    # Find new entries
    new_entries = []
    for row in rows:
        org_name = row.get("Organization Name", "").strip()
        if not org_name:
            continue

        # Normalize for comparison (case-insensitive)
        if org_name.upper() in {s.upper() for s in seen_orgs}:
            continue

        # Skip non-production or deactivated
        status = row.get("Status", "").strip().lower()
        if status != "active":
            continue

        # Extract fields
        address = parse_address(row.get("Organization Address", ""))
        subscription_id = row.get("Subscription ID", "").strip()
        dms_attrs = row.get("DMS Attributes", "")
        department_id = extract_department_id(dms_attrs)

        brand_str = extract_brands(org_name)
        group = detect_group(org_name, all_names_for_groups)
        region = detect_region(address["state"], address["city"])

        # Apply title casing if name is ALL CAPS
        display_name = title_case_name(org_name)

        description = build_description(
            display_name, brand_str, address, subscription_id, department_id, group
        )

        new_entries.append({
            "Task Name": display_name,
            "Description": description,
            "Brand": brand_str,
            "Group": group,
            "Region": region,
            "State": address["state"],
            "City": address["city"],
        })

        # Add to seen
        seen_orgs.add(org_name)

    # Write output as JSON (for ClickUp task creation)
    if new_entries:
        json_output_path = output_path.rsplit('.', 1)[0] + '.json'
        with open(json_output_path, 'w', encoding='utf-8') as f:
            json.dump(new_entries, f, indent=2)

        # Also write CSV as backup
        with open(output_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(
                f, fieldnames=["Task Name", "Description", "Brand", "Group",
                               "Region", "State", "City"]
            )
            writer.writeheader()
            writer.writerows(new_entries)

    # Save updated memory (preserves seen_groups)
    save_memory(memory_path, seen_orgs, seen_groups)

    return {
        "previously_seen": initial_count,
        "total_in_file": len(rows),
        "new_entries": len(new_entries),
        "new_entries_data": new_entries,
        "output_path": output_path,
        "memory_path": memory_path,
    }


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python process_fortellis.py <input_csv> <output_csv> <memory_json>")
        sys.exit(1)

    input_csv = sys.argv[1]
    output_csv = sys.argv[2]
    memory_json = sys.argv[3]

    result = process_fortellis_csv(input_csv, output_csv, memory_json)

    print(f"\n--- Fortellis Onboarding Summary ---")
    print(f"Previously onboarded: {result['previously_seen']}")
    print(f"Entries in uploaded file: {result['total_in_file']}")
    print(f"NEW entries found: {result['new_entries']}")
    if result['new_entries'] > 0:
        print(f"Output saved to: {result['output_path']}")
        for entry in result['new_entries_data']:
            region_note = " ⚠️ NEEDS REGION" if entry['Region'] == 'ASK' else ""
            print(f"  - {entry['Task Name']} ({entry['City']}, {entry['State']}) → {entry['Region']}{region_note}")
    else:
        print("No new entries to process.")
    print(f"Memory updated: {result['memory_path']}")
