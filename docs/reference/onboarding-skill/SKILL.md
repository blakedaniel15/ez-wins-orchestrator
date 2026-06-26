---
name: fortellis-onboarding
description: "Processes EZ-Wins onboarding from multiple sources — Fortellis CSV exports, Reynolds RCI-1 PDFs, DealerVault text pastes, Tekion text pastes, and Tekion browser scraping — creating fully structured onboarding tasks in ClickUp. Use this skill whenever the user uploads a Fortellis CSV, a Reynolds onboarding PDF (RCI-1 / REYSIGN), pastes DealerVault entries (tab-separated lines with DVD IDs), pastes Tekion entries (multi-line blocks with dealer IDs like 'youngautomotivegrouput_6837_0'), mentions 'fortellis', 'reynolds', 'dealervault', 'tekion', 'DVD', 'onboarding', 'new entries', 'ez-wins CSV', 'RCI', 'REYSIGN', or wants to find new dealerships to add to ClickUp. Also trigger when the user asks about which dealerships have been onboarded or need onboarding, or wants to pull new Tekion dealers directly from the Tekion APC dashboard, or says things like 'check Tekion for new dealers', 'pull from Tekion', 'scrape Tekion'."
---

# EZ-Wins Onboarding Processor

This skill automates the EZ-Wins onboarding workflow end-to-end — whether the source is a **Fortellis CSV export**, a **Reynolds RCI-1 PDF**, a **DealerVault text paste**, a **Tekion text paste**, or a **live Tekion browser scrape** — and creates fully structured onboarding tasks with subtasks directly in ClickUp.

## Detect Input Type

Before anything else, identify which onboarding path to follow based on the input:

- **Fortellis CSV** (`.csv` file, typically named `ez-wins*.csv`) → Follow **Path A: Fortellis Flow**
- **Reynolds PDF** (`.pdf` file, typically an RCI-1 form with "REYNOLDS CERTIFIED INTERFACE ORDER FORM" or "REYSIGN" in the filename) → Follow **Path B: Reynolds Flow**
- **DealerVault text paste** (tab-separated lines containing `DVD` IDs and DMS names like DealerTrack, PBS, Dealerbuilt) → Follow **Path C: DealerVault Flow**
- **Tekion text paste** (multi-line blocks where each dealer has a name, a Tekion dealer ID like `companyname_1234_0`, "EZ Wins", dates, version, and status) → Follow **Path D: Tekion Flow**
- **Tekion browser scrape** (user asks to "pull from Tekion", "check Tekion", "scrape Tekion", or wants to pull new dealers directly from the Tekion APC dashboard) → Follow **Path E: Tekion Browser Scrape**

---

# Path A: Fortellis Flow

## Step 1: Identify New Entries

Run the processing script to find new dealerships:

```bash
# The canonical memory location is the user's MOC Templates & Resources folder.
# The bash sandbox can't write directly to that mounted folder, so we:
#   1. Copy the persistent memory into /tmp (writable)
#   2. Run the script against /tmp
#   3. After processing, save the updated memory back via the Write file tool
MEMORY_PATH="/tmp/fortellis_memory.json"
MOC_MEMORY="<session-mnt>/MOC Templates & Resources/Claude/fortellis_memory.json"
if [ -f "$MOC_MEMORY" ]; then
  cat "$MOC_MEMORY" > "$MEMORY_PATH"
else
  cat SKILL_DIR/data/memory.json > "$MEMORY_PATH"
fi

python3 SKILL_DIR/scripts/process_fortellis.py \
  "<path-to-uploaded-csv>" \
  "<output-path>/new_fortellis_entries.csv" \
  "$MEMORY_PATH"
```

Replace `SKILL_DIR` with the actual path to this skill's directory, and `<session-mnt>` with the session's mount path (e.g. `/sessions/<session-name>/mnt/`).

