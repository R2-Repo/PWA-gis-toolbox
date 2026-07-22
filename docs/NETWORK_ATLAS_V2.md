# ITS Network Atlas — V2 idea backlog (pre-planned, not committed)

> **Status:** Brainstorm / potential ideas only.  
> **Not** an official roadmap, schedule, or implementation checklist.  
> Nothing here is approved for build until explicitly promoted into a real phase plan.  
> V1 remains the shipped baseline (`docs/NETWORK_ATLAS.md`).

**Primary job of Atlas:** answer the phone on network status and outages, and help determine the extent of a fiber hit / cable cut — plus other operator conveniences around that workflow.

**Related V1 non-goals** (may be revisited here as *ideas*): 24/7 monitoring, email alerts, fiber panel tracing, PWA full parity, DuckDB, SNMP/SSH/CDP.

---

## How to read this doc

| Label | Meaning |
|-------|---------|
| **Idea** | Candidate for a future V2; not scoped or scheduled |
| **Depends on** | Data or platform work that must exist first |
| **V1 today** | What already exists (so we do not rebuild it by accident) |
| **Not yet** | Confirmed absent from the current codebase |

Ideas may be reordered, merged, dropped, or never built.

---

## Idea index

1. [Cut extent assistant](#1-cut-extent-assistant)
2. [Impact blast (deferred)](#2-impact-blast-deferred)
3. [Golden-record merge (ATMS + FiberSwitch)](#3-golden-record-merge-atms--fiberswitch)
4. [Wireless drop dataset + parent fiber link](#4-wireless-drop-dataset--parent-fiber-link)
5. [24/7 monitoring (background watches)](#5-247-monitoring-background-watches)
6. [Project fences](#6-project-fences)
7. [Outage notification wizard](#7-outage-notification-wizard)
8. [Subnet / drop IP range scan (known vs rogue)](#8-subnet--drop-ip-range-scan-known-vs-rogue)
9. [Unified buildings import (Hub + Connected Buildings)](#9-unified-buildings-import-hub--connected-buildings)
10. [Pop-out channel monitor windows (workers)](#10-pop-out-channel-monitor-windows-workers)
11. [Other candidates (lighter touch)](#11-other-candidates-lighter-touch)

---

## 1. Cut extent assistant

**Idea:** When drops go down across interleaved channels along the same road, help find the **probable fiber hit zone** from ping geography — without needing fiber line GIS.

**Operator story:** Channels do not always stack north-to-south as 1 → 2 → 3; they can mix along one corridor. A dig can wound several channels at once. Today you look at ups/downs in an area and puzzle out the common denominator. Atlas could compute that overlap.

**Sketch:**

1. Scope: map area / drawn corridor / selection  
2. Partition in-scope drops by ping status  
3. Per channel with enough downs, build a down footprint  
4. Where footprints from ≥2 channels overlap (or down density is highest) → **probable hit zone**  
5. Use “up” points inside/outside the zone to adjust confidence  
6. UI: halo on map + “channels implicated” + supporting downs + untested to ping next  

**V1 today:** Area query, ping status on drops/hubs, triage, multi-channel map — no cut-extent logic.  
**Not yet:** Cross-channel spatial correlation / probable-hit ranking.  
**Depends on:** Existing drop lat/lon + ping results (already available).  
**Does not need:** Fiber strand / line GIS.

---

## 2. Impact blast (deferred)

**Idea:** Pick a hub / channel / drop / corridor → “what goes dark if this fiber dies?” (downstream devices, sites, IP counts).

**Why deferred:** Needs GIS **fiber map lines** pre-processed and enriched so circuits/channels can be attributed to physical strands. Today Atlas has **points** (sites/switches). A point may reach a hub via multiple distribution fibers along multiple roads; without lines, true blast radius is guesswork.

**V1 today:** Hierarchy and area membership only — not path/topology blast.  
**Not yet:** Strand-level or line-based impact.  
**Depends on:** Future fiber-line dataset + enrichment (create later; not a near-term Atlas coding task alone).

Revisit after fiber GIS exists; until then prefer **cut extent** (symptom-based) over **impact blast** (design-based).

---

## 3. Golden-record merge (ATMS + FiberSwitch)

**Idea:** Go beyond “findings that things don’t add up” — **link and fill blanks** across ATMS Master Device List and FiberSwitchLocation to produce a cleaner working (and eventually exportable) master of locations, channel/drop, asset IDs, and IPs.

**Operator story:** One source has channel/drop/IP; the other has a slightly different name, coords, or missing fields. If channel+drop match, or only one candidate sits nearby, merge and fill. Dirty-source workaround until a single authoritative file exists.

**Sketch:**

```text
Today:  Source A + B → strict match → Atlas entities + findings
V2:     Source A + B → propose merges → review → golden records → Atlas (+ optional export)
Later:  One clean dataset → import becomes simple
```

**Matchers (ladder):** exact IP → inventory name → channel+drop → near-duplicate name → **geo unique candidate**.  
**Output:** Canonical site/drop rows with confidence + human accept/reject for ambiguous pairs.

**V1 today:** Join TMD↔SwitchFiber by inventory name; ATMS↔workbook by exact IP then channel+drop (provisional); some field fill when IP already matched; unmatched → provisional / findings (`js/atlas/import/`).  
**Not yet:** Fuzzy/geo merge UI, systematic blank-fill across near-matches, exportable golden spreadsheet as product goal.  
**Depends on:** Same two imports (plus Hub List / Connected Buildings, or Idea 9’s unified buildings file); operator review for low-confidence links.

---

## 4. Wireless drop dataset + parent fiber link

**Idea:** ATMS includes wireless radio drops that backhaul to a fiber drop via PTP or PTMP. FiberSwitch often has the map point but **missing channel/drop/IP**. Build a first-class **wireless drop** set linked to a **parent fiber drop**.

**Sketch:**

```text
Hub → Channel → Fiber drop (switch IP)
                    ↓  radio hop (PTP / PTMP)
              Wireless drop(s)
```

| Piece | Role |
|-------|------|
| Detect | ATMS wireless / radio device types |
| Anchor | Parent fiber drop (channel/drop/IP) |
| Locate | Worksheet point with lat/lon, incomplete identity → match to ATMS radio |
| Emit | Canonical wireless rows: coords, radio IP, parent link, hop type |
| Map | Distinct symbol; optional hop line; cut-extent treats child radios as explained by parent fiber down |

**V1 today:** Boolean `wireless` tag via `inferWireless` text heuristics; schematic/dashboard counts — **no** parent link or wireless golden set.  
**Not yet:** Wireless drop dataset, PTP/PTMP hop model, parent fiber association UI.  
**Depends on:** Golden-record merge patterns; a way to know/capture parent fiber drop (ATMS column or review UI).  
**Fits with:** Idea 3 (same merge/fill problem; wireless is the incomplete-identity case).

---

## 5. 24/7 monitoring (background watches)

**Idea:** Persistent watches that survive closing the Atlas UI — not the current temporary JS `setInterval` monitor that stops when leaving Atlas.

**Direction (pre-planned preference, not locked):**

- **Do** move the ping loop to Rust (or a small tray/companion process)  
- **Do** persist watch definitions in SQLite; resume after restart  
- **Prefer** tray / background app while a user session is logged in  
- **Defer** a full **Windows Service** unless a machine must run with nobody logged in (Session 0 / ICMP quirks)  
- **Do not** require the Atlas map UI to stay open  

**Sketch:** Watch definitions (targets, interval, retention) → background runner → status in SQLite → UI when open + tray badge; alerts later.

**V1 today:** Temporary monitor sessions in `js/atlas/monitor.js`; stop on leave Atlas / reload DB; history + CSV.  
**Not yet:** Always-on runner, OS login autostart, tray-owned watches.  
**Depends on:** Desktop ping + SQLite (exist); product choice on tray vs login worker.  
**Fits with:** Idea 6 (project fences as scoped watches).

---

## 6. Project fences

**Idea:** Named, saved regional polygons for a **specific job / task / project**, each with its own watch profile — not a single global 24/7 config.

**Configurable per fence (examples):**

- Geometry + name (“SR-89 relocate – week of …”)  
- Auto membership (drops/hubs inside)  
- Ping frequency  
- Lookout rules (any new down, ≥N downs, hub IP down, multi-channel cluster)  
- Expected outage / maintenance windows (mute or tag as expected)  
- Logging scoped to that fence  
- Notifications (later)  
- Lifecycle: active → paused → archived  

**V1 today:** Ephemeral Atlas **area query** for triage/export; GIS Toolbox **import fence** (unrelated — filters map file import).  
**Not yet:** Named persistent project fences with monitor/notify profiles.  
**Depends on:** Idea 5 for true always-on; fences alone are still useful as saved scopes even before 24/7.  
**Fits with:** Cut extent (run inside hot fence), outage notifications (share geometry).

---

## 7. Outage notification wizard

**Idea:** Wizard / widget to draft **emergency** or **planned** outage emails plus a **map screenshot** with the same facts in a title block (matching today’s manual process).

**Typical fields:** date/time, duration, location, parties impacted, contacts — email body and map graphic stay in sync via one form + templates.

**Sketch steps:** kind → when → where (draw / Atlas area / project fence) → impact (Atlas-assisted, editable) → contacts → preview → copy email + save PNG/PDF (mailto/Outlook draft later).

**V1 today:** Map/PDF capture exists elsewhere in GIS Toolbox (presentation/sheet exports); Atlas has printable area reports — **no** outage email+map package wizard.  
**Not yet:** Outage templates, contact book, burned-in title block pack for TOC-style notices.  
**Depends on:** Map capture patterns; Atlas area membership for impact seed text.  
**Shape options:** Atlas companion wizard and/or GIS Widget — undecided.

---

## 8. Subnet / drop IP range scan (known vs rogue)

**Idea:** Each channel is a subnet; each drop owns a **chunk** of IPs (first = switch, rest = devices on that switch). Quickly sweep a **channel** or **drop** range to find expected devices **and** live IPs Atlas does not know about (rogues).

**Classify each address:**

| Result | Meaning |
|--------|---------|
| Expected up | In inventory, replied |
| Expected down | In inventory, silent |
| Rogue / unknown | Replied, not in Atlas for that scope |
| Dark / unused | Silent, not in inventory |

**V1 today:** Ping known inventory IPs only; device rows may carry gateway/subnet/subnetMask; hubs may have `channels_subnet` — **no** range expand + sweep + rogue classify.  
**Not yet:** Allocation model for per-drop chunks; subnet scanner UI.  
**Depends on:** Clear **channel subnet + per-drop IP chunk** rules or an allocation import (biggest prerequisite). Prefer drop-chunk scans first; full channel subnet optional/slower.  
**Fits with:** 24/7 / fences (optional scheduled sweeps); golden-record (discover missing inventory).

---

## 9. Unified buildings import (Hub + Connected Buildings)

**Idea:** Collapse today’s separate **Hub List** and **Connected Buildings** CSVs into **one import document** (one workbook sheet or one CSV). A single **building-type** column tells Atlas whether the row is a **hub** or another kind of **connected building**; the rest of the headers stay in one shared schema — mostly the same columns, with a few type-specific extras filled only when they apply.

**Operator story:** Maintain one master “buildings / sites on the fiber plant” file instead of keeping Hub List and Connected Buildings in sync by hand. Add or edit a row, set type, fill the columns that matter for that type, drop the file in the Atlas inbox.

**Network model (why the extra IPs matter):** Connected buildings are not just map pins — they are **access-switch sites** hanging off the **primary fiber hubs**. Each connected building is **tied back to a hub building** (parent fiber hub). That building owns a **group of IPs** for gear on its LAN:

| IP role | Meaning |
|---------|---------|
| Building switch (1) | Primary network switch at the building (access switch toward the fiber hub) |
| Building switch (2) | Optional second switch at the same building |
| Desktop(s) | Workstations / PCs on that building’s switch |
| Video decoder(s) | Decoders fed from that building’s switch |

```text
Primary fiber hub building
        │
        └── Connected building (access switch site)
                 ├── Switch 1 IP  (+ optional Switch 2 IP)
                 ├── Desktop IPs
                 └── Video decoder IPs
```

Atlas should treat those IPs as **belonging to that connected building**, and the building as **associated to its hub** — so later ping, search, detail, and outage scope can roll up “everything at this building” and “buildings under this hub.”

**Hub detail UI (when you click a hub building):** Today hub detail already shows **primary and secondary channels**. V2 should also list **connected buildings attached to that hub**, with their IPs visible and **pingable** (at least switch IPs; desktops/decoders as available) — same operator habit as pinging channel drops from hub context.

```text
Hub 1-01 detail (today)          Hub 1-01 detail (V2 idea)
├─ Primary channels              ├─ Primary channels
├─ Secondary channels            ├─ Secondary channels
└─ …                             └─ Connected buildings (access sites)
                                      ├─ Building A  — Switch 1 IP  [Ping]
                                      │                 Switch 2 / desktops / decoders…
                                      └─ Building B  — …
```

**Sketch:**

```text
Today:  Hub List CSV  +  Connected Buildings CSV  →  two detectors / mappers
V2:     One buildings document  →  type column  →  hub rows vs building rows
        Connected-building rows carry the building’s IP group + hub association
        Hub click → channels + attached buildings + ping those IPs
```

| Piece | Role |
|-------|------|
| Type column | Discriminator — e.g. `Building Type` / `Site Type`: `Hub`, TOC, cabinet, building, shed, etc. |
| Shared columns | Name / AKA, lat/lon, region, address (optional), status/provider as relevant |
| Hub association | Every non-hub connected building links back to its primary fiber hub (From/To Hub or a single parent-hub field — exact columns TBD) |
| Hub-leaning extras | Hub number/code, Hub IP, channels subnet, is-shed (or type=`Shed`), official-list semantics for ATMS unknown-hub findings |
| Building IP group | Switch 1 / Switch 2, desktop IPs, video decoder IPs — the building’s access-switch LAN; blank on pure hub rows unless hubs later adopt the same slots |
| Import | One inbox filename pattern; mapper splits rows by type into existing `hub` vs `connected_building` (or a future unified table); store IP group + parent hub on the building |
| Map / UI | Hubs keep network-tree + ping behavior; connected buildings show as hub-attached access sites with their IP group in detail (Copy IP / ping) |
| Hub detail | Beside primary/secondary channels: **Attached connected buildings** for that hub, each with IPs + Ping (and Copy IP); open building detail from the row |

**Column model (conceptual — not a locked header list):**

- **Common:** type, display name, lat, lon, region, address, notes  
- **When type = Hub (and close cousins):** hub code, hub IP, channels subnet, shed flag / shed-as-type  
- **When type = other connected building:** parent / From–To hub link(s), provider, status, **building IP group** (switch 1–2, desktops, video decoders)  
- Overlap is intentional: hubs and buildings may share location/region/address-style fields; unused cells stay empty per type

**V1 today:** Two optional inbox files — Hub List (`js/atlas/import/hub-list.js`) and Connected Buildings (`js/atlas/import/connected-buildings.js`); Connected Buildings already has `Building Type`, From/To Hub, and switch/desktop/decoder IP columns, but hubs are a separate file/path and buildings are overlay-only. Hub detail shows primary/secondary channels — **not** an attached-buildings list with ping.  
**Not yet:** Single combined document, type-driven split in one mapper, shared header contract, first-class “building owns this IP group + parent hub” model, **hub detail → attached buildings + pingable IPs**.  
**Depends on:** Agreeing the combined column set + allowed type values with data owners; inbox detect + Review counts for one file; clear hub-association rules (one parent vs From/To) so hub detail membership is reliable.  
**Fits with:** Idea 3 (cleaner source files); Idea 8 (known vs rogue IPs once building LAN ranges are trusted); Idea 10 (optional pop-out monitor later for a building or hub’s attached sites).  
**Compatibility:** Prefer accepting the unified file while still reading the two legacy CSVs during a transition.

---

## 10. Pop-out channel monitor windows (workers)

**Idea:** Grow the right-panel **Details / Channel schematic** experience so a channel (or similar scope) can **pop out** into its own small window — picture-in-picture over Atlas, or a detached panel — with **more than one open at once**, tabbed or stacked the way Windows 11 Terminal / Command Prompt hosts extra sessions. Working name (TBD): **Network Atlas monitor workers** (or “agents” — prefer a plain operator term; exact label undecided).

**Operator story:** During a call or a cut, keep the main Atlas map/tree free while one or more channel “consoles” stay visible. Each pop-out is dedicated to a channel: show the schematic/detail context, **ping the whole channel** if needed, and scroll a **live ping log** (timestamped history of each round / each target) that feels like a command-prompt transcript — not only a last-status badge.

**Still forming:** Exact chrome (PiP float vs true OS window vs in-app tab strip), how many concurrent workers, whether logs are per-window only or also persisted like monitor sessions, and whether “worker/agent” language ships in the UI.

**Sketch:**

```text
Right panel Details / Schematic
        │  “Pop out” / “Open monitor”
        ▼
┌─ Channel 2-03 worker ─┐  ┌─ Channel 1-01 worker ─┐
│ Schematic / summary     │  │ …                     │
│ Ping channel (loop)     │  │ Tabbed or side-by-side │
│ ─────────────────────   │  └───────────────────────┘
│ 14:02:01  D12  up  12ms │
│ 14:02:01  D13  down     │
│ 14:02:05  D12  up  11ms │   ← console-style history
└─────────────────────────┘
```

| Piece | Role |
|-------|------|
| Launch point | Right-panel Details / Channel schematic (and maybe hub/channel context menus) |
| Window model | Pop-out / PiP; multiple concurrent; tabs or separate mini-windows (Terminal-like) |
| Scope | Primarily **one channel per worker**; ping entire channel on demand or on an interval |
| Console log | Append-only (or scrollback) history of each ping attempt — time, target, result, RTT — prompt-like readability |
| Lifecycle | Open / focus / close without losing main Atlas; unclear yet if closing Atlas kills workers (ties to Idea 5) |
| Naming | “Monitor worker” vs “session” vs “agent” — product copy TBD; avoid overselling autonomy |

**V1 today:** Channel schematic + detail live in the **docked** right panel; temporary monitor sessions + history/CSV exist (`js/atlas/monitor.js`, past sessions in SQLite) but are not multi-window channel consoles or pop-outs from the schematic.  
**Not yet:** Pop-out / PiP / multi-tab channel workers; console-style live ping transcript UI; several channel monitors visible at once beside the map.  
**Depends on:** Desktop windowing choices (WebView2 child windows vs in-app floaters); reuse of existing ping + monitor session storage.  
**Fits with:** Idea 5 (background watches — workers might be UI-facing while 24/7 is headless); Idea 6 (fence-scoped workers later); call-mode / cut-extent workflows.  
**Shape options:** In-app floating panels first (simpler); true secondary Tauri windows later if OS-level always-on-top / multi-monitor placement is required.

---

## 11. Other candidates (lighter touch)

Captured in early brainstorm; lower detail, still potential:

- **Call mode** — sparse hotkey UI (search + map + triage) for phone calls  
- **Speakable summary** — selected hub/area → short status paragraph for voice/Slack  
- **Incident card** — pin suspected segment, notes, caller, time; export one-pager  
- **Before/after ping snapshot** — baseline vs post-hit diff on a channel/area  
- **Favorites / recent lookups** — hubs and sites you always get asked about  
- **Stale-import hard guard** — stronger than the 7-day soft banner when data is too old to trust  

These can attach to cut extent, fences, or notifications later.

---

## Suggested dependency sketch (informal)

```text
Unified buildings import ───► One Hub + Connected Buildings source file
         │
         ├──► Connected buildings = access switches under fiber hubs
         ├──► Building IP groups (switch / desktop / decoder) for ping later
         └──► Easier inbox / Review (optional path into golden-record cleanup)

Golden-record merge ──┬──► Wireless drop + parent fiber
                      └──► Cleaner inventory for range scan / cut extent

IP allocation rules ────────► Drop/channel range scan (rogues)

Background monitor runner ──► Project fences (always-on profiles)
         │
         └──► Optional: fence-scoped scans / digests

Pop-out channel workers ────► Multi channel consoles from right-panel schematic
         │
         └──► May share ping/log plumbing with monitor sessions / Idea 5

Cut extent (points) ────────► Phone-call outage workflow (near-term friendly)
Impact blast (lines) ───────► After fiber GIS exists (later)

Outage notification wizard ─► Uses area / fence geometry + templates
```

No ordering is mandatory. Cut extent and notification wizard can proceed without fiber lines or 24/7.

---

## Explicitly out of scope for this backlog doc

- Implementation tickets, estimates, or phase checkboxes to “complete”  
- Windows Service as the default 24/7 design  
- PWA full parity for Atlas monitoring  
- SNMP/SSH/CDP / full NMS replacement  
- Treating these ideas as committed V2 scope  

---

## Agents

- V1 behavior and locked decisions: `docs/NETWORK_ATLAS.md`  
- Desktop boundaries: `docs/PWA_DESKTOP_COMPAT.md`, `.cursor/skills/fix-desktop/SKILL.md`  
- Do **not** implement items from this file unless the user explicitly promotes an idea into an active build plan.
