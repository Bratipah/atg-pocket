# ATG Pocket — Milestone Plan and Demo Proof

**Milestone plan and verification record** — M0 feasibility, M1 desktop foundation, and M2 QVAC local inference are complete. Target demo device: this Ubuntu desktop. Submission deadline: 30 October 2026, 17:00 EAT.

## Sequential checklist

- [x] **M0 — Repository discovery and feasibility:** inspect current directory, host tools/hardware, official QVAC/WDK documentation, package metadata and published WDK declarations; document risks and viable architecture.
- [x] **M0 addendum — Runtime feasibility:** verified Vulkan/GPU, QVAC online and offline inference, Electron utility-process hosting, and WDK Sepolia API/RPC read. See [`feasibility.md`](../architecture/feasibility.md) for limits and measurements.
- [x] **M1 — Desktop foundation and design system:** Electron + React + TypeScript shell, hardened renderer boundary and production build.
- [x] **M2 — QVAC local inference:** utility-process adapter, pinned Qwen model, advisory explanation UI, input/output validation, unit/security checks, real desktop inference, cached offline inference and failure handling. See record below.
- [ ] **Next milestone — Treasury domain and deterministic policy engine:** exact-money representation, domain types, deterministic policy rules and tests; requires explicit approval. Keep model authority out of policy decisions.
- [ ] **Later — Local persistence/audit, WDK, offline-to-online lifecycle, product readiness, security regression and submission pack:** each remains gated. No wallet, payment, signing or transaction workflow is implemented.

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
- [x] Hardened renderer/security controls were implemented and verified in M2.

M0 was a discovery/documentation milestone. Its pending application-security item was completed in M2; wallet funding, token selection, and transfer evidence remain pending and outside this milestone.

## M2 verification record (2026-10-28)

- Git was clean at `e266c71` before changes. Existing feasibility documents, model evidence, and smoke-workspace lockfiles were preserved.
- Model evidence: cached GGUF SHA-256 `33bcc57074ec7b6eada5a90651ee546ec0c2b271002c22baf9f1b2dd1e8f75cb`; exact file size 382,156,480 bytes. Model repository revision `50968a4468ef4233ed78cd7c3de230dd1d61a56b`; license Apache-2.0. QVAC `@qvac/sdk@0.22.0` declares Apache-2.0.
- Commands executed: `npm install --save-exact @qvac/sdk@0.22.0`; `npm install --package-lock-only`; `npm ci` (283 packages); `npm run typecheck`; `npm run build`; `node --test tests/*.test.mjs` (4 passed); `npm audit` (0 vulnerabilities); `npm audit --omit=dev` (0 vulnerabilities). A test overlapped the first clean install and briefly failed while npm had removed `node_modules`; serial verification passed.
- Actual desktop results: first application setup including model download was 116,312 ms; first online explanation latency 27.7 s. Cached app initialization with networking disabled was 9.0 s; two observed cached offline explanations took 22.0 s and 29.1 s. Responses were generated by QVAC through the renderer and displayed as plain text.
- Reproduction: initialize once online, then verify `~/.config/atg-pocket/qvac/cache/5b8aae816570a09d_Qwen3-0.6B-Q4_0.gguf` against the SHA-256 above. Run `unshare --user --map-current-user --net sh -c 'if curl -m 3 -fsS https://huggingface.co >/dev/null 2>&1; then echo NETWORK_AVAILABLE; exit 1; else echo NETWORK_DISABLED; fi; node tools/verification/electron-qvac-check.mjs offline-success'`. This starts the actual Electron app and drives its UI using Chromium's local debugging pipe, without a TCP debug port. It checks readiness and prints the generated response and timings. The helper requires installed app dependencies and a graphical Electron session.
- Missing-model test: with external network disabled and the app cache model temporarily moved out of the way, the UI reported “Model could not be initialized. Check connectivity or available disk space, then retry.” after the 180-second request timeout; the app did not crash. The artifact was restored and its checksum reverified. Main now terminates a failed worker, allowing initialization to be retried with a fresh process.
- Security regression tests (4): malformed and oversized input, wrong request shape, malformed/oversized output, `<think>` removal, hardened BrowserWindow settings, CSP, sender-frame/origin validation, and narrow preload API. Live desktop checks exercised initialization and explanation IPC. No raw IPC, filesystem, shell, wallet, secret, signing, or transaction methods are renderer-accessible.
- Memory/performance: observed QVAC Bare-worker RSS was about 429 MiB during cached initialization and 447 MiB during inference. Electron main process was observed around 216 MiB; total process-tree and GPU memory were not independently measured. The model download is about 382 MB. On this two-core target, response generation takes tens of seconds. Output quality is inconsistent and included incorrect arithmetic in one run, so AI remains advisory only.
- Dependency audit: the application pins `@qvac/sdk@0.22.0` and overrides its exact transitive `zod@4.6.5` pin to patched `4.6.6`; application audit reports zero findings. The unchanged smoke workspace still has three high audit entries stemming from one advisory, GHSA-mrhx-c7xc-m3w5 (`zod <4.6.6`) through `@qvac/inference@0.22.0` and `@qvac/sdk@0.22.0`. npm suggests downgrading the SDK to 0.21.1 as a semver-major fix; that change was not made. The app override was validated by real inference.
- Limitations: first setup needs network, disk space, and about two minutes on this host; failure to obtain a model can take 180 seconds to surface; offline inference is slow and model numerical reasoning is unreliable. Packaged installers and alternate operating systems were not tested. No persistence, deterministic policy engine, wallet, WDK, signing, or transaction workflow was implemented. Stop at M2 pending explicit approval for the next milestone.