**IMPORTANT — Saving memory after the script runs:** The bash sandbox cannot write back to the MOC folder. After running the script, use the **Write file tool** (host file tools) to save `/tmp/fortellis_memory.json` back to `/Users/blakedaniel/Documents/MOC Templates & Resources/Claude/fortellis_memory.json`. This is the only way to persist updates across sessions. Do this at the end of every onboarding run, after all tasks are created and groups are updated.

The script prints a summary and outputs a JSON file with the new entries. It now also detects the **MOC Region** for each entry.

## Step 2: Human Review (REQUIRED before ClickUp)

Before creating anything in ClickUp, present every new entry to the user for review. Show a clear summary table like:

```
| # | Dealership Name              | Brand        | Group       | Region          |
|---|------------------------------|--------------|-------------|-----------------|
| 1 | ACME Toyota of Springfield   | Toyota       |             | MOC NorCal      |
| 2 | Sunrise Auto Group           | False        |             | ASK             |
```

Call out:
- Any entries where **Brand = "False"** — ask the user what the brand should be
- Any entries where **Group** was detected — ask the user to confirm
- Any entries where **Group is blank** — ask if they belong to a group
- Any entries where **Region = "ASK"** — the city is in an ambiguous zone (e.g. central CA between NorCal and SoCal). Ask the user which region it belongs to.

Only proceed to Step 3 after the user confirms or corrects the entries.

## Step 3: Create ClickUp Tasks

Use the Fortellis Description Format (see below) and then follow the shared steps in **Creating the ClickUp Task Tree** and **Adding MOC Users Comment**.

### Fortellis Description Format

The dev team's AI parses these descriptions, so the format must be exactly consistent every time. Do not add extra fields — keep it to exactly these fields in this order:

```
Dealership Name: <Organization Name>
Brand: <extracted brand(s), blank if False>
Owner: <dealer group name if applicable, otherwise dealership name>
Dealership Address: <street address>
City: <city>
State: <state>
Zip Code: <zip>
 
API Platform: Fortellis
Door Rate: $225
DMS: CDK
 
Fortellis Subscription ID: <subscription_id>
Fortellis Department ID: <department_id>
 
Fluids Provider: MOC Products
```

The **Owner** field is where the dealer group goes. If the user confirmed a group during review, put it here. If the store is independent / not owned by a group, set Owner to the dealership name (properly cased).

---

# Path B: Reynolds Flow

## Step 1: Extract Data from the RCI-1 PDF

Read the uploaded PDF. Reynolds onboarding PDFs are RCI-1 forms ("Reynolds Certified Interface Order Form"). Extract the following fields from the form:

- **Customer DBA Name** → This is the dealership name (use from "SOLD TO" section, or "INSTALL SITE" if the user specifies)
- **Address, City, State, Zip** → From the same section as the dealership name
- **PPSYSID** → From the "SET UP INFORMATION" section
- **Store #** and **Branch #** → From the "SET UP INFORMATION" section — combine these into a single **Reynolds Store Code** (e.g. Store # `17` + Branch # `01` = `1701`)

## Step 2: Human Review (REQUIRED before ClickUp)

Present the extracted data to the user for review. The RCI-1 form often has two sections — a "SOLD TO" dealership and an "INSTALL SITE/SHIP TO" dealership. Ask the user:

- Which store(s) need onboarding tasks (could be one or both)
- The **brand** (detect from name using brand detection rules, confirm with user)
- Whether the store belongs to a **dealer group** (this goes in the Owner field of the description)
- The **MOC Region** (detect from state/city using region detection rules, confirm with user)
- The **Historical File Delivered** date (the user will provide this, or leave blank as a placeholder)

## Step 3: Create ClickUp Tasks

Use the Reynolds Description Format (see below) and then follow the shared steps in **Creating the ClickUp Task Tree** and **Adding MOC Users Comment**.

### Reynolds Description Format

The dev team's AI parses these descriptions, so the format must be exactly consistent every time. Do not add extra fields — keep it to exactly these fields in this order:

