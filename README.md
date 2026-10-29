# ATG Pocket

ATG Pocket is an offline-first treasury oversight concept for small businesses. This repository contains Milestones 1–4 plus a narrowly scoped **Milestone 5A Sepolia native ETH test workflow**. The app can create or restore a dedicated Sepolia wallet, store its recovery seed only as Electron `safeStorage` ciphertext using GNOME Keyring, evaluate a separate exact-wei policy, require approval and a separate OS confirmation, sign/broadcast through WDK, and independently query a second Sepolia RPC for receipt status. A real transfer has not yet been completed or verified; the wallet must be backed up and funded with test ETH first. KES examples remain synthetic and are never used for crypto decisions. Local AI provides advisory explanations only and has no role in policy decisions.

## Requirements

- Ubuntu desktop with a graphical session
- Node.js 22.17+ and npm 10.9+

## Setup and run

```bash
npm ci
npm run dev:electron
```

`dev:electron` compiles the Electron TypeScript files, builds the React renderer, and opens the desktop window. To work on the renderer with Vite's browser preview, use `npm run dev`; the preview does not include Electron's preload bridge.

## Verify and build

```bash
npm run typecheck
npm run build
npm start
```

`npm start` opens the last production build. `npm test` runs input/output and Electron boundary tests after building. The separate feasibility scripts under `tools/feasibility/` remain preserved evidence and are not application runtime dependencies.

## Structure

- `src/electron/main.ts` — window lifecycle, local `app://atg` asset protocol, CSP, sender validation, allowlisted IPC, treasury evaluation/persistence entry point, and QVAC utility-process lifecycle.
- `src/electron/treasury-store.ts` — versioned user-data JSON snapshot, atomic replacement, record validation, and SHA-256 append-only audit chain.
- `src/electron/treasury-domain.ts` — currency metadata, exact integer minor-unit parsing, policy validation, and pure fail-closed policy evaluation. It imports no QVAC or Electron code.
- `src/electron/sepolia-domain.ts` — separate versioned test-only Sepolia native ETH policy, exact wei conversions, and EVM recipient validation.
- `src/electron/sepolia-wallet.ts` — trusted main-process WDK wallet service, OS-encrypted seed vault, fee quote, explicit signing/broadcast, and independent Sepolia RPC receipt lookup.
- `src/electron/transfer-store.ts` — atomic lifecycle snapshot and hash-chained public transaction audit events; interrupted submissions recover as unknown.
- `src/electron/qvac-worker.ts` — isolated QVAC model initialization and constrained text completion.
- `src/electron/preload.cts` — narrow typed app methods for AI, synthetic policy and the bounded Sepolia wallet workflow; no Node, raw IPC, filesystem, signing primitive or raw WDK object.
- `src/electron/wallet-backup-preload.cts` and `wallet-backup.html` — separate restricted one-purpose phrase backup/recovery window; phrase IPC is unavailable in the main renderer.
- `src/renderer/` — React interface and local design system; policy input is sent to main and the renderer cannot submit a policy or decision. Saved local records are labeled separately from synthetic dashboard examples.
- `tools/feasibility/` — isolated, preserved QVAC and WDK smoke evidence; neither is imported by the application.

## Trust boundaries and planned integrations

The renderer is an untrusted presentation process with context isolation, sandboxing, Node integration disabled, and a restrictive policy that denies network connections. Main-process IPC validates the calling window, exact local app origin, and main frame. Navigation and new windows are denied. Only local model status, explicit initialization, and one bounded explanation request are exposed.

Future QVAC inference belongs in the isolated Electron utility-process architecture already exercised by the QVAC feasibility harness, with a narrow validated request/response protocol. WDK and any secret handling must remain in a privileged service boundary; seed material, keys, signing methods, and raw transaction authority must never enter renderer state or preload. No secret storage or signing implementation has been selected or built. A later milestone must verify packaged behavior and the host's secure storage option before wallet onboarding.

The renderer cannot reach the network. Sepolia network requests run in the trusted main process. Demo treasury values and the sample treasury context are synthetic and are not wallet balances. AI-generated explanations are untrusted advisory text and do not authorize payments, enforce limits, change budgets, or make binding financial decisions.

## Milestone 5A — Sepolia native ETH test workflow

