# Campus Energy Monitoring and Optimisation — Complete Implementation Plan

**Prepared:** 13 November 2026  
**Deliverable:** A working software prototype for a 24-hour hackathon, with documented paths to real hardware integration.  
**Implementation language:** JavaScript for the web application; Python only for computer vision and OCR.  
**Agreed scope:** One college building, its rooms and selected common areas. Multiple-building operation, building comparisons, and expansion to facilities with different operating-hour policies are excluded from this implementation, as requested.

### Quick navigation

| Read this for | Section |
| --- | --- |
| The end-to-end operating flow | [5. Complete final workflows](#5-complete-final-workflows) |
| Meter data, OCR and energy calculations | [6. Meter ingestion](#6-meter-ingestion-validation-and-calculations) |
| Anomalies, recommendations and savings | [7. Baselines](#7-baseline-and-anomaly-engine) and [8. Recommendations](#8-recommendation-and-savings-engine) |
| Software and hardware connections | [9. Stack](#9-recommended-software-stack) through [13. Contracts](#13-backend-api-and-event-contracts) |
| Reliable alerts and switching | [15. Scheduler and command handling](#15-persistent-scheduler-incident-states-and-command-handling) |
| What to build during the hackathon | [20. Execution plan](#20-time-boxed-24-hour-execution-plan) |
| How to verify and demonstrate it | [21. Acceptance checks](#21-acceptance-checks) and [22. Demonstration](#22-demonstration-script-and-seeded-scenarios) |
| Costs and commercial plan | [23. Budget](#23-budget-purchasing-and-operating-cost-plan) and [24. Business model](#24-customer-segmentation-and-business-model) |

## 1. Product objective and agreed decisions

Build an energy dashboard that combines building-level electricity records, timetables, room-use requests, and available occupancy evidence to identify avoidable usage, recommend improvements, assign action, and track the outcome.

The system must support the complete agreed workflow:

1. Observe occupancy through existing CCTV where suitable footage is available.
2. Use an optional human-presence sensor where a camera is unavailable.
3. Use authenticated QR-based temporary access where a room has neither camera nor sensor.
4. Compare apparent equipment usage with occupancy, current bookings, upcoming classes, and staff overrides.
5. Alert the assigned first responder.
6. Escalate unresolved issues after 10 minutes to the assigned HOD or second responder.
7. After a further 15 minutes, re-evaluate eligibility and optionally switch off approved equipment through supported hardware.
8. Restore an automation-disabled supply through eligible occupancy detection, an authorised QR session, or a staff override.
9. Collect building meter readings through CSV/manual entry, an optional meter-facing camera, or supported meter telemetry.
10. Detect abnormal building consumption and investigate possible contributors without inventing room-level measurements.
11. Recommend scheduling and efficiency fixes with estimated kWh and rupee benefits.
12. Track incidents, human actions, command results, data quality, and measured or estimated outcomes.

The admin panel includes staff assignments, escalation rules, room policies, equipment-to-controller mapping, schedules, authorised QR access, tariffs, installation-budget estimates, and integration health.

### 1.1 Required distinction between prototype and installation

- The hackathon must demonstrate functioning application logic and integrations that can run with supplied data.
- Physical installation in the college electrical system is outside the 24-hour deliverable.
- Hardware commands use a simulator by default.
- A documented adapter and connection-test screen must exist for supported physical hardware.
- A simulated OFF result must never appear as a verified physical shutdown.
- Actual installation requires a qualified electrician to inspect circuits, select equipment, preserve protection, and commission the system.
- The website cannot control an ordinary mechanical switch or breaker without an actuator or an existing supported smart interface.

### 1.2 Explicit exclusions

- Multiple-building or multiple-campus management and comparisons.
- A hostel/laboratory/office policy expansion programme or cross-building class consolidation.
- Training a universal appliance detector within the hackathon.
- Exact room-level electricity measurement from CCTV or one building meter.
- Facial recognition, student identity recognition from video, or attendance monitoring.
- Automatic shutdown of every electronic appliance.
- Automatic reset of a fault-tripped breaker or maintenance isolation.
- A production payment/subscription checkout.
- Requiring an LLM API or paid cloud service for core functionality.

## 2. Alignment with the problem statement

Source: PS 34, “AI-Based Campus Energy Monitoring and Optimisation,” page 34 of ps_final.pdf. The specified MVP combines building-level utility and timetable data, anomaly detection, and actionable scheduling and efficiency recommendations. The commercial options include annual per-building subscriptions, meter integrations, savings-performance contracts, and ESG/carbon-reporting modules.

| Problem-statement requirement | Implementation |
| --- | --- |
| Building-level utility ingestion | CSV, manual readings, optional meter-image OCR, optional meter adapter |
| Timetable ingestion | Room schedule CSV and admin editing, including cancellations, holidays and ad hoc bookings |
| Energy dashboard | Daily/hourly consumption, expected usage, interval quality and unexplained increases |
| Anomaly detection | Explainable comparisons against relevant historical intervals or a configured initial baseline |
| Actionable optimisation | Recommendation cards, owners, prioritisation, estimated savings and follow-up |
| Measurable value | Action history and carefully labelled consumption/savings reports |

CCTV, QR access, presence sensors, escalation, and optional control are supporting features. The core energy dashboard must remain usable without those devices.

## 3. Evidence rules and operating principles

### 3.1 Never confuse these observations

| Evidence | What the system may claim | What it must not claim |
| --- | --- | --- |
| Building meter | Electricity recorded for its mapped supply | Which unmetered room consumed the electricity |
| Camera | People and observable equipment states within validated coverage | Complete occupancy or consumption outside the view |
| Radar presence sensor | Presence indication within its tested detection zone | Exact person count, identity or guaranteed room-wide coverage |
| Timetable | Expected authorised use | Proof that someone is physically present |
| QR session | An authorised request for temporary supply | Proof that the room is occupied until expiry or empty afterwards |
| Relay status | Controller-reported output position | Independently verified appliance consumption |
| IR OFF command | An OFF request was transmitted | The AC actually received and obeyed it |
| Rated watts multiplied by time | An equipment-based estimate | Metered room consumption or verified savings |

Every reading, chart series, recommendation and outcome carries a source label:

- **Metered:** validated energy telemetry or accepted meter readings.
- **Camera-observed:** a visual observation with timestamp and confidence.
- **Sensor-reported:** a presence or device-state report.
- **Estimated:** a baseline, rated-load calculation or proposed benefit.
- **Simulated:** generated fixtures, clip replay or device simulation.
- **Unknown:** unavailable, stale, ambiguous or insufficient evidence.

### 3.2 Conservative control defaults

- Start every room in alert-only mode.
- Automatic control requires explicit room/circuit enablement and a tested adapter.
- Positive occupancy immediately blocks pending vacancy shutdown.
- Unknown occupancy blocks occupancy-driven automatic shutdown.
- Keep cameras, sensors, controllers, network equipment and emergency lighting outside the routine cutoff.
- Human or timetable changes cancel or invalidate pending actions.
- Use explicit ON and OFF commands; avoid a power-toggle command.
- Essential equipment and computers needing graceful shutdown remain outside routine power cutoff.
- Observe appliance-specific restart delays, operating requirements and load ratings.
- A timetable match must concern the current time or a short preparation window; tomorrow’s booking does not protect an empty room today.

## 4. Users, permissions and admin controls

| Role | Responsibilities and permissions |
| --- | --- |
| Administrator | Configure rooms, users, policies, integrations, tariffs, import data, enable approved control |
| HOD / second responder | View assigned department incidents, acknowledge, resolve, snooze within policy, review recommendations |
| Lab assistant / technician / first responder | Receive assigned incidents, inspect equipment, record actions and evidence |
| Teacher / authorised staff | Request room access, extend an allowed session, create an approved override, view assigned room status |
| Student / general viewer | View permitted information or request approval; no default direct power-control privilege |
| Integration service | Submit only its own camera, meter or device telemetry using a scoped service credential |

Assignments are stored against rooms or selected common-area zones. Configure first responder, backup responder, second responder and optional urgent-notification group. This is role and department assignment inside one installation, not a multi-building management feature.

Admin policy fields include:

- Vacancy confirmation period, default 15 minutes for the pilot after coverage testing.
- Escalation delays: 10 minutes, then another 15 minutes.
- Booking preparation window, initially 15 minutes.
- Sensor/camera freshness limits, configurable by source cadence.
- Supported control mode: alert-only, simulated, or approved physical control.
- Approved target circuits and essential-load exclusions.
- Maximum QR access duration, initial default 120 minutes.
- QR-expiry warning period, initial default 10 minutes.
- Physical/manual override behaviour and who can extend it.
- Source-quality thresholds and integration availability.

All initial thresholds are configuration defaults to validate during a pilot, not guaranteed universal settings.

## 5. Complete final workflows

### 5.1 Initial setup and mapping

1. Enter the building name, timezone and meter identifier.
2. Create the rooms and relevant common-area zones.
3. Add a manual appliance inventory: device name, category, approximate rated watts, essential/nonessential flag and approved control policy.
4. Map each camera view or sensor to its actual covered room/zone.
5. Record known blind spots and validate coverage with someone seated in the least visible area.
6. Map each controllable equipment item or circuit to the correct adapter and channel.
7. Have an electrician identify whether a room has a dedicated feed, separate light/socket/AC feeds, or a circuit shared with other rooms.
8. Import schedules and assign responders.
9. Configure tariffs and baselines.
10. Test each source, run in alert-only mode, and enable only approved automatic actions after commissioning.

A device recognised in an image is not automatically a registered or controllable appliance. An administrator confirms its identity and mapping.

### 5.2 Occupancy and apparent waste detection

1. The camera processor samples suitable frames rather than continuously uploading all footage.
2. A person detector evaluates the configured room region, including seated people where the model and view allow it.
3. A fresh credible person detection marks the room occupied and invalidates pending vacancy actions.
4. If a calibrated camera or presence-sensor arrangement has no positive occupancy for the vacancy period, evaluate it as vacant only when all required sources remain healthy and coverage is validated.
5. Missing frames, stale telemetry, darkness that prevents detection, model failure, partial coverage or contradictory evidence produce unknown occupancy.
6. Evaluate whether any mapped nonessential equipment is apparently ON or whether a known energised supply is eligible for a waste review.
7. Check current bookings, preparation windows, holidays, cancellations, active QR leases and staff overrides.
8. Open one incident for a persistent eligible issue.

Someone in a corridor must not count as occupying a separate classroom. Use per-room/zone regions and mappings.

### 5.3 Escalation and optional automatic shutdown

The alert clock starts only after confirmed vacancy and the schedule/override checks, not at the first frame with no person.

| Relative time | Action |
| --- | --- |
| t = 0 | Save incident and evidence; notify the assigned first responder |
| t = 10 minutes | If still eligible and unresolved, notify HOD/second responder and retain the incident for the first responder |
| t = 25 minutes | Recheck all current conditions; execute approved OFF action, simulate it, or leave an alert-only/manual task |

At every stage:

1. Reload current occupancy, schedule, room-use leases, override, equipment state, integration health and policy version.
2. Stop if the equipment is already OFF, a person arrives, a relevant booking starts, a valid QR session starts, a manual override applies, or evidence becomes unknown.
3. Acknowledge does not mean resolved. A staff member can mark “inspecting,” apply a permitted time-limited snooze, or submit resolution evidence.
4. A failed notification is recorded and routed to a configured backup; it does not silently skip the remaining checks.
5. At t = 25, an unconnected or unsupported appliance remains an unresolved manual task. The app must not claim it switched it off.
6. A physical command needs fresh evidence, an unexpired command deadline, the correct channel and no interlock.
7. Request the resulting device state and record the level of verification.

Simultaneous incidents for the same circuit must not produce conflicting commands. Reopening an issue creates a new incident episode with a new timeline.

### 5.4 Restoring power when a person enters a camera-covered room

1. A healthy, suitably illuminated camera detects entry/presence.
2. Check whether the supply is OFF specifically because this automation previously disabled it.
3. Check room access policy, operating hours, device health, manual lockout and restart delays.
4. Restore the approved lighting/fan supply if eligible.
5. Cancel obsolete OFF jobs and record the restoration reason.

This restores electrical availability. It does not guarantee that every appliance will resume operation: physical switches may be OFF, and some electronics require their own ON command.

Never restore a supply marked fault-tripped, maintenance-locked, manually isolated or otherwise unsafe. Manufacturer-specific breaker status must distinguish these situations.

### 5.5 Camera-free rooms with an LD2410 presence sensor

1. Power the LD2410 and its ESP32 controller from a supply that remains available when the controlled load is OFF.
2. Read the sensor through UART or the supported presence output; match the exact module’s voltage and pinout.
3. Test detection of seated people and tune range/sensitivity for the actual room.
4. With connectivity, submit timestamped presence events to the application.
5. With no Wi-Fi, the ESP32 can run local presence and relay/contactor logic if designed and commissioned for that mode.
6. Central alerts/dashboard updates require some communication path: shared Wi-Fi coverage, wired networking through a suitable gateway, or another separately designed link.

The bare LD2410 has no Wi-Fi. A Wi-Fi-only breaker cannot receive wireless commands where there is no network; a local wired relay/contactor path is required for the standalone option.

Important: the central 10-minute/15-minute staff-escalation workflow is unavailable during a completely disconnected standalone deployment. In the MVP, loss of the server connection suspends central automatic commands. A standalone local timeout is a separately configured operating policy, not an imitation of successfully delivered central alerts.

### 5.6 QR access in rooms without cameras or presence sensors

1. Display a printed QR containing an opaque room-access URL, not a control password or device IP.
2. User scans it and signs in.
3. Server checks role, permitted room, allowed hours, booking conflicts, requested duration and any lockout.
4. Create a room-use lease with a server-controlled start and expiry.
5. Enable only the approved supply through the control adapter.
6. Warn the requesting user before expiry and offer an authorised extension.
7. An active lease protects the room against vacancy-based shutdown.
8. Expiry removes that protection; it does not change actual occupancy to vacant.

For a room with no occupancy source:

- Default physical policy: expiry creates a staff action/confirmation request, because occupancy remains unknown.
- The dashboard can simulate a fixed-duration supply contract with advance warnings and extension.
- A physical fixed-duration cutoff is a separate opt-in policy for specifically approved circuits, accepted by authorised users and backed by a working local override. It must not be represented as proof the room became empty.
- A newly approved QR lease or manual extension cancels old expiry-related OFF work.

The QR route still needs a reachable server/network to issue central commands. A printed QR alone provides neither connectivity nor proof of physical presence; a photograph of a static QR can be shared. Do not describe authentication as proof the user is standing in the room.

### 5.7 Building energy spike detection and investigation

1. Ingest and validate energy observations.
2. Derive compatible intervals and their consumption.
3. Compare the current interval with an expected baseline using schedule and calendar context.
4. Open an anomaly incident for a sufficiently large, credible deviation.
5. Notify configured energy/facility responders; urgent broadcast is configurable rather than sending every warning to everyone.
6. Review time-aligned camera observations, active bookings and device telemetry as possible explanations.
7. Attach evidence-supported candidate contributors.
8. If no cause is established, assign a manual inspection across relevant areas, including unmonitored areas.
9. Record the inspection result and any confirmed cause.

Absence of an explanation in CCTV-covered areas does not prove the excess came from areas without CCTV.

Example alert:

> Building consumption exceeded the expected range during 14:00–15:00. Lights appear ON in Room A despite no scheduled use. This is a possible contributor, not measured room-level attribution. Inspect Room A and other relevant areas. Cause remains unconfirmed.

An unexplained building-level spike must not trigger a blind shutdown of an arbitrarily selected room.

### 5.8 Optimisation, assignment and outcome

1. Create an explainable recommendation from an observed pattern.
2. Include supporting dates, energy source, assumptions, proposed change, owner, estimated savings range and priority.
3. Allow accept, reject-with-reason, schedule, complete and verify.
4. Show later consumption alongside a comparable baseline.
5. Separate estimated benefits, observed reductions and independently verified savings.

## 6. Meter ingestion, validation and calculations

### 6.1 Supported input routes

| Route | MVP implementation | Important limitations |
| --- | --- | --- |
| Utility CSV | Upload, preview, validate and commit | Monthly bills cannot support hourly spike detection |
| Manual entry | Timestamped reading form with provenance | Record corrections and who entered them |
| Meter-facing camera | Upload images or optional camera polling and OCR | Focus, glare, changing display registers and OCR errors require validation |
| Existing meter telemetry | Adapter for a documented meter/API/gateway if available | Register units and meter coverage must be confirmed |

No external meter API is assumed to exist. Use imports and manual entries as the guaranteed working path.

### 6.2 Meter-facing camera workflow

Use one fixed small camera facing the building’s main electricity meter. Default capture cadence is 60 minutes, as agreed. Capture a short burst if needed to find the correct display register.

1. Record meter ID, cumulative-import kWh register, decimal format, register identifier if shown, and any actual display multiplier.
2. Mount externally with suitable focus and lighting without opening, altering or obscuring the utility meter.
3. Configure a reading region and reference image.
4. Capture timestamped frames and identify the intended kWh register.
5. Extract the digits with OCR.
6. Check agreement between multiple usable frames and validate the result.
7. Store the raw text, selected image reference, parsed value, capture time, receipt time, OCR quality and validation status.
8. Re-capture or request review when ambiguous.
9. Use only accepted readings in measured charts and anomaly calculations.

AI on the Edge Device is an optional ESP32-CAM implementation to evaluate, with its MQTT/REST output normalised by an adapter. Server-side OpenCV plus Tesseract is another route for uploaded meter images. Neither route is guaranteed to recognise an arbitrary meter without calibration.

Checks include:

- Correct meter and register, expected decimal placement and units.
- Duplicate capture/event rejection.
- Monotonic cumulative import readings within the same meter epoch.
- Physically plausible growth based on the actual supply limit and elapsed time.
- No timestamp far in the future or unexpected chronology.
- Explicit handling of meter replacement, counter reset and rollover.
- A significant jump triggers a repeat/read review before becoming an anomaly, not automatic rejection merely because usage is unusual.
- Missing readings remain missing; do not silently reuse an old value with a new timestamp.

Net-metering import/export registers and multipliers require explicit configuration if present. Do not treat exported energy or apparent energy as ordinary imported kWh.

### 6.3 Energy and power calculations

For two accepted cumulative readings from the same meter epoch:

    intervalEnergyKwh = currentReadingKwh - previousReadingKwh
    durationHours = (currentTimestamp - previousTimestamp) / 3600000
    averagePowerKw = intervalEnergyKwh / durationHours

Example: 1,200 kWh at 10:00 and 1,206 kWh at 11:00 means 6 kWh consumed over that hour, or 6 kW average power.

- kWh is energy; kW is power.
- An hourly reading difference is not instantaneous peak demand.
- Short power spikes can be hidden within the hourly average.
- Faster alerts require shorter intervals compatible with meter resolution or direct telemetry.
- A gap between 10:00 and 14:00 provides a four-hour total. It does not measure four separate hourly values.
- Daily totals must display coverage. Partial-day readings cannot be labelled a complete day.
- Sum interval-energy inputs; difference cumulative inputs. Do not double-difference or double-count duplicate sources.
- Utility totals and camera-read totals are reconciled, not added together.

### 6.4 Import contracts

Cumulative meter CSV:

~~~csv
meterId,capturedAt,readingKwh,register,source
MAIN-01,2026-11-13T10:00:00+05:30,1200.0,import_kwh,manual
MAIN-01,2026-11-13T11:00:00+05:30,1206.0,import_kwh,manual
~~~

Interval CSV:

~~~csv
meterId,intervalStart,intervalEnd,energyKwh
MAIN-01,2026-11-13T10:00:00+05:30,2026-11-13T11:00:00+05:30,6.0
~~~

Timetable CSV:

~~~csv
roomCode,startAt,endAt,title,status
R101,2026-11-13T10:00:00+05:30,2026-11-13T11:00:00+05:30,BCA lecture,confirmed
~~~

Import preview shows invalid rows, duplicate rows, timezone assumptions, meter epoch, format type and the intended data source. Re-imports must be idempotent. CSV labels do not automatically confer trusted measured status: simulated fixtures remain simulated.

## 7. Baseline and anomaly engine

Use a deterministic, explainable method first. An LLM is not required to decide whether consumption is abnormal.

### 7.1 Baseline selection

1. Compare like-duration intervals or aggregate to compatible buckets.
2. Prefer relevant historical intervals with similar hour, weekday/calendar category and timetable activity.
3. With sufficient data, refine weekday matching; initially group similar teaching days separately from holidays/weekends.
4. Require a configurable minimum sample count, initially eight compatible valid intervals.
5. Use a median and robust variability measure such as median absolute deviation.
6. If history is insufficient, use an administrator-configured expected range and label it “initial rule baseline.”
7. If no credible baseline exists, show “insufficient baseline data,” not an invented anomaly probability.
8. Exclude known bad readings; document treatment of confirmed exceptional events and avoid letting ongoing incidents rapidly redefine normal usage.
9. Weather is optional context only if available; disclose when it is not considered.

An initial threshold can be:

    thresholdKwh = max(
      expectedKwh + absoluteExcessFloorKwh,
      expectedKwh * (1 + relativeThreshold),
      expectedKwh + 3 * robustSigmaKwh
    )

The floor and relative threshold are configurable and require pilot tuning. If expected usage is zero or tiny, use an absolute deviation rather than an unstable percentage.

### 7.2 Anomaly record and triage

Store interval, actual kWh, expected range, excess kWh, baseline version, source quality, severity, possible contributors and inspection status.

Examples:

- Elevated usage after the last scheduled class.
- Repeated overnight consumption above the configured essential-load baseline.
- A sustained increase across comparable teaching sessions.
- A meter-reading discontinuity: data-quality incident first.

Do not call every normal AC start or busy event a fault. A consumption anomaly is a review signal, not an electrical protection mechanism.

## 8. Recommendation and savings engine

### 8.1 Recommendation catalogue

| Pattern | Suggested action | Evidence needed |
| --- | --- | --- |
| Persistent consumption after final class | Adjust approved shutdown schedule and assign final-room inspection | Energy intervals plus timetable |
| Lights observed ON in an unused room | Inspect and switch off eligible lighting; consider a vacancy policy | Fresh occupancy and equipment evidence |
| Repeated unexplained overnight usage | Inspect always-on equipment and document essential loads | Meter history and inspection |
| Several suitable rooms used sparsely in the same building | Review timetable consolidation within available room capacity | Timetable, capacity and staff review |
| Repeated manual forgetfulness in one room | Compare a low-cost retrofit with estimated avoidable usage | Incident history and installed-cost quote |
| Lighting apparently unnecessary in daylight | Review lighting zones or suitable daylight control | Calibrated observations; human confirmation |
| Inefficient or excessive AC operation suspected | Request maintenance/settings review under the institution’s comfort policy | Equipment observations and maintenance review |

These are recommendations for human review. Do not alter teaching schedules, temperatures, or electrical policies automatically.

### 8.2 Recommendation fields

- Title, evidence and explanation.
- Proposed action and responsible role.
- Estimated kWh saving range and cost saving range.
- Calculation method, period and assumptions.
- Implementation cost or quote, payback estimate when meaningful.
- Confidence/uncertainty and measurement limitations.
- Priority, status, due date and follow-up interval.
- Links to related incidents and completed actions.

### 8.3 Savings and ROI calculations

For a rated-load estimate:

    estimatedAvoidableKwh = ratedWatts / 1000 * avoidableHours
    estimatedEnergyCostSaving = estimatedAvoidableKwh * configuredMarginalTariff

For a post-action comparison:

    observedReductionKwh = comparableBaselineKwh - observedPostActionKwh

An observed reduction is not automatically causally verified savings. Record changes in occupied hours, timetable, weather and equipment where known.

For a commercial evaluation:

    estimatedMonthlyNetBenefit =
      estimatedMonthlyEnergyCostSaving
      - monthlySoftwareEquivalent
      - recurringConnectivityAndMaintenance
      - estimatedAddedSystemEnergyCost

    simplePaybackMonths = oneTimeInstalledCost / estimatedMonthlyNetBenefit

Show payback only when net benefit is positive. Tariff inputs are supplied by the institution; an energy-only calculation excludes fixed charges, demand charges and other bill components unless explicitly modelled.

Avoid overlapping recommendation savings. Two suggestions about the same light and idle hour cannot both be counted fully. Do not sum room estimates and building-meter totals as separate consumption.

## 9. Recommended software stack

Keep the application small enough to complete and debug within 24 hours.

| Layer | Choice | Purpose |
| --- | --- | --- |
| Frontend | React, Vite, JavaScript | Dashboard, admin forms, incident and QR-access screens |
| Styling | Tailwind CSS through its current Vite integration | Responsive UI without a large component framework |
| Navigation | React Router | Protected application routes |
| Charts | Recharts | Consumption, expected range and daily profiles |
| HTTP client | Native fetch with one shared API wrapper | Consistent auth, errors and request cancellation |
| Live application updates | Socket.IO | Incident, room-state and command updates |
| Backend | Active LTS Node.js and Express | Auth, policies, imports, analytics and integration API |
| Database | MongoDB with Mongoose | Application data and persistent jobs/outbox |
| Validation | Zod on the Node API; Pydantic in Python | Reject invalid contracts at service boundaries |
| Authentication | Server sessions, express-session, connect-mongo; bcrypt password hashing | Role-based application access |
| CSV parsing | csv-parse on the backend | Validated streaming imports |
| QR generation | qrcode | Printable room-access URLs |
| Email | Nodemailer with configured SMTP, optional | External notification delivery |
| Vision/OCR service | Python, FastAPI, OpenCV, NumPy, Tesseract through pytesseract | Camera capture, ROI processing and meter-image OCR |
| Person detection | A small pretrained model appropriate to its accepted licence | Person detection on approved footage |
| Device messaging | MQTT.js and a private Mosquitto broker, optional | ESP32/gateway event and command transport |
| Microcontroller firmware | ESPHome for LD2410/MQTT or a small dedicated ESP32 programme | Sensor integration and commissioned local rules |
| Optional device gateway | Home Assistant | Bridge supported IR and smart-device integrations |
| Verification | Node test runner or Vitest, Supertest, selected browser checks | Policy, calculations, imports and end-to-end flows |

Node and frontend dependencies must be selected from currently supported versions and committed in lockfiles. Use an Active LTS Node version compatible with the installed Vite version; do not blindly copy an old runtime requirement from a tutorial.

Tailwind’s current Vite integration differs from older Tailwind v3 setup guides. Follow the current official installation guide rather than combining both approaches.

If using Ultralytics code/models, read and record the actual licence obligations before selecting that detector. Its open-source and enterprise routes have different conditions. Do not assume that pretrained weights are free of obligations for a closed commercial product. No particular detector/model accuracy is promised by this plan.

### 9.1 Core functionality without optional services

The following must work with just frontend, backend and MongoDB:

- Login and permissions.
- Room and equipment setup.
- CSV/manual meter ingestion.
- Timetable import and editing.
- Consumption dashboard and explainable anomalies.
- Recommendation cards and action tracking.
- In-app alerts and persisted escalation.
- QR lease workflow with simulated controls.
- Simulated device adapter and explicit fixture replay.

Python inference, SMTP, MQTT, Home Assistant and physical devices are independently enabled integrations. Absence of an optional service must show unavailable status and preserve the rest of the application.

## 10. Architecture and integration boundaries

The backend is the policy authority. The browser never directly controls a relay, talks to a camera with embedded credentials, or decides to cut power.

```mermaid
flowchart TD
  Inputs["Meter and timetable inputs"] --> API["Application API"]
  Vision["Camera or presence gateway"] --> API
  Web["Dashboard and QR access"] --> API
  API --> DB["MongoDB and persistent jobs"]
  DB --> Worker["Policy and escalation worker"]
  Worker --> Notify["Notification adapters"]
  Worker --> Control["Device adapters"]
  Control --> Devices["Simulator or approved hardware"]
  Devices --> API
```

### 10.1 Recommended demo topology

- Run Node API, background worker, MongoDB and optional Python inference on a laptop or other continuously running local host.
- Serve the built frontend from the Node server for a simple same-origin demo.
- Connect a phone to the same reachable network for QR demonstrations.
- Use a prerecorded, clearly labelled clip when an authorised live feed is unavailable.
- Default every device adapter to the simulator.
- Keep the persistent job worker running independently of the browser.

### 10.2 Real installation topology

- Place a local gateway on the network that can actually reach the CCTV/NVR and controllers.
- It processes approved footage locally and forwards compact observations.
- A cloud-hosted dashboard cannot reach private camera addresses merely because an RTSP URL is stored.
- If the application is hosted remotely, the gateway uses an authenticated outbound connection; do not expose raw CCTV ports or unrestricted device control to the internet.
- Cloud notification failure and local camera failure are distinct faults.
- If central connectivity is lost, follow the configured local policy. Do not replay expired switching commands when the connection returns.
- No separate Wi-Fi router is required for every classroom if an access point already provides sufficient coverage.
- A temporary local network can work without internet. Cloud SMTP, external messaging and cloud-only devices may still be unavailable.

## 11. Hardware choices and how each integrates

### 11.1 Equipment and capability matrix

| Existing equipment | Practical control method | Minimum integration work |
| --- | --- | --- |
| Hardwired lights | Suitable retrofit relay or a controlled lighting circuit | Electrician mapping; supported device adapter |
| Compatible ordinary fans | Rated relay for ON/OFF; separate compatible regulator for speed | Confirm motor/load rating and regulator compatibility |
| AC with IR remote | Compatible IR controller for normal commands | Learn/test discrete OFF and model-specific settings |
| Approved larger circuit/load | Small controller operating a correctly selected contactor, or a suitable remotely operated protective device | Electrician design, load/inrush checks, protection and manual override |
| Plug-connected suitable equipment | Rated smart socket or mapped switched socket circuit | Confirm power, starting current and appliance restart behaviour |
| Unsupported or essential equipment | Monitoring, warnings and assigned manual tasks | No automatic cutoff |

Do not infer suitability from an advertised “10A,” “16A,” or “63A” label alone. Lighting drivers, motors and other loads have different switching behaviour. A consumer relay’s resistive rating is not a universal equipment rating.

### 11.2 Single room master control

One controller can switch a room’s connected loads together only when the electrical arrangement supports it.

- A room may have separate lighting, socket and AC supplies.
- A circuit may also feed another room.
- Existing MCB/RCCB/RCBO protection must remain suitable.
- Some products marketed as “smart breakers” are principally remote switches. Verify the actual protective functions and installation requirements.
- A genuine protective smart breaker needs verified characteristics appropriate to the circuit.
- Repeated operational switching must be within the manufacturer’s allowed duty/endurance.
- A room master OFF makes existing wall switches ineffective until supply is restored.
- Restore controls and local overrides must be available without depending solely on a student’s phone.

The application maps physical circuit coverage explicitly. A room name is never enough to establish what a breaker controls.

### 11.3 Minimum information before purchasing

| Item | Information to obtain |
| --- | --- |
| Existing circuits | What each breaker actually supplies; whether neutral/space is available |
| Loads | Running current, starting behaviour, essential functions and restart requirements |
| Camera | Authorised RTSP/NVR access, stream format, low-light capability and coverage |
| Smart controller | Exact model, protective/switching ratings, local/API support, feedback and manual operation |
| Presence sensor | Exact LD2410 variant, pinout/supply, tested room coverage and required controller |
| Meter | Register type, units, decimal resolution, multiplier, display cycle and cumulative/interval semantics |
| Network | Coverage at actual controller locations, not just at the classroom entrance |
| Installation | Electrician quote, enclosure, protection, override and commissioning |

### 11.4 Retrofit relay integration steps

1. Choose a device with a documented control API or a supported local gateway integration.
2. Confirm the exact model’s supported functions; an app-only product is not automatically usable by the custom website.
3. Have the electrician install it and retain suitable manual operation.
4. Connect it to the relevant network and reserve a stable address where appropriate.
5. Pair it through the manufacturer’s required process.
6. Configure server-side credentials and an allowlisted endpoint.
7. Add its adapter/channel mapping in the admin panel.
8. Run a connection test and a supervised ON/OFF test with a known permitted load.
9. Check reported state and, if fitted, meter telemetry.
10. Keep alert-only mode until commissioning is complete.

Tinxy/Sonoff products can be price references, but their mobile app compatibility does not establish a stable public control API for every model. Do not build a core dependency on an unverified private cloud endpoint.

### 11.5 Example supported relay API boundary

Shelly devices exposing the documented Switch component can use explicit Switch.Set and Switch.GetStatus calls. Power/energy fields are available only on models/components that actually meter them.

Illustrative manufacturer RPC payload for a supported Switch component:

~~~json
{
  "id": 101,
  "method": "Switch.Set",
  "params": { "id": 0, "on": false }
}
~~~

This is an example for a compatible relay component, not a universal smart-breaker command. A protective breaker may expose a different component and interlock behaviour. Its adapter must follow that exact model’s documentation.

Normalise manufacturer replies into the application’s command/result contract. Do not expose the manufacturer’s device address or credentials to the frontend.

### 11.6 IR controller and AC integration

Use a supported local integration, such as Home Assistant’s documented Broadlink integration for a compatible remote, if available.

1. Pair the IR controller and confirm it reaches the intended AC.
2. Learn or configure the exact model’s commands.
3. Prefer a discrete OFF command, not an ambiguous power toggle.
4. Verify that commanding one AC does not affect an unintended unit.
5. Send through a backend adapter or local gateway.
6. Respect minimum restart/off periods and manufacturer operating requirements.
7. Report “command transmitted” until actual state feedback or inspection confirms the result.

IR control does not require replacing the AC. It does require compatible codes, placement and a working command path. Do not use hard power cycling as the normal equivalent of an AC’s OFF command.

### 11.7 LD2410 plus ESP32

For an inexpensive presence prototype:

- Use the correct LD2410/LD2410B/LD2410C module and a compatible ESP32.
- ESPHome already has an LD2410 component using UART.
- Supply appropriate regulated low-voltage power and an enclosure.
- Sensor-to-ESP32 communication is wired; Wi-Fi is an optional transport from the ESP32 to the server.
- Use timestamped online/offline reports and conservative state handling.
- A raw sensor board cannot switch mains.
- A qualified installer selects and connects the relay interface/contactor for real loads.

Classroom commissioning:

- Test seated students in all relevant areas.
- Test vacancy with fans, curtains and ventilation running.
- Test a person behind furniture or outside the expected sensor angle.
- Test whether movement outside the intended room creates false presence.
- Test a sensor disconnect and reboot.
- Add sensors if a single unit does not cover the room.

A sensor’s advertised maximum range is not proof that it covers an entire classroom.

### 11.8 No-network operating choices

| Location condition | Supported behaviour |
| --- | --- |
| Shared Wi-Fi available; no internet | Local API/gateway and local dashboard can work; cloud-only services may not |
| No Wi-Fi; suitable wired network exists | Use an appropriate wired gateway/controller |
| No networking at all | Standalone ESP32/sensor/relay logic only; no live central dashboard or central alert delivery |
| Wi-Fi-only smart breaker with no network | No wireless command path; add coverage or use a different wired/local design |

Do not present a central room QR webpage as operational in a place with no route to that webpage and controller.

### 11.9 Optional metering hardware

If existing hardware provides energy readings, integrate them through a separate meter adapter. A smart ON/OFF device does not necessarily measure energy.

Circuit/room meters are optional for substantiating room-level consumption; the required MVP works with the building meter. Do not add room meters to the prototype budget unless explicitly selected.

## 12. Camera and OCR service implementation

### 12.1 Service responsibilities

The Python service:

- Opens an authorised video file, USB source or supported network stream through OpenCV.
- Applies administrator-defined room regions.
- Samples a configurable low frame rate, initially 1–2 frames/second per demo source.
- Runs person detection and returns observations.
- Optionally applies a calibrated light-state heuristic to a registered ROI.
- Extracts meter-region images and runs OCR.
- Publishes service health and source freshness.

It does not own users, room access, alert escalation, schedules or power decisions. Those remain in the Node backend.

### 12.2 Appliance observation limitations

- Standard person models do not automatically detect every ceiling light, fan, AC and appliance.
- Manually register inventory and regions first.
- Light brightness can be affected by daylight and camera exposure.
- A still image is not a reliable proof that a fan stopped.
- An AC’s appearance is not reliable power-consumption telemetry.
- If a class cannot be observed reliably, return unknown.
- Do not train and promise a universal appliance-state model in 24 hours.

### 12.3 Internal endpoints

| Method and endpoint | Purpose |
| --- | --- |
| GET /health | Service/model availability |
| POST /v1/observe-frame | Analyse a supplied bounded frame and region configuration |
| POST /v1/ocr-meter | Analyse a supplied bounded meter image |
| POST /v1/sources/:id/start | Start an administrator-configured source |
| POST /v1/sources/:id/stop | Stop the source |

Source addresses are configured by an administrator and validated on the gateway. Do not accept arbitrary camera URLs from a public analysis request.

Every result includes sourceId, capturedAt, processedAt, modelVersion, dataMode and quality information. Uploaded clips run in replay mode and cannot submit live physical-control evidence.

If the model is unavailable, report it and support a clearly labelled replay/fixture path. Never substitute an unexplained hardcoded “person detected” response.

## 13. Backend API and event contracts

All application routes use /api/v1. Use stable string IDs, explicit units, ISO 8601 timestamps, schema validation and standard error responses.

### 13.1 Application endpoints

| Area | Endpoints |
| --- | --- |
| Auth | POST /auth/login; POST /auth/logout; GET /auth/me |
| Installation settings | GET/PATCH /settings |
| Rooms | GET/POST /rooms; GET/PATCH /rooms/:id; GET /rooms/:id/status |
| Inventory | GET/POST /devices; PATCH /devices/:id |
| Assignments | GET/PATCH /rooms/:id/assignments |
| Timetable | GET/POST /schedules; PATCH /schedules/:id; POST /imports/timetable |
| Utility data | POST /imports/meter-readings; POST /meter-readings; GET /meter-readings; POST /meter-images |
| Analytics | GET /analytics/summary; GET /analytics/intervals; GET /analytics/anomalies |
| Incidents | GET /incidents; GET /incidents/:id; POST /incidents/:id/acknowledge; POST /incidents/:id/snooze; POST /incidents/:id/resolve |
| Recommendations | GET /recommendations; POST /recommendations/:id/accept; POST /recommendations/:id/reject; POST /recommendations/:id/complete |
| QR access | GET /access/:publicToken; POST /rooms/:id/access-leases; POST /access-leases/:id/extend; POST /access-leases/:id/end |
| Override | POST /rooms/:id/overrides; POST /overrides/:id/end |
| Integrations | GET /integrations; POST /integrations/:id/test; PATCH /integrations/:id |
| Commands | POST /devices/:id/commands; GET /commands/:id |
| Ingestion | POST /ingest/observations; POST /ingest/device-events; POST /ingest/meter-readings |
| Operations | GET /health; GET /ready; GET /audit-events |
| Demo only | POST /demo/scenarios/:id/start; POST /demo/reset |

Validate role and room scope on every mutation and every Socket.IO subscription. Public QR lookup returns only minimal room/access-policy information, never controller credentials or full staff details.

### 13.2 Occupancy observation contract

~~~json
{
  "eventId": "unique-source-event-id",
  "sourceId": "CAM-R101",
  "roomId": "room-r101",
  "capturedAt": "2026-11-13T10:30:00+05:30",
  "sourceType": "camera",
  "occupancy": "occupied",
  "detectedPeople": 3,
  "confidence": 0.94,
  "coverageValidated": true,
  "quality": { "usable": true, "reason": null },
  "dataMode": "live",
  "modelVersion": "record-actual-model-version"
}
~~~

Occupancy enum: occupied, vacant, unknown. The server computes freshness and room state. An untrusted client cannot force vacancy by posting a count of zero.

Treat detectedPeople as the model’s observation, not a certified headcount. Camera confidence is not the probability that the entire room is empty.

### 13.3 Meter reading contract

~~~json
{
  "eventId": "meter-main-01-capture-unique-id",
  "meterId": "MAIN-01",
  "capturedAt": "2026-11-13T11:00:00+05:30",
  "kind": "cumulative",
  "register": "import_kwh",
  "value": 1206.0,
  "unit": "kWh",
  "sourceType": "camera_ocr",
  "dataMode": "live",
  "quality": {
    "ocrConfidence": 0.96,
    "registerMatched": true,
    "burstAgreement": true
  }
}
~~~

The backend decides accepted, needs_review or rejected. Incoming confidence does not bypass validation.

### 13.4 Device command contract

~~~json
{
  "requestId": "unique-command-id",
  "deviceId": "LIGHTING-R101",
  "action": "off",
  "reason": "vacancy_escalation",
  "incidentId": "incident-id",
  "policyVersion": 4,
  "expiresAt": "2026-11-13T11:00:30+05:30"
}
~~~

The backend/gateway adds issuedAt and the authorised actor, then persists the command before transport.

Normalised result:

~~~json
{
  "requestId": "unique-command-id",
  "transportStatus": "acknowledged",
  "reportedOutput": "off",
  "verification": "controller_reported",
  "verifiedAt": "2026-11-13T11:00:02+05:30",
  "dataMode": "simulated"
}
~~~

Valid verification levels: simulated, command_only, controller_reported, independently_metered, manually_confirmed, unknown. A simulated result remains simulated even if its reportedOutput is OFF.

### 13.5 Application MQTT topics

Use a private broker and an application-defined normalised protocol, for example:

| Topic | Purpose | Retained? |
| --- | --- | --- |
| energy/rooms/R101/presence | Timestamped presence state | May retain state; freshness is mandatory |
| energy/devices/CTRL-R101/availability | Online/offline | Yes |
| energy/devices/CTRL-R101/command | Explicit action, ID and expiry | No |
| energy/devices/CTRL-R101/result | Command outcome | No |
| energy/meters/MAIN-01/reading | Reading observation | No, or deduplicated state with original capture time |

These are application topics, not claims about a manufacturer’s native topic names. Adapters translate actual device protocols.

Use authenticated per-device access control. With QoS 1, duplicates are possible: deduplicate events and commands. Retained old presence must never be mistaken for fresh occupancy. Do not retain ON/OFF commands that might execute after reconnection.

## 14. Database collections and consistency rules

Use one installation configuration. Do not implement multi-building/tenant hierarchies for this scope.

| Collection | Essential fields |
| --- | --- |
| settings | Installation name, timezone, tariff configuration, default policies, data mode |
| users | Name, email, password hash, role, department label, permitted room IDs, active flag |
| rooms | Code, name, capacity if known, zone type, assigned users, occupancy policy, control policy, policyVersion |
| devices | Room, category, ratedWatts, essential flag, adapter ID, physical channel, circuit coverage, capabilities |
| integrations | Source/adapter type, allowed endpoint, credential reference, capabilities, lastSeenAt, health |
| schedules | Room, start/end, title, status, origin/import ID, timezone and cancellation details |
| observations | Event/source IDs, room, capture/receipt times, occupancy/equipment observation, quality, data mode |
| meterReadings | Meter, epoch, kind/register, value/unit, time range, provenance, validation state |
| energyIntervals | Start/end, kWh, average kW, coverage, source-reading IDs and calculation version |
| baselines | Matching rule, expected range, sample count, training window and version |
| incidents | Type, room/device or building-meter scope, active flag, evidence, state, responder assignments and timestamps |
| jobs | Incident/action, dueAt, policyVersion, status, lease owner/until, attempt count |
| notificationOutbox | Incident/stage/recipient, channel, idempotency key, delivery state and provider response |
| accessLeases | Room, requester, approved duration, start/expiry, warning/extension state, acceptance of policy |
| overrides | Room/circuit, creator, scope, reason, start/end and cancellation |
| commands | Request ID, target, action, reason, issue/expiry time, transport result and verification |
| recommendations | Pattern, evidence, action, owner, estimate, status and outcome |
| auditEvents | Actor/service, action, target, timestamp and redacted before/after |
| sessions | Application session store |

### 14.1 Indexes and idempotency

- Unique event ID per integration/source.
- Unique room code.
- Unique command request ID.
- Unique import identity for each source record.
- Unique notification stage/incident/recipient/channel key.
- A partial unique index for one active incident per defined issue key.
- Jobs indexed by status and dueAt.
- Schedules indexed by room and start/end.
- Observations indexed by room/source and capturedAt.
- Meter observations indexed by meter/epoch/register/time.

Use database-enforced indexes rather than relying solely on frontend duplicate checks.

TTLs may clean old sessions/observations according to retention policy. MongoDB TTL cleanup is not a precise timer and must not execute power-control deadlines.

### 14.2 Occupancy aggregation

Keep separate fields for:

- Observed occupancy: occupied/vacant/unknown.
- Authorised-use protection: schedule, access lease or override.
- Controller output state.
- Appliance operating-state evidence.

Any fresh credible occupied signal protects the room. Vacant requires the configured coverage and source-health conditions. Source disagreement or inadequate coverage yields unknown unless a fresh positive occupancy already establishes occupied.

Neither an expired QR lease nor a timetable cancellation is an occupancy observation.

## 15. Persistent scheduler, incident states and command handling

### 15.1 Durable jobs

Use a MongoDB-backed due-job table with a separate Node worker for the MVP. A short polling interval only discovers due jobs; stored dueAt determines timing.

1. Persist the incident episode and required work.
2. Claim a due job atomically using a lease and conditional status update.
3. Reload the incident, source freshness, policy version, schedule and access state.
4. Cancel obsolete work.
5. Persist notification/command intent using a stable idempotency key.
6. Execute through the adapter with a deadline and bounded retries.
7. Persist the result and release/complete the lease.
8. On restart, recover expired worker leases and reevaluate overdue jobs.

Do not keep 25-minute escalation solely in setTimeout, browser storage or a frontend countdown.

For the 24-hour build, use one worker process with idempotent operations. If using multi-document transactions, configure a MongoDB deployment that supports them. Do not claim atomicity across independent collections without a transaction or equivalent consistency design.

Use at-least-once delivery assumptions. External notifications can still duplicate after a crash if a provider lacks idempotency. Record uncertain delivery and avoid claiming exactly-once physical execution.

### 15.2 Incident lifecycle

| State | Meaning |
| --- | --- |
| observing | Potential waste; vacancy/evidence checks are incomplete |
| open | Eligible issue established; first-stage action queued |
| notified_first | First notification attempted and outcome recorded |
| escalated | Second-stage notification attempted and outcome recorded |
| inspecting | Staff acknowledged and are investigating |
| snoozed | Explicit temporary suspension until a recorded deadline |
| shutdown_pending | Final eligibility check/command preparation |
| action_sent | Command transmitted; result pending |
| action_unverified | Command sent without sufficient outcome confirmation |
| resolved | Adequate evidence or recorded manual confirmation closes the issue |
| cancelled | Eligibility ceased, such as someone entering |
| blocked | Unknown evidence, unsupported hardware, lockout or essential equipment |
| failed | Execution/delivery failed and needs review |

Acknowledging an incident does not close it automatically.

### 15.3 Final command eligibility

An occupancy-driven automatic OFF must pass all of these:

- Incident remains active and unresolved.
- Room is still confirmed vacant.
- Required evidence remains fresh and usable.
- No protected booking/preparation period, active QR lease or override.
- Target circuit is mapped and does not include protected loads.
- Automatic control is explicitly enabled.
- Adapter and device are healthy.
- No maintenance lock, fault trip or incompatible device state.
- No minimum-cycle/restart constraint is violated.
- Policy version and command deadline are current.
- Data is live, and the application is armed for approved physical control.

Revalidate after waiting for any command lock. New evidence invalidates pending work. Use short command expiries and gateway checks to reduce races; do not promise zero latency between a person entering and a physical device receiving a command.

An explicit fixed-duration access policy is a separate command reason with its own approval and override rules. It must not bypass fault/essential-load interlocks or be labelled vacancy detection.

### 15.4 Notification and escalation transport

- Guaranteed MVP channel: persisted in-app inbox plus live updates.
- Optional external channel: SMTP email.
- Additional SMS/WhatsApp integrations are optional and require their own official provider setup.
- Store assignment snapshots and current routing; an administrator can deliberately reassign an incident.
- Include room, issue, time, evidence summary, requested action, deadline and authenticated incident link.
- Provider accepted, delivered, read and acknowledged are different states.
- A clicked acknowledgement is not evidence the light was switched off.

## 16. Frontend screens and dashboard requirements

### 16.1 Overview

- Energy consumed today, with data coverage.
- Actual versus expected interval chart.
- Estimated energy-only cost using configured tariff.
- Active anomalies, open room incidents and assigned tasks.
- Potential savings from non-overlapping recommendations.
- Latest meter timestamp and source/quality badge.
- Integration health.
- Clear demonstration/simulation banner where relevant.

Do not display a live instantaneous kW gauge from hourly readings. Label the derived value “average power over the interval.”

### 16.2 Room status

- Occupancy and freshness.
- Current/next relevant schedule.
- Active QR lease or override.
- Registered devices and controller capabilities.
- Observed state versus controller-reported state.
- Alert/escalation countdown based on server dueAt.
- Manual action controls visible only to authorised roles.
- Camera/sensor unavailable state and coverage notes.

### 16.3 Incidents and task details

- Filter by assignment, room, status, age and severity.
- Timeline of observations, notifications, acknowledgements and commands.
- Acknowledge, inspect, bounded snooze, reassign and resolve.
- Resolution method and evidence.
- Distinguish suspected cause from confirmed cause.

### 16.4 Energy and imports

- Hourly/daily trend and expected range.
- Anomaly inspection drawer.
- CSV preview with invalid/duplicate row reporting.
- Manual reading form.
- Meter image review with raw OCR text and correction audit.
- Data gaps and quality history.

### 16.5 Recommendations

- Ranked cards with actionable changes and owners.
- kWh/rupee estimate ranges, assumptions and implementation cost.
- Accept/reject/complete/verify workflow.
- Before/after comparison with uncertainty labels.

### 16.6 QR access page

- Mobile-first, fast loading and accessible.
- Room name, login, requested duration, policy and available supply.
- Approval/denial reason.
- Remaining lease time, advance warning and extension action.
- No hidden power switching on GET/page load.
- Explicit indication when only simulation is connected.

### 16.7 Admin

- Rooms, inventory, sources, assignments and role scope.
- Timetable and holiday management.
- Tariffs, anomaly thresholds and recommendation rules.
- Notification routing.
- Integration connection tests.
- Control eligibility, overrides and fault/maintenance status.
- Budget estimator and installation quote fields.
- Audit history and data-retention controls.

The UI should use clear colours with text labels, keyboard-accessible actions, readable charts and responsive layouts. Do not rely on red/green alone to convey a control state.

## 17. Security, access and deployment rules

- Use HTTPS for a network-accessible installation and secure, HttpOnly session cookies.
- Validate browser mutation origins and apply CSRF protection where cookie authentication is used.
- Restrict CORS to the actual frontend origin when cross-origin development is needed.
- Enforce role and room checks on the server.
- Rate-limit login, QR lease creation and control commands.
- Store password hashes and encrypted/referenced integration secrets.
- Never place SMTP, meter, camera, broker or controller credentials in VITE variables or browser JavaScript.
- Redact RTSP passwords and tokens from logs and exports.
- Device/service ingestion has separate scoped credentials, replay protection and timestamp validation.
- Validate uploaded file sizes/types and parsing limits.
- Do not accept arbitrary remote URLs through public endpoints; prevent requests to unintended internal services.
- Use only footage the institution authorises.
- Retain minimal occupancy metadata by default; avoid storing identifiable video when it is unnecessary.
- Restrict any stored evidence images and define a short, configurable retention period.
- Model licensing and footage-use requirements are checked before distribution.
- Physical action is server-controlled, not enabled by hiding/showing a frontend button.

### 17.1 Simulation isolation

- DEMO_MODE and ALLOW_PHYSICAL_CONTROL are enforced on the server and gateway.
- When demonstration mode is on, real switching adapters cannot be instantiated.
- Accelerated time, replayed clips and fixture observations cannot authorise physical action.
- Demo notification recipients are test/in-app recipients; do not seed real staff email addresses.
- Use separate demo MQTT topics or a separate broker if necessary.
- Every simulated command, reading and chart preserves its dataMode throughout the pipeline.
- A replayed clip becoming vacant is not fresh live evidence.

### 17.2 Local-first deployment

For the hackathon, run the complete stack locally first. Optional hosting must not introduce sleeping workers or break private-network camera/device access.

If hosting the frontend separately:

1. Configure its API base URL and allowed origin.
2. Confirm authentication, cookie and live-update behaviour over HTTPS.
3. Keep the worker on a continuously running host.
4. Keep camera processing/device gateway on the reachable local network.
5. Test gateway disconnection and expired-command rejection.

No platform’s permanent free hosting allowance is assumed. Hosting, model runtime and notification-provider limits must be checked at deployment time.

## 18. Credentials, tools and information to collect

| Required item | How to obtain it | Needed for core demo? |
| --- | --- | --- |
| Meter data | Institution-provided readings/CSV, manually entered values, or clearly labelled fixtures | Yes, through at least one input route |
| Timetable | Convert the selected rooms’ timetable to the agreed CSV | Yes |
| Staff roles/assignments | Administrator supplies names and authorised contact details; demo uses test users | Yes |
| Tariff assumption | Institution’s applicable energy-rate input or an explicitly hypothetical demo rate | Yes for cost estimates |
| MongoDB connection | Local MongoDB or a configured hosted database | Yes |
| Session secret | Generate a strong server secret; never commit the real value | Yes |
| Camera/NVR access | Institution’s read-only stream details and permission | Only for live camera mode |
| Vision model and weights | Download from the selected official project, record version/licence and test | Only for actual inference |
| Tesseract executable | Install from the official project’s documented route | Only for the chosen OCR path |
| MQTT broker credentials | Local private broker administrator | Only for MQTT integration |
| Home Assistant URL/token | Local administrator provisions a restricted gateway connection | Only for supported HA adapters |
| Controller credentials/model docs | Manufacturer pairing and documented integration route | Only for physical control |
| SMTP host/user/credential | Institution or selected email provider | Only for external email |
| LLM API key | Not required | No |

### 18.1 Environment configuration template

Example placeholders only:

~~~dotenv
NODE_ENV=development
PORT=5000
APP_TIMEZONE=Asia/Kolkata
MONGODB_URI=mongodb://127.0.0.1:27017/campus_energy
SESSION_SECRET=replace_with_a_generated_secret
FRONTEND_ORIGIN=http://localhost:5173
PUBLIC_APP_URL=http://localhost:5000
DEMO_MODE=true
ALLOW_PHYSICAL_CONTROL=false
DEMO_TIME_SCALE=60
DEVICE_ADAPTER=simulator
VISION_BASE_URL=http://127.0.0.1:8001
SERVICE_INGEST_TOKEN=replace_with_a_separate_service_secret
NOTIFICATIONS_MODE=in_app
VACANCY_CONFIRMATION_MINUTES=15
FIRST_ESCALATION_MINUTES=10
FINAL_ESCALATION_ADDITIONAL_MINUTES=15
BOOKING_PREPARATION_MINUTES=15
QR_MAX_DURATION_MINUTES=120
QR_EXPIRY_WARNING_MINUTES=10
MQTT_URL=
MQTT_USERNAME=
MQTT_PASSWORD=
HOME_ASSISTANT_URL=
HOME_ASSISTANT_TOKEN=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
~~~

Camera/controller secrets belong in a protected server-side credential configuration, not in a public sample file.

The application validates configuration at startup. Production must reject placeholder secrets and physical-control enablement without required configuration. Leaving optional credentials blank disables that adapter cleanly.

Use UTC for persisted timestamps and Asia/Kolkata for the pilot’s display/calendar interpretation. Distinguish local schedule time from UTC boundaries when computing daily totals.

## 19. Project structure and implementation order

### 19.1 Suggested repository layout

| Path | Contents |
| --- | --- |
| frontend/ | Vite React JavaScript application |
| frontend/src/pages/ | Overview, Rooms, Incidents, Energy, Recommendations, Access, Admin |
| frontend/src/components/ | Charts, status badges, forms, evidence and timeline components |
| frontend/src/services/ | Shared API and Socket.IO clients |
| backend/src/routes/ | Validated application endpoints |
| backend/src/models/ | MongoDB/Mongoose schemas and indexes |
| backend/src/policies/ | Occupancy, schedule protection and command eligibility |
| backend/src/services/ | Meter ingestion, baselines, anomaly detection, recommendations and leases |
| backend/src/adapters/ | Simulator, supported relay, breaker, MQTT, IR and notification adapters |
| backend/src/workers/ | Persistent job and outbox processing |
| backend/src/security/ | Sessions, roles, scoped ingestion and secret handling |
| vision/app/ | FastAPI, capture workers, person detection, meter OCR and health |
| firmware/ | Optional ESP32/ESPHome configuration templates |
| shared/ | JSON contracts, enums and OpenAPI documentation |
| fixtures/ | Clearly labelled synthetic readings, schedules, observations and permitted sample media |
| tests/ | Policy, calculation, API and integration verification |
| docs/ | Setup, hardware mapping, demo script and evidence limitations |

### 19.2 Setup procedure for the coding agent

1. Read this plan and inspect any existing repository before scaffolding.
2. Preserve unrelated files and any existing working integration.
3. Confirm a compatible Active LTS Node version and Python environment.
4. Create the frontend with the Vite React JavaScript template.
5. Configure current Tailwind Vite integration.
6. Create the Express backend, session store and schema validation.
7. Connect MongoDB, create required indexes and add test accounts.
8. Define shared contracts before wiring the UI and integrations.
9. Build the guaranteed CSV/manual ingestion and simulated control paths first.
10. Add the persistent worker and policy tests.
11. Wire the dashboard to the real backend.
12. Add actual inference/OCR as separate adapters.
13. Add optional MQTT/HA/physical adapters behind connection tests and disabled defaults.
14. Record installed dependency versions and model licences.
15. Document exact start/build/seed/test commands that actually exist.

Illustrative frontend scaffolding:

~~~bash
npm create vite@latest frontend -- --template react
~~~

Do not invent a working command for a service that has not been implemented. The final README must state the actual backend, worker and vision start commands.

## 20. Time-boxed 24-hour execution plan

| Hours | Work | Exit condition |
| --- | --- | --- |
| 0–2 | Scope, contracts, schema, scaffold, auth and seed data | Login and one room available through API |
| 2–5 | Meter/timetable import, validation and interval calculations | Uploaded data produces correct consumption |
| 5–8 | Dashboard, baseline/anomaly logic and recommendation rules | Explainable anomaly and actionable card visible |
| 8–11 | Room observations, incidents, persistent jobs and in-app alerts | Restart-safe first/second/final stages |
| 11–14 | QR leases, manual override and simulated device adapter | Access/extension/cancellation and simulated control work |
| 14–17 | Camera clip/person inference and meter-image OCR path | At least one genuine integration exercised or honestly unavailable |
| 17–20 | Adapter configuration, admin, assignments and recommendation outcomes | End-to-end workflow usable by each role |
| 20–22 | Failure cases, permissions, calculation and timer tests | Core acceptance scenarios pass |
| 22–24 | Demo fixtures, presentation, walkthrough and documentation | Reproducible demo with clear evidence labels |

If time is short:

1. Preserve real CSV/manual ingestion, analytics, recommendations and action tracking.
2. Keep in-app notifications instead of blocking on SMS/WhatsApp/SMTP onboarding.
3. Use the simulator instead of installing mains hardware.
4. Use an approved prerecorded clip instead of an inaccessible live camera.
5. Use manual meter import if OCR cannot be calibrated in time.
6. Show optional integrations as disconnected with a connection guide; do not fake successful integration.

Do not add multiple-building operations or drop recommendations to spend the entire hackathon on appliance detection.

## 21. Acceptance checks

These tests target calculations and actions that could mislead users or cause an incorrect command. They are not cosmetic tests.

| Scenario | Required result |
| --- | --- |
| Cumulative reading increases 1,200 to 1,206 over one hour | 6 kWh and 6 kW average |
| Same increase over two hours | 6 kWh and 3 kW average |
| Meter gap | Show aggregate gap interval; do not invent measured hourly points |
| Bad OCR digit or wrong register | Needs review/re-capture; no false energy anomaly |
| Meter reset/replacement | New epoch; no negative consumption |
| Duplicate import or event | No doubled consumption, incident or notification job |
| Low baseline history | Initial-rule or insufficient-data label |
| Occupied room with no booking | No vacancy shutdown |
| Vacant room with active/preparation-window booking | Protected against vacancy shutdown |
| Tomorrow’s booking only | Does not protect today’s unrelated idle period |
| Person enters at minute 24 | Pending minute-25 cutoff cancelled |
| Camera or sensor disconnects | Unknown occupancy; automatic vacancy cutoff blocked |
| Camera cannot see a seated person in a blind spot | Coverage fails validation; no claim of reliable vacancy |
| First responder acknowledges only | Incident remains unresolved unless separately verified |
| Staff snooze expires | Reevaluate current evidence before any further action |
| Worker restarts before escalation | Recover persisted work without blindly repeating old commands |
| Duplicate MQTT delivery | Idempotent explicit state command; no toggle reversal |
| Stale retained presence | Does not become fresh evidence |
| QR lease starts during pending cutoff | Pending cutoff invalidated |
| QR lease expires without an occupancy source | Occupancy remains unknown; apply the separately configured expiry policy |
| QR extension conflicts with booking | Reject or require appropriate approval |
| Unauthorised QR/user control request | Denied server-side |
| IR command transmitted without feedback | Command-only/unverified, not confirmed OFF |
| Unsupported appliance | Manual task, not simulated physical success |
| Breaker fault-tripped or maintenance-locked | No automatic restoration |
| No Wi-Fi and no network route | Local-only mode indicated; central notifications not claimed |
| Building spike without local metering | No fabricated room kWh or definite cause |
| Overlapping saving recommendations | Benefits are not counted twice |
| Demo accelerated clock | Only simulated actions and test notifications |
| New booking/override arrives during queued action | Current policy/version invalidates stale work |

Also complete a frontend production build, API smoke check, role walkthrough, QR phone check on a reachable URL and one full incident-to-outcome run.

## 22. Demonstration script and seeded scenarios

Use a deterministic dataset with 30 days of synthetic labelled meter intervals and a few rooms in this one building. Keep synthetic data visibly separate from any real meter observations.

| Demo | What to show |
| --- | --- |
| 1. Normal class | Person present and/or active booking; no unnecessary warning |
| 2. Forgotten lights | Vacant room, no relevant booking; first alert, HOD escalation, simulated OFF |
| 3. Person returns | Occupancy cancels a pending shutdown and, where eligible, restores automation-disabled supply |
| 4. QR access | Authorised request enables simulated supply; warning/extension demonstrated |
| 5. Building anomaly | Actual-versus-expected chart and a suspected contributor with evidence limits |
| 6. Unknown cause | Manual inspection requested, including unmonitored areas, without false attribution |
| 7. Optimisation card | Recommendation, estimated benefit, responsible person and completion outcome |
| 8. Failure handling | Camera offline or bad meter image produces unknown/review, not blind switching |

Accelerate the demo clock only in isolated simulation mode. Clearly display “Simulation: time accelerated 60×.” Production delays remain 10 minutes plus 15 additional minutes after the first alert. With a 15-minute vacancy-confirmation period, the initial candidate can take about 40 minutes from the last detected occupancy to the final action, assuming every later check passes.

Show real model/OCR output only when it was actually produced from the selected image/clip. If unavailable, show the fallback honestly.

## 23. Budget, purchasing and operating-cost plan

### 23.1 Current reference device prices

Checked during planning on 13 November 2026. Prices/availability can change; these are device references, not installation quotes or endorsements for every load.

| Item | Listed reference price | Qualification |
| --- | --- | --- |
| Tinxy single-channel 10A module | ₹595 including GST | Exact load and custom-integration suitability must be verified |
| Tinxy four-node module | ₹799 including GST | Manufacturer lists up to 500 W per node; not a heavy-load master breaker |
| Tinxy six-node module | ₹1,049 including GST | Same need to check individual load and overall installation |
| Sonoff MINIR4 | ₹1,161.01 before tax | Single relay; verify load and control interface |
| Sonoff DUALR3 | ₹1,411.07 before tax | Two-channel example with model-specific functions |
| Sonoff 4CHPROR3 | ₹3,254 before tax | Four-channel example; not equivalent to a protective MCB |
| Hi-Link LD2410 bare module | ₹430.70 including GST | Referenced listing was out of stock; needs other parts |
| Sonoff SNZB-06P presence sensor | ₹1,713.50 before tax | Requires compatible Zigbee hub and power |
| Sonoff Zigbee Bridge Pro | ₹2,442.50 before tax | Can serve multiple compatible devices within a functioning network |

Do not assume the cheapest listed switch can be driven by the custom application. Integration support is a purchasing criterion alongside electrical suitability.

### 23.2 Planning allowances

| Scenario | Rough allowance | What it excludes |
| --- | --- | --- |
| Software-only hackathon using existing laptop/data | ₹0 additional hardware | Existing electricity, connectivity, hosting and any paid services |
| DIY Wi-Fi presence node | ₹800–₹1,500 in parts | Assembly labour, installation and mains switching |
| Simple approved lighting/fan room control | Approximately ₹1,000–₹2,000 installed | Major rewiring, unsuitable circuits, sensors and extra network coverage |
| Larger-load room control with suitable switching hardware | Approximately ₹2,000–₹5,000+ | Complex distribution changes and model-specific protective smart-breaker quotes |
| Presence node plus simple room control | Approximately ₹1,800–₹3,500 | Major wiring/network changes and extra sensors |
| Meter-facing camera, power and mounting | Obtain a model-specific quote | OCR calibration and maintenance labour |
| Genuine protective smart breaker | Obtain exact model and installation quote | Do not reuse the price of a basic remote relay as its quote |

These allowances are preliminary estimates, not verified local labour quotations. A mains pilot must be quoted after circuit/load inspection.

### 23.3 Lowest-cost rollout

1. Start with utility/timetable imports, recommendations and assigned manual actions.
2. Reuse authorised existing CCTV.
3. Add one presence sensor only where useful and test its coverage.
4. Add automatic control to one high-waste, suitable lighting/fan circuit.
5. Expand control only when avoided energy and operating needs justify its installed cost.
6. Do not buy per-appliance smart bulbs or a separate router for every room by default.

### 23.4 Example payback sensitivity

Illustration only, using a hypothetical ₹8/kWh energy rate:

- A 200 W lighting group left on for 3 unnecessary hours on 22 days consumes 13.2 avoidable kWh/month.
- Energy-only saving would be approximately ₹105.60/month.
- A ₹2,000 installation would take about 18.9 months to recover before software, maintenance, added system power or financing costs.

This example explains why the product should prioritise the largest avoidable usage and useful low-cost actions. Automation is not automatically economical for every room.

## 24. Customer segmentation and business model

This is a go-to-market description, not a requirement to build multiple-customer management in the MVP.

| Segment | Buyer | Main value | Initial offer |
| --- | --- | --- | --- |
| College administration | Principal/administrator | Visibility, lower avoidable bills and accountable action | One-building software pilot |
| Facilities/electrical team | Facility manager | Faster investigation and fewer forgotten loads | Dashboard, incidents and optional integrations |
| Department operations | HOD/technical staff | Clear room-use context and assigned responsibilities | Role-based task and recommendation workflow |

Start with:

- Annual per-building software subscription.
- Optional setup, meter/camera integration and commissioning charges.
- Optional maintenance/support.

Evaluate later, only with adequate measurement and commercial agreement:

- Savings-performance contracts with a defined baseline and verification method.
- ESG/carbon reporting using a stated, current emissions factor and disclosed boundaries.

Do not present estimated savings as audit-certified performance or sell camera-derived room estimates as billing-grade measurements. Carbon reporting is an optional commercial module, not a dependency for the 24-hour build.

Pitch evidence should include the number of incidents resolved, action response time, actual data coverage, recommendation acceptance and estimated or measured outcomes. Pricing and savings percentages remain hypotheses until validated with the institution.

## 25. Operating metrics and maintenance

Track:

- Meter reading acceptance, OCR-review rate and gaps.
- Occupancy-source uptime and stale/unknown time.
- False alerts and missed-occupancy findings from pilot reviews.
- Time to first response, escalation and resolution.
- Commands sent, failed, reported and independently verified.
- Recommendations accepted/completed and non-overlapping benefit estimates.
- Data-source provenance and baseline age.

Review camera framing, sensor placement and circuit mappings whenever furniture, lighting, equipment or wiring changes. Recalibrate the meter reader if the camera moves or the utility meter changes.

Keep the system’s failure mode understandable to staff. Provide an accessible local override and clear instructions for reporting a fault.

## 26. Completion checklist for the implementation agent

- [ ] Scope is one building and selected rooms/zones; no excluded multi-building expansion.
- [ ] Real backend/API is connected to the dashboard.
- [ ] CSV and manual meter routes work without hardware.
- [ ] Timetable changes affect current policy.
- [ ] kWh/kW calculations, gaps and meter epochs are correct.
- [ ] Explainable anomalies and recommendation cards work.
- [ ] Baseline limitations and estimated benefits are labelled.
- [ ] Room occupancy, authorised use and output state are separate.
- [ ] Escalation is persistent: first alert, +10-minute second alert, +15-minute final recheck.
- [ ] Occupancy, booking, QR and manual override invalidate stale OFF work.
- [ ] QR access has role checks, expiry warnings and extension rules.
- [ ] No-camera/no-sensor expiry does not pretend to establish vacancy.
- [ ] Camera failure/staleness produces unknown.
- [ ] At least one actual inference/OCR path is exercised or its fallback is honestly declared.
- [ ] Device adapters expose capabilities and connection health.
- [ ] Physical control is disabled by default and isolated from demo/replay.
- [ ] Unsupported equipment generates manual work.
- [ ] Fault/maintenance restoration is blocked.
- [ ] Outcome verification levels and audit history are visible.
- [ ] Budget, tariff and ROI assumptions are editable and disclosed.
- [ ] Role, timer, import, calculation and failure acceptance checks pass.
- [ ] A fresh setup can reproduce the demo from documented commands and fixtures.
- [ ] The README records integrations actually implemented, optional dependencies and remaining limitations.

## 27. Sources and implementation references

Technical documentation and price references were consulted during planning on 13 November 2026. Recheck exact model APIs, firmware, stock, ratings and dependency compatibility at implementation/purchase time. The design rules and budgets in this document are proposed engineering/planning decisions, not manufacturer guarantees.

1. [PS 34 source: ps_final.pdf, page 34](https://chatgpt.com/library?file_id=libfile_e9aba395e40081918e65463d7f5bd73f&account_id=personal).
2. [US Department of Energy: energy-management information-system capabilities](https://www.energy.gov/cmei/femp/energy-management-information-system-capabilities) — utility intervals, expected-usage comparisons and anomaly analysis.
3. [US Department of Energy: school lighting specification guidance](https://www.energy.gov/sites/default/files/2024-12/lighting-spec-guidance-school_nov24.pdf) — occupancy/vacancy controls and school sensor placement.
4. [Axis Object Analytics documentation](https://help.axis.com/en-us/axis-object-analytics) — examples of camera-detection constraints.
5. [AI on the Edge Device source](https://github.com/jomjol/AI-on-the-edge-device) — optional ESP32-CAM meter digitisation.
6. [AI on the Edge Device documentation](https://jomjol.github.io/AI-on-the-edge-device-docs/) and [accuracy/validation FAQ](https://jomjol.github.io/AI-on-the-edge-device-docs/FAQs/).
7. [OpenCV VideoCapture documentation](https://docs.opencv.org/4.x/d8/dfe/classcv_1_1VideoCapture.html).
8. [Tesseract documentation](https://tesseract-ocr.github.io/tessdoc/).
9. [FastAPI documentation](https://fastapi.tiangolo.com/).
10. [Ultralytics documentation](https://docs.ultralytics.com/) and [licensing information](https://www.ultralytics.com/license).
11. [ESPHome LD2410 integration](https://esphome.io/components/sensor/ld2410/) and [MQTT component](https://esphome.io/components/mqtt/).
12. [Hi-Link LD2410B manufacturer information](https://www.hlktech.net/index.php?id=1094) — variant-specific presence sensing information; verify the actual purchased module.
13. [Shelly Switch component API](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Switch/) and [MQTT configuration](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Mqtt/).
14. [Shelly Pro CB product documentation](https://www.shelly.com/products/shelly-pro-1cb-shelly-pro-2-cb-shelly-pro-3cb-shelly-pro-4cb) — protective breaker and remote-restoration constraints.
15. [Shelly guidance on relay stress and contactors](https://support.shelly.cloud/en/support/solutions/articles/103000392781-sticking-relay-what-it-means-and-how-to-prevent-it).
16. [Home Assistant Broadlink integration](https://www.home-assistant.io/integrations/broadlink/) and [MQTT integration](https://www.home-assistant.io/integrations/mqtt/).
17. [Node.js supported releases](https://nodejs.org/en/about/previous-releases).
18. [Vite setup](https://vite.dev/guide/), [Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite), and [Express installation](https://expressjs.com/en/starter/installing/).
19. [MongoDB unique indexes](https://www.mongodb.com/docs/manual/core/index-unique/).
20. [Tinxy smart-switch price references](https://tinxy.in/smart-switches/) and [four-node model information](https://tinxy.in/product/tinxy-four-channel-smart-wifi-switch-compatible-with-alexa/).
21. [Sonoff MINIR4 price reference](https://www.sonoff.in/shop/sonoff-mini-extreme-wi-fi-smart-switch-minir4-812), [DUALR3](https://www.sonoff.in/shop/sonoff-dualr3-804), and [4CHPROR3](https://www.sonoff.in/shop/sonoff-4chpror3-4-gang-wi-fi-smart-switch-for-home-automation-955).
22. [LD2410 bare-module price reference](https://robosap.in/product/hi-link-hlk-ld2410-human-presence-detection-sensor/) — out of stock when checked.
23. [Sonoff SNZB-06P price reference](https://www.sonoff.in/shop/sonoff-snzb-06p-zigbee-human-presence-sensor-933), [manufacturer manual](https://support.sonoff.tech/snzb-06p-usermanual/), and [Zigbee Bridge Pro price reference](https://www.sonoff.in/shop/sonoff-zigbee-bridge-pro-930).