```
Dealership Name: <Customer DBA Name>
Brand: <detected brand>
Owner: <dealer group name if applicable, otherwise dealership name>
Dealership Address: <street address>
City: <city>
State: <state>
Zip Code: <zip>
 
API Platform: Reynolds
Door Rate: $225
DMS: Reynolds
 
Reynolds PPSYSID: <PPSYSID from SET UP INFORMATION>
Reynolds Store Code: <Store # + Branch # combined, e.g. 1701>
Historical File Delivered: <date provided by user, or blank>
 
Fluids Provider: MOC Products
```

**Key differences from Fortellis format:**
- API Platform and DMS are both "Reynolds" (not "Fortellis" / "CDK")
- Door Rate defaults to $225 (same as Fortellis — user may update later once actual rate is known)
- Uses `Reynolds PPSYSID` and `Reynolds Store Code` instead of Fortellis Subscription/Department IDs
- Includes `Historical File Delivered` field — the user provides this date. Always include the field even if blank.

---

# Path C: DealerVault Flow

DealerVault is a data broker that sits in front of multiple DMS systems (DealerTrack, PBS, Dealerbuilt, etc.). The user pastes tab-separated lines directly into the chat — there is no file upload.

## Step 1: Parse the Pasted Text

The user will paste one or more tab-separated lines. Each line contains these fields in order:

```
<Dealer Name>\t<DealerVault ID>\t<DMS>\t<Type>\t<Status>\t<Date>\t<Date>\t<Count>\t<Date>\t<DVV ID>
```

**Example:**
```
Citrus Motors Ford KIA	DVD39749	DealerTrack	Service	Active	05/13/2026 2:09 AM	05/13/2026 01:03 PM	218	05/12/2026	DVV02003
Elk Grove Buick GMC	DVD50616	PBS	Service	Active	05/13/2026 3:30 AM	05/13/2026 02:00 PM	121	05/12/2026	DVV01461
```

Extract from each line:
- **Dealer Name** — first field (e.g. "Citrus Motors Ford KIA")
- **DealerVault ID** — second field, starts with `DVD` (e.g. "DVD39749")
- **DMS** — third field, the underlying DMS system (e.g. "DealerTrack", "PBS", "Dealerbuilt")

The remaining fields (Type, Status, dates, counts, DVV ID) are informational and not used in the ClickUp task.

## Step 2: Look Up Addresses

DealerVault pastes do not include dealer addresses, but the ClickUp task description requires them. For each dealer, use **web search** to find the dealership's physical address:

- Search for the dealer name (e.g. "Citrus Motors Ford KIA address")
- Extract: street address, city, state, zip code
- If a dealer has multiple locations, pick the **service department** address since these are service integrations
- If the address can't be found, leave the address fields blank and flag it during human review so the user can provide it

## Step 3: Detect Brand, Group, and Region

Apply the same detection logic as other paths:
- **Brand** — extract from the dealer name using brand detection rules (see Reference section)
- **Group** — check against known group prefixes (see Reference section)
- **Region** — determine from the looked-up address's state/city using region detection rules (see Reference section). If no address was found, set region to "ASK"

## Step 4: Check Memory for Duplicates

Load the memory file and check each dealer name against `seen_orgs`. Skip any that have already been onboarded. Also query ClickUp list `901105435045` to sync memory (same as other paths).

## Step 5: Human Review (REQUIRED before ClickUp)

Present all entries for review. The table should include the looked-up address since the user needs to verify it:

```
| # | Dealership Name        | DealerVault ID | DMS          | Brand      | Group | Address                        | Region     |
|---|------------------------|----------------|--------------|------------|-------|--------------------------------|------------|
| 1 | Citrus Motors Ford KIA | DVD39749       | DealerTrack  | Ford, Kia  |       | 1234 Auto Mall Dr, Covina, CA  | MOC SoCal  |
| 2 | Elk Grove Buick GMC    | DVD50616       | PBS          | Buick, GMC |       | 8776 Laguna Grove Dr, Elk Grove, CA | MOC NorCal |
```

