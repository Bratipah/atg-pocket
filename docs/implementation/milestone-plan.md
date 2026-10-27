# ATG Pocket — Milestone Plan and Demo Proof

**Milestone 0 planning artifact** — no later milestone has started. Target demo device: this Ubuntu desktop. Submission deadline: 30 October 2026, 17:00 EAT. The focused M0 addendum was completed 28 October.

## Sequential checklist

- [x] **M0 — Repository discovery and feasibility:** inspect current directory, host tools/hardware, official QVAC/WDK documentation, package metadata and published WDK declarations; document risks and viable architecture.
- [x] **M0 addendum — Runtime feasibility:** verified Vulkan/GPU, QVAC online and offline inference, Electron utility-process hosting, and WDK Sepolia API/RPC read. See [`feasibility.md`](../architecture/feasibility.md) for limits and measurements.
- [ ] **M1 — Foundation and design system:** after explicit approval, initialize the selected shell, strict TypeScript/build/lint/test configuration, accessible navigation/status shell and design tokens. No financial workflow yet.
- [ ] **M2 — Treasury domain and policy engine:** exact-money representation, domain types, deterministic policy rules and unit tests; no model authority.
- [ ] **M3 — QVAC product integration:** feasibility proof is complete on the intended host, but app adapter, output handling, offline UI, packaged build and product-level verification remain.
- [ ] **M4 — Local persistence and audit:** choose and implement versioned local storage; validate input/recovery behavior and document limits.
- [ ] **M5 — Treasury Copilot:** connect the actual QVAC adapter to local validated context, schema-validate outputs, and test at least three real inference workflows plus deterministic mock tests.
- [ ] **M6 — WDK wallet integration:** API/package and Sepolia read proof complete. Still requires a dedicated test wallet, Sepolia gas, identified test asset/faucet, explicit user action, actual WDK send and independent receipt verification. No mainnet.
- [ ] **M7 — Offline-to-online lifecycle:** formal state machine, stale data handling, revalidation and duplicate prevention; never auto-broadcast after reconnect.
- [ ] **M8 — Product interface and demo readiness:** complete only screens supported by working flows; accessibility, responsive layout and honest status states.
- [ ] **M9 — Security/reliability regression:** offline tests, policy boundaries, malformed AI, stale network state, secret scan, clean setup and documented limitations.
- [ ] **M10 — Submission pack:** reproducible synthetic data, exact hardware/model/package/license records, live demo recording with network visibly disabled, current submission checklist. Submission requires separate explicit user authorization.

Each milestone must be implemented, verified, reviewed and documented before the next begins. Stop for explicit user approval at each gate. Prioritize M3 and M6 proofs early within their own approved gates because beautiful screens cannot substitute for actual local inference or an actual WDK test transaction.

## Offline demonstration plan

### Preparation while online (before recording)

1. On the actual demo machine, install the selected pinned application build and QVAC model. Record model artifact, license, package version, cache location, total download size and checksums reported by the catalog.
2. Run the app once online to finish QVAC model loading and verify its cache. Create/load only synthetic treasury records (weekly procurement budget, existing expenses, allowed recipient, policy limits). Do not place real customer data or production wallet secrets in the dataset.
3. Verify the dedicated Sepolia test wallet on the chosen chain. If the wallet journey is part of the recording, obtain test gas and the documented mock/test USD₮ from an identified faucet, record token contract/decimals and ensure a small-value recipient wallet is controlled by the demo operator.
4. Capture a successful online transaction separately before the offline segment if network instability could jeopardize the demonstration. Never edit a prepared/broadcast result to appear confirmed; label the transaction's actual state and provide explorer evidence.

### Offline proof (must be observed live)

1. Disconnect Wi-Fi/Ethernet and visibly confirm network unavailability at OS level. Keep the QVAC model cached and loaded; show the in-app QVAC-ready and offline indicators.
2. Ask: “Can I spend KES 8,000 on stock today without exceeding my weekly procurement budget?” Demonstrate actual QVAC inference (show running/completed state, not canned text), while the app supplies only validated local budget and expense context.
3. Show arithmetic/policy result from deterministic code, including an over-limit case that is rejected even if model text suggests otherwise.
4. Save a proposal locally and restart/reload the app while still offline. Show that the proposal and audit event persist and that the payment remains a proposal, not broadcast or settled.
5. Show that balance/network state is unavailable or stale; no fake rate or current balance appears. Do not attempt execution while offline.

### Reconnection proof

1. Restore network. Revalidate chain, current balance and proposal eligibility; request explicit review/authorization.
2. Execute only the selected, approved Sepolia test asset transfer through the documented WDK adapter.
3. Show the returned transaction hash as broadcast/pending, then independently check the relevant Sepolia explorer/provider evidence before showing confirmed.
4. Demonstrate a rejected/expired/duplicate proposal path if time allows. Clearly label testnet/mock USD₮ and show the explorer link.

## M0 verification record

- Commands: `pwd`, `git status --short --branch`, `git log -5 --oneline`, `rg --files`, `uname -a`, `/etc/os-release`, `node --version`, `npm --version`, `git --version`, `lscpu`, `free -h`, `df -h .`, `lsusb`, `command -v vulkaninfo`, `vulkaninfo --summary`, `ldconfig -p`, `lspci`, `npm view` for current package metadata, `npm pack` for published declaration inspection.
- Initial result: directory is empty and not a Git repository; no app tests/build exist. Host information and package metadata were collected. This initial snapshot preceded the approved focused addendum.
- Official documentation was consulted; sources and version-skew caveat are listed in [`feasibility.md`](../architecture/feasibility.md).

## M0 acceptance

- [x] Existing repository/work inspected; empty/non-Git status recorded.
- [x] Available local tools, OS, host CPU/RAM/disk/GPU identified.
- [x] Official QVAC runtime, model lifecycle, offline preparation and supported requirements documented.
- [x] Official WDK EVM capabilities, Sepolia pathway and current package typings/version skew documented.
- [x] Feasible minimal architecture and implementation risks recorded.
- [x] Offline demo procedure and sequential milestone checklist provided.
- [x] Vulkan runtime/GPU driver checked using locally unpacked `vulkan-tools`; system package installation requires local sudo authentication.
- [x] QVAC model metadata/license checked; actual local online, offline and Electron utility-process inference observed.
- [x] WDK wallet API/package and Sepolia RPC read smoke completed; no transfer attempted.
- [x] Intended target device and hackathon deadline confirmed.
- [ ] Live Sepolia transfer independently verified; dedicated funded test wallet and identified test token/faucet are still required.
- [ ] Hardened renderer/security controls implemented and verified; this is application work and remains pending.

M0 is a discovery/documentation milestone, not proof that the application integrations already work. No M1+ work may start until the user reviews and explicitly approves the next milestone.
