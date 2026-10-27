# ATG Pocket — Initial Architecture Proposal

**Milestone:** 0 architecture proposal, updated with Milestones 1 and 2 implementation findings
**Decision date:** 2026-10-28

## Proposed minimum viable shape

Use a local Electron desktop application with a React + TypeScript renderer, a narrowly scoped Electron main process, a QVAC utility process, and a privileged wallet service. The feasibility addendum proved QVAC inference inside Electron `utilityProcess`; keep heavy inference out of main. The renderer is an untrusted presentation layer and never receives a wallet seed/private key or direct access to Node APIs. Do not add a server, remote AI, analytics, or cloud database.

```text
React renderer (dashboard / forms / status)
        │ typed, allowlisted IPC
Electron main process (sender validation + typed service routing)
  ├── Treasury domain + deterministic policy engine
  ├── QVAC utility process (@qvac/sdk; Bare worker)
  ├── Privileged wallet service (WDK; explicit approved proposal only)
  ├── Local persistence (versioned SQLite or IndexedDB decision pending)
  └── Audit/state transition service
```

### Why this is the smallest plausible runtime

- QVAC's documented JS/TS SDK targets Node.js and runs its work in a Bare worker. An actual local inference run in Electron 45.1.0 `utilityProcess` succeeded without `--no-sandbox`. WDK documents Node.js/Bare support; the installed EVM package supports Sepolia and its typed API was inspected and smoke-initialized.
- A plain PWA would simplify UI deployment but does not itself provide a verified QVAC runtime, and placing wallet seed material in browser JavaScript/storage is an unacceptable boundary for this product.
- Electron permits a familiar responsive React interface while isolating model work and keeping signing behind a privileged boundary. QVAC utility-process feasibility is proven on this host; hardened renderer settings, WDK signing/transfer and packaged-build behavior remain unproven.

## Component boundaries

- `domain/money`: integer minor units / explicit token base units; no binary floats for authoritative calculations.
- `domain/treasury`: budgets, expenses, suppliers, policies and proposal state transitions. No UI, QVAC, or WDK imports.
- `policy`: deterministic, versioned decision with machine-readable reasons. A policy pass is not wallet authorization or network verification.
- `src/electron/qvac-worker.ts`: QVAC adapter in Electron `utilityProcess`, with a typed initialization/explanation protocol, one active operation, constrained prompt, bounded text output, and a model cached in Electron user data. QVAC does not access treasury policy or wallets.
- `services/wallet`: narrow `WalletService` using verified WDK EVM methods. Separate online verification, user confirmation, signing, broadcast and receipt confirmation. No automatic execution from model output or policy result.
- `services/persistence`: local, schema-versioned repository. Candidate is SQLite via Electron main process for one desktop host; IndexedDB is an alternative if platform/packaging favors it. Select only after a short persistence feasibility check in Milestone 1. Treat records as untrusted; do not claim encryption at rest.
- `services/audit`: append-only application-level events, explicitly not cryptographically tamper-proof.

## Initial integration choices (provisional)

| Concern | Proposal | Verification still required |
|---|---|---|
| QVAC package | Application pins `@qvac/sdk@0.22.0` | Product adapter, constrained output handling, offline UI, and renderer checks are implemented and verified; packaged installer behavior remains untested |
| Model | QVAC catalog `QWEN3_600M_INST_Q4` (382 MB, Apache-2.0 pinned artifact) | Checksum, revision, and license verified; inference works but answer quality and arithmetic reliability are weak |
| Wallet packages | Feasibility harness uses `@tetherto/wdk@1.0.0-beta.22`, `@tetherto/wdk-wallet-evm@1.0.0-beta.24` | Typings, initialization and Sepolia RPC read passed; real Sepolia transfer, token address/faucet and independently verified receipt remain untested |
| First test network | Ethereum Sepolia | Confirm RPC reliability and demo-specific test ETH / mock USD₮ source |
| Reporting currency | KES, stored as integer cents | Do not convert KES to token without a live, sourced, fresh rate and explicit user review; conversion may be deferred in the MVP |
| Test token | Mock/test USD₮ only if faucet and contract are confirmed | Clearly distinguish from Tether-issued mainnet USD₮; testnet token identity and decimals must be documented |
| Model cache | QVAC cache in user data directory; same configured cache for download and offline reload | Verify lifecycle and disk footprint on the demo host; provide visible model state and recovery guidance |

## Typed renderer interface

Expose one method per allowed operation through preload/contextBridge; never expose raw `ipcRenderer` or general-purpose `send/invoke`. All arguments and results are runtime-schema validated in the privileged process. Validate sender frame origin `app://atg`, expected `webContents` id and main-frame status on every call.