Call out:
- Any entries where **Brand = "False"** — ask the user what the brand should be
- Any entries where the **address couldn't be found** or looks wrong — ask the user to provide/correct it
- Any entries where **Group** was detected — confirm; where blank — ask
- Any entries where **Region = "ASK"** — ask the user which region

Only proceed after the user confirms or corrects.

## Step 6: Create ClickUp Tasks

Use the DealerVault Description Format (see below) and then follow the shared steps in **Creating the ClickUp Task Tree** and **Adding MOC Users Comment**.

### DealerVault Description Format

The dev team's AI parses these descriptions, so the format must be exactly consistent every time. Do not add extra fields — keep it to exactly these fields in this order:

```
Dealership Name: <Dealer Name>
Brand: <detected brand(s), blank if False>
Owner: <dealer group name if applicable, otherwise dealership name>
Dealership Address: <street address>
City: <city>
State: <state>
Zip Code: <zip>
 
API Platform: DealerVault
Door Rate: $225
DMS: <DMS from paste — e.g. DealerTrack, PBS, Dealerbuilt>
 
DealerVault ID: <DealerVault ID from paste, e.g. DVD39749>
 
Fluids Provider: MOC Products
```

**Key differences from other formats:**
- API Platform is "DealerVault"
- DMS varies per dealer — use the value from the pasted data (DealerTrack, PBS, Dealerbuilt, etc.), not a fixed value
- Uses `DealerVault ID` (the DVD-prefixed ID) as the platform identifier
- Door Rate defaults to $225

---

# Path D: Tekion Flow

Tekion is a cloud-native DMS. The user pastes multi-line blocks directly into the chat — there is no file upload.

## Step 1: Parse the Pasted Text

The user will paste blocks of text where each dealer occupies **8 consecutive lines** in this order:

```
<Dealer Name>
<Tekion Dealer ID>
<App Name (always "EZ Wins")>
<Subscription Date>
<Version>
<Status>
<Created Date>
<Updated Date>
```

**Example (two dealers):**
```
Young Honda
youngautomotivegrouput_6837_0
EZ Wins
May 13 2026, 3:55 pm
1.0.0
Pending Onboarding
May 13 2026, 3:55 pm
May 13 2026, 3:55 pm
C Speck Motors
speckdealerships_986_0
EZ Wins
May 13 2026, 1:51 pm
1.0.0
Pending Onboarding
May 13 2026, 1:51 pm
May 13 2026, 1:51 pm
```

Extract from each 8-line block:
- **Dealer Name** — line 1 (e.g. "Young Honda")
- **Tekion Dealer ID** — line 2 (e.g. "youngautomotivegrouput_6837_0")

The remaining lines (app name, dates, version, status) are informational and not used in the ClickUp task.

**Parsing tip:** Split the pasted text by lines, strip blanks, then group every 8 lines into one dealer record. The Tekion Dealer ID is identifiable by its format: lowercase with underscores and a trailing `_0` (e.g. `speckdealerships_989_0`).

## Step 2: Look Up Addresses

Tekion pastes do not include dealer addresses, but the ClickUp task description requires them. For each dealer, use **web search** to find the dealership's physical address:

- Search for the dealer name (e.g. "Young Honda address" or "C Speck Motors address")
- Extract: street address, city, state, zip code
- If a dealer has multiple locations, pick the **service department** address
- If the address can't be found, leave the address fields blank and flag it during human review

## Step 3: Detect Brand, Group, and Region

Apply the same detection logic as other paths:
- **Brand** — extract from the dealer name using brand detection rules
- **Group** — check against known group prefixes. For Tekion, the dealer ID often hints at the group (e.g. `speckdealerships_986_0` suggests a "Speck" group — check if multiple Speck dealers exist)
- **Region** — determine from the looked-up address's state/city using region detection rules. If no address was found, set region to "ASK"

## Step 4: Check Memory for Duplicates

Load the memory file and check each dealer name against `seen_orgs`. Skip any that have already been onboarded. Also query ClickUp list `901105435045` to sync memory (same as other paths).

## Step 5: Human Review (REQUIRED before ClickUp)