- Only Ethereum Sepolia chain ID `11155111` and native test ETH are supported. Test ETH is not represented as having monetary value. No mainnet, ERC-20, swaps, or bridges are supported.
- Pinned runtime packages are `@tetherto/wdk@1.0.0-beta.22` and `@tetherto/wdk-wallet-evm@1.0.0-beta.24`; `@tetherto/wdk-wallet@1.0.0-beta.21` is overridden explicitly to keep the two packages' shared class declarations compatible. Native ETH uses the verified account APIs `getAccount`, `getAddress`, `getBalance`, `quoteSendTransaction`, `signTransaction`, `sendTransaction`, and `dispose`. The token-only `transfer` method is not used. Fee construction uses ethers `JsonRpcProvider.estimateGas`, `getFeeData`, and `getTransactionCount`.
- Policy `sepolia-native-eth-test-v1`: max transfer `0.001 ETH` (10^15 wei); human approval at or above `0.0005 ETH` (5×10^14 wei); fee ceiling `0.0001 ETH` (10^14 wei). Amounts and fees use `bigint` wei. Fee estimates must be available and within ceiling; available balance must cover amount plus fee. Policy order is missing/invalid input or policy, wrong chain/asset, unavailable fee, fee ceiling, hard amount limit, approval threshold, then allow.
- Setup generates a 12-word WDK phrase only after GNOME Keyring and async `safeStorage` availability are confirmed. A separate modal window with its own narrow preload displays the phrase once. The encrypted vault is atomically persisted with mode 0600 only after explicit backup confirmation. Restore uses the same dedicated window and only persists the OS-encrypted phrase after validation and user confirmation. Main renderer never receives phrase/private key or signing payload. Losing both device and phrase means losing access; no remote recovery exists.
- A proposal is quoted and audited before approval. `require_approval` needs a distinct approval action; every eligible proposal then requires a second OS confirmation that displays network, recipient, amount, fee and total. Critical inputs, chain, balance, fee and policy are checked again immediately before WDK signs. Signed data remains in main-process memory and is not logged or audited.
- Lifecycle: proposed, awaiting approval, ready to confirm, signing, signed, broadcast, confirmed, failed, unknown, cancelled, rejected. A lost/ambiguous broadcast response is never retried automatically. After restart, unconfirmed quotes expire; interrupted signing/broadcast states become unknown. Broadcast is not confirmation. Receipt verification queries a second endpoint (`https://public.1rpc.io/sepolia`) and checks chain, transaction hash, successful receipt, native transfer shape, recipient and exact value before recording confirmed.
- Public Sepolia RPCs and GNOME Keyring are host dependencies. Local hash chaining is tamper-evident only while the retained chain is trusted; it is not a remote audit anchor. The decrypted seed exists transiently in main process memory to initialize WDK, and JavaScript strings cannot be reliably zeroed. Packaged installer behavior and real transfer proof remain outstanding.

Milestone 3 adds a KES example policy (KES 20,000 per-transaction hard limit; KES 60,000 example-week cap; KES 10,000 approval threshold) and synthetic prior spending of KES 24,000. KES is the reporting and policy currency for this scenario; this does not represent KES settlement or payment support. Incompatible policy currencies fail closed; there is no currency conversion. Amounts use integer minor units and reject excess decimal precision without rounding. Prior spending remains a fixture, not transaction history.

## Milestone 4 local records and audit

- Proposals are stored at `app.getPath('userData')/treasury-v1.json`; the renderer cannot provide this path. Only Electron main accesses the file. One Electron app instance is allowed, and in-process operations are serialized.
- The JSON envelope has `schemaVersion: 1`, `proposals`, and `events`. Proposal schema 1 records a UUID, UTC timestamps, user-created classification, currency and integer minor units, plus policy ID/version, policy limits/cap/threshold, synthetic prior spending, decision, reason codes, and event IDs. Exact keys are validated; incompatible, malformed, or audit-invalid files fail closed and are left untouched.
- Each create/evaluate operation writes the proposal and corresponding event together in one snapshot. Main writes a unique mode-0600 temporary file, flushes it, atomically renames it over the snapshot, and flushes the containing directory. A failure before rename leaves the prior snapshot in place. Stale temporary files are ignored. No automatic repair or destructive reset is performed.
- Event hashes are SHA-256 over UTF-8 canonical JSON of all event fields except `hash`, with recursively sorted object keys, preserved array order, compact JSON separators, and `previousHash` included. The first event points to 64 zeroes. Verification reports the first malformed event, broken link, or hash mismatch.
- Hash chaining detects accidental edits and partial/reordered history when checked against the retained chain. It does not stop a machine owner or malicious local process from rewriting the whole file and recomputing hashes; there is no remote anchor, hardware key, encryption-at-rest claim, or independent proof. A valid audit status does not prove approval or a transaction.
- User-created proposal records are distinct from synthetic dashboard examples and synthetic policy/prior-spending inputs. Audit details exclude free text and secrets. No wallet secrets are accepted or stored.
- Backups are the user's responsibility. Deleting the user-data file removes local proposal and audit history; there is no recovery service. Schema migration is not implemented: unsupported versions are preserved and reported as incompatible. If directory fsync fails after rename, the complete snapshot may already be visible but durability is uncertain; the UI asks the user to reload before retrying.
- `npm test` includes restart, concurrent-write, failed-write, tamper, malformed-record, IPC-shape, and sensitive-payload tests using temporary storage.

## Dependency note

The application pins `@qvac/sdk@0.22.0` and overrides its transitive `zod@4.6.5` pin to patched `4.6.6` (`GHSA-mrhx-c7xc-m3w5`). The app dependency tree reports zero audit findings. The preserved QVAC smoke workspace remains unchanged and reports three high-severity entries through `@qvac/sdk@0.22.0`, `@qvac/inference@0.22.0`, and `zod@4.6.5`. npm suggests SDK 0.21.1, a semver-major change, and that downgrade was not applied.
