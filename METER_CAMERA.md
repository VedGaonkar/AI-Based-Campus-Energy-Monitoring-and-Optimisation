# Dedicated meter cameras and reviewed OCR

This optional workflow reads a selected **cumulative imported-energy register**, normalised to kWh. It uses the existing institution database, authentication, worker, import validation, energy calculations and live-update feed. Meter-camera capabilities cannot send occupancy observations or equipment commands. No arbitrary camera URL, RTSP adapter, cloud OCR service or physical meter connection is implemented.

## Local OCR setup

Run explicitly from the repository root:

```bash
npm run setup:ocr
npm run build
npm run dev
```

Normal startup never installs OCR software. Setup installs Python dependencies under ignored `.local/ocr-python` and downloads the checksum-pinned official English model under `.local/ocr-tessdata`. It does not install a global executable, change `.env`, reset accounts or change system Python packages. It needs network access for dependency/model downloads; recognition then runs locally without internet.

Dependencies checked 14 November 2026:

| Component | Version/source | Licence / limitation |
| --- | --- | --- |
| Python | Existing Python 3.11 tested on Windows | Other platforms need a compatible wheel or operator-provisioned Tesseract build |
| tesserocr | 2.13.0, official Python wheel | MIT; embedded Tesseract 5.5.4 in tested Windows wheel |
| Tesseract engine | 5.5.4 tested | Apache-2.0; no accuracy guarantee |
| Pillow | 11.1.0 | HPND/Pillow licence; bounded decoding/crop/orientation |
| English model | `tesseract-ocr/tessdata_fast`, tag `4.1.0`, `eng.traineddata` | Apache-2.0; not a meter-specific trained model |

The model SHA-256 is `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`. The optional Python wrappers initially found on the machine did not include a Tesseract executable; the implemented path uses tesserocr's native binding rather than pretending pytesseract alone supplies an engine. A requested older wheel was unavailable; the pinned available wheel was installed and verified. `vision/requirements-ocr.txt` records the selected dependencies. No whole home-automation or OCR stack was copied into the app.

Supported server settings: `OCR_PYTHON` (default `python`), optional `OCR_MODULE_PATH`, optional `OCR_TESSDATA_PATH`. If the pinned wheel is unavailable on your platform, provision compatible libraries in an isolated environment and point these settings there. Restart the API/worker after configuration changes. **Meter cameras → Test OCR engine** reports actual availability/version; a missing engine produces an actionable error and reviewable capture failure, never fabricated digits. CSV/manual entry remains usable without OCR.