Present all entries for review with looked-up addresses:

```
| # | Dealership Name              | Tekion Dealer ID            | Brand  | Group | Address                              | Region          |
|---|------------------------------|-----------------------------|--------|-------|--------------------------------------|-----------------|
| 1 | Young Honda                  | youngautomotivegrouput_6837_0 | Honda  |       | 1234 S State St, Lindon, UT          | Other Distributors |
| 2 | C Speck Motors               | speckdealerships_986_0      | False  | Speck?| 456 Wine Country Rd, Prosser, WA     | MOC PNW         |
```

Call out:
- Any entries where **Brand = "False"** — ask the user what the brand should be
- Any entries where the **address couldn't be found** or looks wrong — ask the user to provide/correct it
- Any entries where **Group** was detected — confirm; where blank — ask
- Any entries where **Region = "ASK"** — ask the user which region

Only proceed after the user confirms or corrects.

## Step 6: Create ClickUp Tasks

Use the Tekion Description Format (see below) and then follow the shared steps in **Creating the ClickUp Task Tree** and **Adding MOC Users Comment**.

### Tekion Description Format

The dev team's AI parses these descriptions, so the format must be exactly consistent every time. Do not add extra fields — keep it to exactly these fields in this order:

```
Dealership Name: <Dealer Name>
Brand: <detected brand(s), blank if False>
Owner: <dealer group name if applicable, otherwise dealership name>
Dealership Address: <street address>
City: <city>
State: <state>
Zip Code: <zip>
 
API Platform: Tekion
Door Rate: $225
DMS: Tekion
 
Tekion Dealer ID: <Tekion Dealer ID from paste, e.g. youngautomotivegrouput_6837_0>
 
Fluids Provider: MOC Products
```

**Key differences from other formats:**
- API Platform and DMS are both "Tekion"
- Uses `Tekion Dealer ID` as the platform identifier
- Door Rate defaults to $225

---

# Path E: Tekion Browser Scrape

Instead of pasting text, this path pulls new Tekion dealers directly from the Tekion APC Dealer Dashboard using browser automation. The user must already be logged into Tekion in their Chrome browser.

**Prerequisites:** Claude in Chrome must be connected and the user must be logged into Tekion. If the browser extension isn't connected, fall back to Path D (text paste) and ask the user to paste the data instead.

## Step 1: Navigate to the Dashboard

Navigate to the Tekion APC Dealer Dashboard:
```
URL: https://apc.tekioncloud.com/app/dealer-dashboard/list
```

Take a screenshot to verify the page loaded and the user is logged in. If a login page appears, tell the user they need to log in first — do not enter credentials.

## Step 2: Filter for Pending Onboarding

The dashboard shows all dealers across all statuses. Filter to show only new dealers:

1. Click the **Status** dropdown filter at the top of the page
2. Select **"Pending Onboarding"** from the options
3. Wait for the table to reload

This filters out already-onboarded dealers and shows only the ones that need ClickUp tasks.

## Step 3: Identify New Dealers from the List

Take a screenshot of the filtered table. Read the **Dealer Name** column from each visible row. If there are more rows than fit on screen, scroll down and screenshot again until all "Pending Onboarding" rows are captured.

Check each dealer name against `seen_orgs` in the memory file and against ClickUp list `901105435045`. Only proceed with dealers that are NOT already onboarded.

Present the list of new dealers to the user and confirm which ones to onboard before clicking into each one.

## Step 4: Scrape Dealer Details (Click Into Each Row)

For each new dealer, click into the row to open the **Dealer Details** page. This page contains:

- **Dealer ID** — the full, untruncated Tekion Dealer ID (e.g. `youngautomotivegrouput_6837_0`)
- **Address** — full address including street, city, state, zip, and country (e.g. `1855 N Main St, Logan, Utah, 84341-1704, United States of America`)
- **App Name** — should be "EZ Wins"
- **Status** — "Pending Onboarding"