```ts
interface AtgApi {
  getShellStatus(): Promise<ShellStatus>
  getAiStatus(): Promise<AiStatus>
  initializeAi(): Promise<AiStatus>
  explainTreasury(input: { context: string }): Promise<{ answer: string; latencyMs: number }>
}
```

This is the current Milestone 2 surface. Proposal creation, policy evaluation, wallet actions, and transaction methods remain deferred and are not exposed.

No renderer method accepts a filesystem path, command, raw transaction, arbitrary signer request, or generic IPC channel. QVAC has no wallet tools. `executeApprovedProposal` resolves only a stored proposal which has passed deterministic policy and fresh online checks, with an explicit confirmation bound to that proposal.

## Security and offline behavior

- Default-deny network execution. Offline users can inspect local records, ask questions based on validated local data, create/evaluate proposals, and view audit records.
- Offline proposal creation is not payment execution. Online execution requires fresh chain/network and balance checks, explicit transaction review and human authorization, then WDK action and network evidence.
- Keep signing keys only in a dedicated test wallet's process memory or an approved OS secure store if later verified. Never commit secrets, log keys/seed phrases, or put them in renderer state or persisted business records.
- Show connection state, last-verified timestamps, QVAC state, wallet/network state and exact proposal/transaction state. A cached balance is always marked stale/offline.
- Packaged Electron renderer security remains an architecture gate. QVAC utility-process inference worked without `--no-sandbox`; do not add that switch based on the upstream tutorial.
- Create the renderer with `{ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }`; serve only bundled `app://atg/` content. Set a restrictive CSP (`default-src 'none'`, local scripts/styles/assets only, `connect-src 'none'`), deny navigation and new windows, disable `<webview>`, and validate every sender. Electron official security guidance specifically calls for these controls.
- QVAC utility process uses a narrow, validated request/response protocol. WDK lives in a privileged wallet service. Use a dedicated test wallet and keep secret material only in that process’s memory or a reviewed OS keyring; do not select or claim a keyring until its implementation is verified. Never return secrets to renderer or logs.
- Cached inference has been observed in the actual Electron application with external networking disabled. No wallet, signing, or broadcast path exists in this milestone.

## Milestone 2 implementation record (2026-10-28)

- The renderer keeps context isolation, disabled Node integration, sandbox, web security, restrictive CSP, local-only protocol, denied navigation/new windows, and sender/main-frame/origin checks. Preload exposes only status, explicit model initialization, and one explanation request. No generic IPC, paths, shell, secrets, signing, or arbitrary model operations are exposed.
- The model runs in `utilityProcess` and QVAC's Bare worker. The app pins `@qvac/sdk@0.22.0`, catalog model `QWEN3_600M_INST_Q4`, Qwen3 600M Q4_0. The preserved feasibility GGUF was checksum-verified as `33bcc57074ec7b6eada5a90651ee546ec0c2b271002c22baf9f1b2dd1e8f75cb`, size 382,156,480 bytes. It corresponds to `unsloth/Qwen3-0.6B-GGUF` revision `50968a4468ef4233ed78cd7c3de230dd1d61a56b`, Apache-2.0. The application cache is under Electron user data, separate from the preserved smoke cache.
- Main validates exact input shape and 8–1,600 character length, permits one explanation at a time, limits returned output to 1,800 characters, strips `<think>` blocks, and reports safe errors. The renderer displays model output as React text, never HTML. Generated content remains untrusted advisory text.
- Measured on the target Ubuntu desktop: first application setup including model download and initialization, 116.3 s; cached initialization with external networking disabled, 9.0 s; online UI inference, 27.7 s; cached offline UI inference, 22.0 s. These are single-run measurements, not performance guarantees. Observed QVAC Bare-worker RSS was about 429 MiB during offline setup and 447 MiB during inference; total GPU/process-tree memory was not independently measured. First setup downloaded the 382 MB artifact and requires network access and disk space.
- The app dependency tree overrides QVAC's exact transitive `zod@4.6.5` pin with patched `4.6.6`. Root `npm audit` reports zero vulnerabilities. The separate smoke workspace remains unchanged with three high findings; npm's suggested SDK downgrade to 0.21.1 is a semver-major change. The app override was exercised by real inference.
- Actual desktop offline inference and missing-model failure were verified. Missing-model initialization returned a failure after the 180-second request timeout without crashing the app. The cache was restored and its pinned checksum rechecked. The failed worker is terminated to allow retry.

## Deliberately deferred

No application shell, design system, persistence implementation, financial domain code, tests, wallet code, or model integration is part of Milestone 0. Those begin only after this plan is approved. The interface and database technology can be refined during Milestone 1 without changing the core integration boundaries.