Official references checked through Context7: [tesserocr API and setup](https://github.com/sirfz/tesserocr), [pytesseract's separate engine requirement](https://github.com/madmaze/pytesseract), [official English model](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0).

## Administrator workflow

1. Sign in to the authorised institution as its administrator. Open **Meter cameras**, also available under **Admin management → Meter cameras**.
2. Add a meter identifier/display name and a plausible supply bound, or select an existing configured meter/epoch. No example readings are inserted. Duplicate meter IDs require selection, not another implicit epoch.
3. Register one enabled meter camera for that meter/epoch. It belongs to the current institution and has purpose `meter`, not an occupancy source. Initial interval is **60 real minutes**, even in accelerated demonstration mode. Manual review is the default.
4. Configure the cumulative `import_kwh` register, displayed `kWh` or `Wh`, expected visible unit/register label or OBIS identifier, clockwise orientation and crop. Crop coordinates are fractions from 0 to 1 **after** orientation. Include the relevant identifier/unit as well as the digits. Wh values are divided by 1,000; stored readings use kWh.
5. Set decimal interpretation explicitly: printed point, printed comma, or digits-only implied decimal places. Thousands separators and letter-to-digit substitutions are not guessed. A missing or unexpected decimal is a review reason.
6. Upload one or two bounded JPEG/PNG files, inspect local previews and select **Perform OCR test reading**. The server applies the saved crop/orientation and runs real Tesseract. Test uploads always require review, regardless of automatic permission.
7. Inspect original OCR text, candidate, capture time, source/provenance, validation reasons and retained original image. Enter the visually checked cumulative kWh and a reason to accept/correct; reject unsuitable images. Corrections retain the original text/candidate/configuration/digests and append audit records. The existing energy reading review path also updates linked capture review values.
8. Optionally enable automatic acceptance only after an accepted, high-score, agreeing two-frame test in this exact configuration whose candidate matched the visually accepted value. A test needing digit correction cannot qualify that configuration. Configuration/enabled-state changes reset automatic permission and cancel obsolete jobs. This permission is not a guarantee that later OCR will be correct; continue checking the review queue and a manual sample.

Confidence is the OCR engine's score, **not a calibrated probability of correctness**. In executed tests, a synthetic `5.00` image was read as `9.00` with score 0.93. Manual review corrected it while preserving that original evidence. Two agreeing frames can repeat the same mistake. Review-first operation is recommended until the exact physical display has been validated under representative conditions.

## Paired phone source

Select **Pair meter phone**, then privately open its generated link or enter the single-use code at `/demo/meter-camera/`. A code lasts five minutes; the resulting camera-only bearer credential lasts 24 hours. It is stored as a hash on the server and kept in the source browser's sessionStorage. Re-pairing or disabling the camera revokes the old source. Do not include codes/tokens in logs or public links.

Start the phone camera and keep the page foreground on a powered device with a stable view. It sends two actual sampled JPEG frames only for a current backend capture request. A timer polling for work does not decide that a reading happened: the backend persists the due time, revision and request expiry. Stopping/backgrounding the page stops camera capture and reports unavailable/stopped health. Sleeping, locking, browser throttling, loss of camera permission or network loss can cause gaps. No web page guarantees unattended hourly capture while a phone is locked.

For development, laptop `localhost` can use camera permission. A physical phone needs a reachable, trusted HTTPS backend/origin and matching `PUBLIC_APP_URL`, `FRONTEND_ORIGIN` or exact allowed phone origin configuration. `localhost` on a phone means that phone. A forwarded website link is an application origin, not a camera stream; it must still be reachable and authorised. No tunnel/public port is created automatically. Restart after origin changes. The same-origin deployment reuses the existing static `/demo/` hosting and image encoder; occupancy phone protocols remain separate.

A durable request expires within ten minutes (or the configured interval if shorter). On recovery, expired work becomes missed and the schedule advances from current time. It never uploads/replays an outage backlog as new hourly readings. Last accepted reading time, next capture, reported source health, OCR errors, missed captures and pending review count appear in the admin page. A healthy network heartbeat does not by itself prove the meter was read.

## Validation and consumption

Captured metadata retains capture/receipt times, camera/institution/epoch, configuration revision, raw recognised text for each frame, confidence, numeric candidate, image digests, validation and review history. Live provenance is operator-supplied, not physical attestation; all capture records remain physically `unverified`. Server demo mode forces simulated readings. No meter image is fed to occupancy inference or a switching policy.

Validation checks selected energy unit/register, ambiguity/multiple numbers, decimal format, two-frame agreement, OCR score, duplicate identifiers/image replay, accepted-neighbour monotonicity, elapsed time/supply bounds, possible factor-of-ten shifts, future/stale timestamps and epoch boundaries. Clock skew up to the existing five-minute future tolerance is allowed; older-than-ten-minute uploads are flagged for review/backfill. Review cannot accept a timestamp beyond the future tolerance or outside the recorded epoch. Reused capture IDs with changed evidence conflict; same capture retries return the original result. No suspicious candidate participates in anomalies before acceptance.

Only accepted cumulative readings produce intervals:

`interval kWh = later counter − earlier counter`

`elapsed-time average kW = interval kWh / elapsed hours`

Values are not summed as cumulative readings. Import keys ignore source type, so an equal OCR and CSV cumulative reading at the same meter/register/epoch/mode/time shares the existing reading. A conflicting value requires review; it never silently overwrites an import. Explicit CSV intervals take precedence over overlapping cumulative-derived intervals, preserving the existing conservative overlap rules. Readings from different epochs or live/simulated modes are never differenced together.

A missing hourly capture yields a labelled multi-hour `gap_aggregate`, not invented per-hour readings. Hourly cumulative data supports hourly energy and average power; it does not establish instantaneous kW or exact short-lived spikes. Cross-day gaps retain the existing analytics coverage exclusions.

## Reset, replacement and rollover

Use **Record meter reset, replacement or rollover**. Record the old/new epoch, effective local time, type, reason/evidence (including serial number/replacement details as appropriate) and rollover maximum for a rollover. The transition must follow the last accepted old reading. Old camera credentials are revoked and its pending requests cancelled. Register/re-pair a camera for the new epoch and establish a new baseline.

Old readings and OCR evidence remain. No energy is inferred across the discontinuity, including a rollover; consumption during that boundary is an explicit gap. CSV/manual readings outside a recorded epoch are held and cannot be reviewed into the wrong epoch. Transition records have pending/completed state because settings, audit and camera changes are separate MongoDB writes. An interrupted pending transition requires operator reconciliation; the app does not quietly claim completion or delete evidence.

## Image retention and security

Each image is limited to 256,000 bytes, at most two per capture, with bounded base64/JSON input and decoded dimensions/pixels. Each Python request has an execution timeout; the API allows at most two simultaneous OCR subprocesses per process. Only configured Python/module/model paths are used; clients cannot submit URLs, shell flags or arbitrary paths.

Keep at most the latest **12 image pairs per camera**, for at most **24 hours**. An institution-wide target of 192 pairs is also pruned; concurrent uploads can briefly exceed the site target until the next sweep. This is roughly 100 MB plus bounded concurrency overhead at maximum image size. Mongo TTL and worker cleanup remove expired image documents; preview requests enforce expiry even before deletion. Original OCR text/digests/configuration and review/audit metadata persist independently; correction never replaces them. Metadata/reading retention is an operator policy, not an automatic delete in this increment. Review promptly: an old capture's original image may no longer be available.

Images, raw OCR and camera configuration are administrator-only within their institution. Viewers retain existing accepted-energy access and gain no camera or control privileges. Meter pairing tokens cannot authenticate occupancy endpoints, other cameras/institutions, user APIs or command endpoints. Invalidation events contain metadata only; authenticated UI reads still perform ordinary authorisation.

## Demonstration and remaining physical checks

`/demo/virtual-meter/` renders a labelled synthetic cumulative display, with manual increments and PNG download. `fixtures/meter/synthetic-kwh.png` is a synthetic image, not a meter photograph. Photograph the virtual display through the paired source or upload its image to exercise real OCR on synthetic pixels. The displayed counter changing does not submit or accept a reading by itself.

Physical checks still required:

- Obtain authorisation to view the meter; identify its exact total imported-energy/OBIS register and displayed unit. Separate tariff/export/kW/voltage screens and cycling displays can be ambiguous even when OCR looks plausible.
- Position the camera square to the display, fixed and focused, with enough digit pixels. Avoid glare, reflections, shadows, motion blur, condensation and obstructed decimal points. Validate both day/night lighting and the least legible digits.
- Include the correct unit/register identifier in the crop. Check orientation and decimal interpretation against manually logged values. Seven-segment, inverted LCD, blinking/cycling displays and unusual fonts may need a different calibrated OCR model/adapter; none is promised here.
- Rehearse a full hour with genuine capture timestamps, camera/network loss, phone locking and source re-pairing. Compare accepted values/intervals with a human log and check supply bounds/reset history. A live camera/meter has not been commissioned by the software tests.

Verification commands: `npm run setup:ocr`, `node --test tests/meter-camera.test.js`, `npm run build`, `npm run test:meter-browser`, `npm test`. Optional real-image tests explicitly skip if the OCR dependency is absent; that is not OCR success. Executed results and any skips are recorded in HANDOFF/PROGRESS, not inferred from old counts.