The detail page layout:
```
Dealer Details
  Dealer ID:    <full dealer ID>
  App Name:     EZ Wins          Version: 1.0.0       Address: <full address>
  Requested at: <date>           Installed at: <date>  Modified at: <date>
```

Use `get_page_text` or `read_page` to extract the Dealer ID and Address fields. You can also use JavaScript:

```javascript
// Extract dealer details from the detail page
const text = document.body.innerText;
const dealerIdMatch = text.match(/Dealer ID\s*\n?\s*([a-z0-9_]+)/i);
const addressMatch = text.match(/Address\s*\n?\s*(.+?)(?=\n\s*(?:Requested|Installed|Modified|Product))/s);
JSON.stringify({
  dealerId: dealerIdMatch?.[1]?.trim(),
  address: addressMatch?.[1]?.trim()
});
```

**Parse the address** into its components. The format is typically: `<street>, <city>, <state>, <zip>-<zip4>, United States of America`. Split on commas to extract:
- Dealership Address: street portion
- City: city portion
- State: state portion (may be full name like "Utah" — convert to abbreviation for region detection)
- Zip Code: zip portion (use the 5-digit zip, drop the -XXXX extension)

After extracting data, click the **back arrow** (top-left, `<` icon) to return to the filtered list, then click into the next dealer.

## Step 5: Detect Brand, Group, and Region

Apply the same detection logic as other paths using the scraped address data. Since you now have real addresses from Tekion, region detection should be straightforward — no "ASK" cases unless the state isn't in the mapping.

## Step 6: Human Review (REQUIRED before ClickUp)

Present all scraped entries for review. The table should include the Tekion-sourced address:

```
| # | Dealership Name | Tekion Dealer ID | Brand | Group | Address (from Tekion) | Region |
|---|-----------------|------------------|-------|-------|-----------------------|--------|
```

Call out the same items as Path D — brands that couldn't be detected, groups to confirm, etc.

## Step 7: Create ClickUp Tasks

Use the **Tekion Description Format** (same as Path D) and follow the shared steps in **Creating the ClickUp Task Tree** and **Adding MOC Users Comment**.

---

# Shared Steps (All Paths)

## Creating the ClickUp Task Tree

### Name Casing Rule

If the dealership name comes through in ALL CAPS from the feed (e.g. "MOON TOWNSHIP HONDA"), convert it to proper title case (e.g. "Moon Township Honda") for both the ClickUp task name and the `Dealership Name:` field in the description. Do not change names that are already mixed case. This applies to all paths (Fortellis, Reynolds, DealerVault, Tekion).

### Independent Dealer Owner Rule

If the dealership is independent (not owned by a group), set the `Owner:` field to the dealership name (properly cased) rather than leaving it blank. Only leave Owner blank if the group is truly unknown and pending confirmation.

### Parent Task

```
clickup_create_task:
  name: "<Dealership Name>"
  list_id: "901105435045"
  task_type: "Branch"
  description: "<the formatted description — Fortellis, Reynolds, DealerVault, or Tekion format>"
  custom_fields:
    - id: "43c67974-d08b-4549-b1f8-0fc0be06de17"
      value: "<region_option_id>"
```

### MOC Region Custom Field

The "MOC Region" field is a dropdown on the onboarding list. When creating the parent task, set it using the `custom_fields` parameter with the field ID `43c67974-d08b-4549-b1f8-0fc0be06de17` and the option ID for the detected region:

| Region             | Option ID                                |
|--------------------|------------------------------------------|
| MOC NorCal         | `d9c02c57-50ba-4950-9b94-ee9c93458b48`   |
| MOC SoCal          | `356fcd52-b954-4006-afa9-72ef6707ac1e`   |
| MOC PNW            | `66976ac8-9670-42de-ab78-e6020d25754c`   |
| MOC Central        | `88c2a4b2-267c-496d-8297-57b557355d5c`   |
| MOC Mid-Atlantic   | `657ebb99-f1dd-4649-8708-78460de74db8`   |
| MOC Canada         | `35eadf0b-2aa1-49c1-aaa6-1e359e61f261`   |
| Other Distributors | `ee4ab31d-2909-4767-ad19-e8d2d79301f6`   |

