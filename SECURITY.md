# Security and safety

**Status:** requirements only. No code exists yet, so none of these controls are implemented or verified. Derived from [PLAN.md](PLAN.md) §3.2, §11, §15.3 and §17, which remain authoritative.

This system can eventually switch mains supply to a room and processes camera footage of people, so security covers three areas: application security, privacy, and physical safety.

## Application security

- HTTPS for any network-accessible installation; secure, HttpOnly session cookies.
- Validate browser mutation origins and apply CSRF protection, since authentication is cookie-based.
- Restrict CORS to the actual frontend origin when cross-origin development is needed.
- Enforce role and room scope on the server for every mutation and every Socket.IO subscription. Hiding a button is not access control.
- Rate-limit login, QR lease creation and supply commands.
- Hash passwords with bcrypt.
- Validate uploaded file types, sizes and parsing limits.
- Do not accept arbitrary remote URLs through public endpoints; prevent requests to unintended internal services. Camera sources are configured by an administrator only.
- Integration services (camera, meter, device) use separate scoped credentials with replay protection and timestamp validation, and may submit only their own telemetry.
- Record actor, action, target and time in audit events, with secrets redacted.

## Secrets

- Never commit real secrets. Environment samples contain placeholders only.
- Never place SMTP, meter, camera, broker or controller credentials in `VITE_` variables or browser JavaScript.
- Store integration secrets encrypted or by reference; camera and controller secrets belong in protected server-side configuration.
- Redact RTSP passwords and tokens from logs and exports.
- Configuration is validated at startup. Production must reject placeholder secrets and must reject physical-control enablement without its required configuration.
- A blank optional credential disables that adapter cleanly.

## Roles

| Role | Access |
| --- | --- |
| Administrator | Configuration, users, policies, integrations, imports, enabling approved control |
| HOD or second responder | Assigned department incidents and recommendations |
| First responder (lab assistant, technician) | Assigned incidents, actions and evidence |
| Teacher or authorised staff | Room access requests, permitted extensions and overrides for assigned rooms |
| Student or general viewer | Permitted information and approval requests; no power control by default |
| Integration service | Its own telemetry only |

## QR access

- The printed QR holds an opaque room-access URL, never a control password or device address.
- Opening the URL must not switch power. A lease is created only after sign-in and server-side checks of role, room, hours, booking conflicts, duration and lockouts.
- A static QR can be photographed and shared. Authentication is not proof that the user is in the room, and lease expiry is not proof that the room is empty.

## Privacy

- Use only footage the institution has authorised.
- No facial recognition, identity recognition or attendance monitoring.
- Process footage locally where possible and keep only minimal occupancy metadata. Avoid storing identifiable video.
- Restrict access to any stored evidence images and apply a short, configurable retention period.
- Check model licensing and footage-use requirements before distribution.
- Demo data uses test users; do not seed real staff contact details.

## Simulation isolation

- `DEMO_MODE` and `ALLOW_PHYSICAL_CONTROL` are enforced on the server and gateway. The planned defaults are `DEMO_MODE=true` and `ALLOW_PHYSICAL_CONTROL=false`.
- In demonstration mode a real switching adapter cannot be instantiated.
- Accelerated time, replayed clips and fixture observations can never authorise a physical action.
- Every simulated command, reading and chart keeps its `dataMode` through the whole pipeline. A simulated OFF is never shown as a verified shutdown.
- Use separate demo MQTT topics or a separate broker where needed.

## Physical control safety

- Every room starts in alert-only mode. Automatic control requires explicit enablement and a tested adapter.
- The only actuator is one master breaker per controlled room, operated with explicit ON and OFF commands. Commands have short expiries and are never replayed after a reconnection.
- Unknown occupancy blocks automatic shutdown; positive occupancy cancels it.
- Any downstream load not approved for shared cutoff blocks the whole room cutoff.
- Cameras, sensors, network equipment and emergency or essential circuits stay outside the routine cutoff.
- A fault-tripped, maintenance-locked or manually isolated supply is never restored automatically.
- An unexplained building-level spike never triggers a room shutdown.
- A consumption anomaly is a review signal, not an electrical protection mechanism.
- Physical installation is outside the prototype. It requires a qualified electrician to design the room feeder, preserve downstream protection, select the breaker for the actual load and commission the system, with a local override available.

The complete eligibility list for an automatic OFF is in PLAN.md §15.3.

## Deployment

- Run the full stack locally for the hackathon.
- If the dashboard is hosted remotely, the local gateway connects outbound with authentication. Never expose raw CCTV ports or device control to the internet.
- Keep the worker on a continuously running host; a sleeping worker breaks escalation.

## Reporting a vulnerability

No reporting channel has been set up yet. Until one is, report security or safety concerns privately to the repository maintainers rather than in a public issue.