### Subtasks (Auto-Created by ClickUp)

**Do NOT manually create subtasks.** Setting `task_type: "Branch"` triggers a ClickUp automation that automatically creates the full subtask tree. The skill only needs to create the parent task — ClickUp handles the rest.

### If multiple new dealerships

Create each parent task one at a time so the user can see progress.

## Adding MOC Users Comment

After creating each parent task, add a comment listing the MOC users who need access to that account. Use `clickup_create_task_comment` on the **parent task**.

### Reading the user list

The user list lives in a Word document on the user's computer:

**File:** `MOC Users - Onboarding.docx`
- **File tools path (Read/Grep/Glob):** `/Users/blakedaniel/Documents/MOC Templates & Resources/MOC Users - Onboarding.docx`
- **Bash path:** `/sessions/*/mnt/MOC Templates & Resources/MOC Users - Onboarding.docx` (use the session's actual mount prefix)

This folder is Blake's default workspace folder and should already be mounted. If it's not accessible, use `request_cowork_directory` with path `~/Documents/MOC Templates & Resources` to mount it.

At the start of the onboarding run, read this file using `pandoc` (or Python zipfile XML extraction if pandoc is unavailable) to extract its contents. The file is organized by region with user names listed under each heading. Parse the headings and names to build the region-to-users mapping dynamically — do NOT hardcode names, since MOC updates this file.

### Building the comment

For each new dealership task, combine:

1. **All Locations** users (always included)
2. **Region-specific** users based on the task's MOC Region

**MOC Central special handling:** The docx splits Central into sub-sections (e.g. "MOC Central (Houston)" and "MOC Central (Texas)"). During human review, ask the user which Central sub-region applies for each Central dealership, then include only the matching users.

### Comment format

```
Users to Assign:

Dave Waco
George Logan
Monty Skinner
Jeremy Liberato
Anthony Green
```

The comment is a plain text list — "Users to Assign:" header, blank line, then one name per line. All Locations users first, then region-specific users.

### If the file is not accessible

If the docx file cannot be found or read (e.g. the user hasn't mounted the folder), ask the user to either provide the file or mount the MOC Templates & Resources folder. Do not skip this step — the comment is required for every onboarding task.

## Adding Group Comment

If the dealership belongs to a dealer group, add a second comment to the parent task about the group setup in EZ Wins. The memory file tracks which groups have already been created in EZ Wins (in the `seen_groups` array).

**IMPORTANT — EZ Wins Group Naming Rule:** The EZ Wins platform automatically appends the word "Group" to any group name entered. So when specifying a group name in comments, **omit "Group" from the end**. For example, if the dealer group is "Deacon Jones Auto Group," the EZ Wins group name should be **"Deacon Jones Auto"** (EZ Wins will display it as "Deacon Jones Auto Group" automatically). The `seen_groups` entries in the memory file should also follow this convention — store the name WITHOUT the trailing "Group."

Check the memory file's `seen_groups` list:

- **Group is NOT in `seen_groups`** (new group) → Post this comment:
  ```
  Please create the [Group Name] group in EZ Wins and add [Dealership Name] to the group.
  ```
  Where `[Group Name]` does NOT include the word "Group" at the end (EZ Wins appends it).
  Then add the group name to `seen_groups` in the memory file so future onboardings know it exists.

- **Group IS in `seen_groups`** (existing group) → Post this comment:
  ```
  Please add [Dealership Name] to the [Group Name] group.
  ```
  Same rule — `[Group Name]` omits trailing "Group."

- **No group** → Skip this comment entirely.

Use `clickup_create_task_comment` on the parent task, same as the MOC Users comment.

---

# Reference: Brand Detection

The script identifies brands from dealership names (used by all paths):
- **CDJR** -> "Chrysler, Dodge, Jeep, Ram"
- **VW** -> "Volkswagen"
- Multiple brands comma-separated: "DeMontrond Buick GMC" -> "Buick, GMC"
- `False` = no brand found — user must review before ClickUp creation

# Reference: Group Detection

Known groups and their prefixes. The confirmed group name goes in the **Owner** field of the task description:
- Capitol, Team -> DGDG Group
- George Gee -> Gee Automotive Companies
- DeMontrond/Demontrond -> DeMontrond
- Ron Tonkin/Tonkin -> Ron Tonkin
- Speck -> Speck (when multiple Speck dealers appear together)
- Young -> Young Automotive (when multiple Young dealers appear together)
- Jim Ellis, Hansel, Hanlees, Car Pros, Doggett, Don Ayres, Southern, United, Manly, Lyle Pearson, Winter, Weatherford, Midlands

For new/unknown stores, leave Group blank and let the user provide it during review.

# Reference: Region Detection

The region detection logic applies to all paths. For Fortellis, the script handles it automatically. For Reynolds, DealerVault, and Tekion, apply the same logic manually based on the address:

| Region             | Coverage                                                              |
|--------------------|-----------------------------------------------------------------------|
| MOC NorCal         | Northern CA (Bay Area, Salinas & north), NV (Reno area)              |
| MOC SoCal          | Southern CA (LA & south), NV (Las Vegas area)                        |
| MOC PNW            | OR, WA, MT, ID                                                       |
| MOC Central        | CO, TX, WY, NM, OK, LA, MS                                          |
| MOC Mid-Atlantic   | NC, SC, VA, MD, WV                                                   |
| MOC Canada         | All Canadian provinces                                                |
| Other Distributors | Everything else (GA, IN, AZ, UT, HI, etc.)                          |

**Ambiguous cases ("ASK"):** Return `"ASK"` in three situations:
1. **CA cities** between NorCal and SoCal (e.g. Bakersfield, Fresno, Visalia)
2. **NV cities** that aren't clearly Reno or Vegas
3. **Any state not yet in the mapping** — rather than guessing, ask the user which region applies. Once confirmed, the state should be added to `STATE_TO_REGION` in the script so it's automatic next time.

During review, ask the user which region to assign for any "ASK" entries. When they confirm a new state's region, note it so it can be added to the script's mapping for future runs.

# Reference: Memory

The memory file tracks two things:
1. **`seen_orgs`** — all previously-onboarded Organization Names
2. **`seen_groups`** — all dealer groups that have been created in EZ Wins

It is stored at `/Users/blakedaniel/Documents/MOC Templates & Resources/Claude/fortellis_memory.json` — the user's persistent workspace folder. During a session, the script operates on a copy at `/tmp/fortellis_memory.json` (since the bash sandbox can't write to the mounted folder). After each onboarding run, the updated memory MUST be saved back to the host path using the Write file tool.

If the memory file doesn't have a `seen_groups` key yet (older format), create it as an empty array and populate it going forward.

**CRITICAL: When saving the memory file, ALWAYS preserve both `seen_orgs` AND `seen_groups`.** Never write only one key — always read the existing file first, merge your updates, and write back the complete JSON with both keys. The Python script's `save_memory()` function handles this correctly; if you update the file manually (e.g. for Reynolds, DealerVault, or Tekion onboardings), make sure you do the same.

Additionally, at the start of every onboarding run, query ClickUp for existing tasks on list `901105435045` (include closed tasks) and merge any dealership names found there into `seen_orgs`. This ensures the memory stays in sync even if the file was lost or a task was created outside this skill.

For Reynolds, DealerVault, and Tekion onboardings, also add each dealership name to `seen_orgs` after creating the ClickUp task so it won't be flagged as new if it later appears in another source.

# After Creating Tasks

Tell the user:
- How many tasks were created
- List each dealership with a link to the ClickUp task and its assigned region
- Note that ClickUp will auto-create the subtask tree via the "Branch" task type automation
- Confirm the MOC Users comment was added to each parent task
- Confirm any group comments were added (new group creation or add-to-existing-group)
