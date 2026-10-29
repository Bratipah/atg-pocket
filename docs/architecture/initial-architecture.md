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
  ├── Local persistence (versioned JSON snapshot under Electron user data)
  └── SHA-256 hash-chained audit event service
```

### Why this is the smallest plausible runtime

- QVAC's documented JS/TS SDK targets Node.js and runs its work in a Bare worker. An actual local inference run in Electron 45.1.0 `utilityProcess` succeeded without `--no-sandbox`. WDK documents Node.js/Bare support; the installed EVM package supports Sepolia and its typed API was inspected and smoke-initialized.
- A plain PWA would simplify UI deployment but does not itself provide a verified QVAC runtime, and placing wallet seed material in browser JavaScript/storage is an unacceptable boundary for this product.
- Electron permits a familiar responsive React interface while isolating model work and keeping signing behind a privileged boundary. QVAC utility-process feasibility is proven on this host; hardened renderer settings, WDK signing/transfer and packaged-build behavior remain unproven.

## Component boundaries

- `src/electron/treasury-domain.ts`: implemented pure domain boundary for currency metadata, exact integer minor-unit amounts, policy validation, and deterministic decisions. No UI, QVAC, Electron, persistence, or WDK imports.
- `policy`: version-1 policy supports a per-transaction hard limit, period cap, supplied prior-spending total, and approval threshold. A policy pass is not wallet authorization or network verification.
- `src/electron/qvac-worker.ts`: QVAC adapter in Electron `utilityProcess`, with a typed initialization/explanation protocol, one active operation, constrained prompt, bounded text output, and a model cached in Electron user data. QVAC does not access treasury policy or wallets.
- `services/wallet`: narrow `WalletService` using verified WDK EVM methods. Separate online verification, user confirmation, signing, broadcast and receipt confirmation. No automatic execution from model output or policy result.
- `src/electron/treasury-store.ts`: versioned local repository in Electron main. JSON snapshot uses serialized operations and fsync + atomic rename; malformed/incompatible data fails closed. Treat records as untrusted; no encryption-at-rest claim.
- Audit events are appended within the same atomic snapshot as the proposal/evaluation. Canonical JSON and SHA-256 chaining detect local edits or broken links, but do not prevent full-history rewriting by a machine owner.

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

The Milestone 3 surface additionally exposes `evaluateProposal({ amount, currency })`. The privileged process validates the request and attaches a fixed synthetic example policy and explicitly supplied synthetic prior spending; renderer input cannot choose the policy, decision, or reason codes. No wallet action or transaction method is exposed.

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

## Milestone 3 deterministic treasury domain (2026-10-28)

- `Money` is a supported ISO-like currency code plus non-negative safe integer minor units. Currency metadata explicitly declares decimal exponent: KES 2, USD 2, JPY 0. Decimal strings are parsed digit-by-digit into integer units; excess precision is rejected, never rounded. Unsafe integers, negative values, malformed strings and unsupported currencies are rejected. Comparisons require matching currencies.
- The policy is version 1 with a KES 20,000 per-transaction hard limit, KES 60,000 synthetic example-week budget, KES 10,000 approval threshold, and supplied KES 24,000 synthetic prior spending. These values are demonstration fixtures only. There are no stored records or historical data and no claim that this is actual spending.
- Precedence: missing policy → deny; malformed/unsupported policy → deny; invalid proposal → deny; currency mismatch or invalid/missing prior total → deny; per-transaction hard limit violation → deny; period cap violation → deny; threshold met → require human approval; otherwise allow. Hard violations cannot be upgraded by approval rules. Zero is allowed if it adds no spending and all supplied policy inputs are valid. Exact cap exhaustion is allowed; overspending is denied.
- Stable reason codes: `POLICY_MISSING`, `POLICY_INVALID`, `TRANSACTION_INVALID`, `CURRENCY_MISMATCH`, `PRIOR_SPENDING_INVALID`, `HARD_TRANSACTION_LIMIT_EXCEEDED`, `PERIOD_BUDGET_EXCEEDED`, `APPROVAL_THRESHOLD_REACHED`, `WITHIN_POLICY_LIMITS`.
- The deterministic outcome and human explanation come from pure domain code in the Electron service boundary. QVAC is neither imported nor invoked. AI may later paraphrase an already computed result, but its output cannot affect the policy, amounts, result or reason codes.
- The renderer can send only the proposed amount and currency. Main validates and applies the fixed demo fixture; it never accepts a renderer-selected result or arbitrary policy. The UI labels the scenario synthetic and says explicitly that evaluation is not payment, signing, broadcasting or settlement. KES is a reporting/policy unit here, not a claim of KES payment support. Other supported currencies are not converted; comparison with the KES policy is denied.
- Limitations: no persistence, imported spending records, exchange rates, currency conversion, recipient controls, wallet checks, transaction execution, or payment functionality. The example policy is compiled demo configuration, not a configurable production policy.

## Milestone 2 implementation record (2026-10-28)

- The renderer keeps context isolation, disabled Node integration, sandbox, web security, restrictive CSP, local-only protocol, denied navigation/new windows, and sender/main-frame/origin checks. Preload exposes only status, explicit model initialization, and one explanation request. No generic IPC, paths, shell, secrets, signing, or arbitrary model operations are exposed.
- The model runs in `utilityProcess` and QVAC's Bare worker. The app pins `@qvac/sdk@0.22.0`, catalog model `QWEN3_600M_INST_Q4`, Qwen3 600M Q4_0. The preserved feasibility GGUF was checksum-verified as `33bcc57074ec7b6eada5a90651ee546ec0c2b271002c22baf9f1b2dd1e8f75cb`, size 382,156,480 bytes. It corresponds to `unsloth/Qwen3-0.6B-GGUF` revision `50968a4468ef4233ed78cd7c3de230dd1d61a56b`, Apache-2.0. The application cache is under Electron user data, separate from the preserved smoke cache.
- Main validates exact input shape and 8–1,600 character length, permits one explanation at a time, limits returned output to 1,800 characters, strips `<think>` blocks, and reports safe errors. The renderer displays model output as React text, never HTML. Generated content remains untrusted advisory text.
- Measured on the target Ubuntu desktop: first application setup including model download and initialization, 116.3 s; cached initialization with external networking disabled, 9.0 s; online UI inference, 27.7 s; cached offline UI inference, 22.0 s. These are single-run measurements, not performance guarantees. Observed QVAC Bare-worker RSS was about 429 MiB during offline setup and 447 MiB during inference; total GPU/process-tree memory was not independently measured. First setup downloaded the 382 MB artifact and requires network access and disk space.
- The app dependency tree overrides QVAC's exact transitive `zod@4.6.5` pin with patched `4.6.6`. Root `npm audit` reports zero vulnerabilities. The separate smoke workspace remains unchanged with three high findings; npm's suggested SDK downgrade to 0.21.1 is a semver-major change. The app override was exercised by real inference.
- Actual desktop offline inference and missing-model failure were verified. Missing-model initialization returned a failure after the 180-second request timeout without crashing the app. The cache was restored and its pinned checksum rechecked. The failed worker is terminated to allow retry.

## Deliberately deferred

No application shell, design system, persistence implementation, financial domain code, tests, wallet code, or model integration is part of Milestone 0. Those begin only after this plan is approved. The interface and database technology can be refined during Milestone 1 without changing the core integration boundaries.

## Milestone 4 implementation record (2026-10-28)

- `treasury-v1.json` resides under Electron's application-specific user-data directory. Schema version 1 uses exact-key validated records and preserves incompatible or corrupt files without resetting them. No migrations or automatic backups exist.
- Main validates proposal input, parses exact money, reruns the deterministic engine using the compiled synthetic policy and prior-spending fixture, and atomically saves the user-created record and event. The renderer cannot supply policy, decision, reason codes, or a path. `allow` is only a policy result.
- Each audit event includes UUID, UTC timestamp, type, proposal ID, minimal details, prior hash and current SHA-256. Canonical serialization sorts object keys recursively, preserves array order, and emits compact UTF-8 JSON. The first previous hash is 64 zeroes. Verification identifies malformed entries, broken links, and hash mismatches. No external anchor exists; full local rewrite and rehash remains possible.
- Proposal schema retains policy ID/version and applicable limits, threshold, period cap, synthetic prior spending, result and reason codes. Evaluation kind is marked `initial` to distinguish it from any future reevaluation; no policy editing or reevaluation UI is implemented in this milestone.
- Atomicity uses a unique mode-0600 temp file, file fsync, atomic same-directory rename and directory fsync. The single-instance lock plus serialized service queue prevents overlapping application writers. Failure before rename leaves the old snapshot; a directory-fsync failure after rename is reported as uncertain durability and the UI requires reload before retry. Abandoned temp files do not replace the snapshot. Tests exercise failure, restart and concurrent operations in temporary directories.
- Records and audit payloads contain no free-form description or secret fields. Dashboard examples and policy inputs remain visibly synthetic; persisted proposal records are labeled user-created local records. Audit verification is not transaction evidence.
# Milestone 5A — Sepolia native ETH workflow (2026-10-29)

The 2026-10-28 readiness state above was superseded by this implementation. The application now supports only Ethereum Sepolia (chain 11155111) and native test ETH. It has not created a wallet or broadcast a transaction during implementation and does not yet have independently verified transaction evidence.

- Pinned direct dependencies are WDK `1.0.0-beta.22`, EVM wallet `1.0.0-beta.24`, and ethers `6.17.0`. WDK core and EVM wallet resolve incompatible `@tetherto/wdk-wallet` declaration versions (beta.25 vs beta.21); the root override pins beta.21, matching the EVM wallet dependency. The isolated feasibility workspace was left unchanged. Native ETH uses `getAccount`, `getAddress`, `getBalance`, `quoteSendTransaction`, `signTransaction`, `sendTransaction`, and WDK disposal. WDK's `transfer` API is for token transfers and is not used.
- Ethers constructs an explicit chain-11155111 transaction with a fresh nonce, estimated gas, and EIP-1559 fee data (legacy gas price only if EIP-1559 data is absent). Fee and amount calculations use `bigint` wei. WDK's `transactionMaxFee` is also set to the policy ceiling.
- Policy `sepolia-native-eth-test-v1` has a 0.001 ETH maximum transfer, a 0.0005 ETH approval threshold, and a 0.0001 ETH maximum fee. Order: valid versioned policy and amount, correct Sepolia chain, native asset, available fee estimate and sufficient balance, fee ceiling, hard amount cap, approval threshold, allow. These limits govern test ETH only and imply no monetary value. The KES demo policy is not consulted.
- `SepoliaWalletService` stays in Electron main. Wallet creation checks async `safeStorage` and requires `gnome_libsecret` on Linux; the phrase is encrypted in memory and the ciphertext is atomically persisted mode 0600 only after explicit confirmation in a separate sandboxed backup window. Recovery phrase entry uses that dedicated window's separate preload API; the phrase is validated/derived and likewise persisted only after the user confirms. The main renderer cannot access either phrase API. Seed strings remain transient in JavaScript memory while WDK initializes; they cannot be reliably zeroed.
- Transfer lifecycle is persisted in a separate versioned atomic snapshot with its own SHA-256 chain. Snapshot validation binds proposal/policy events and the latest lifecycle event to each current record state, and checks recorded hashes/receipt status against events. It records minimal public proposal, policy, approval, confirmation, signing, broadcast attempt/result, hash, receipt and observed status events. Ambiguous submission is never retried; restart expires unconfirmed quotes and turns interrupted signing/broadcast into unknown.
- Receipt lookup uses a different public RPC endpoint (`https://public.1rpc.io/sepolia`) from the wallet provider endpoint and checks chain, exact transaction hash, success status, native transfer data, sender wallet, recipient and value. Independent lookup remains an RPC trust assumption, not a remote signed audit attestation.
- Verified implementation checks: Electron's async safeStorage API reported available with `gnome_libsecret`; the WDK Sepolia read smoke passed; renderer wallet UI loaded in Electron and exposed no phrase methods; typecheck, production build, all 39 tests, and dependency audit passed. The real app did not generate or use a wallet.

Acceptance remains pending: launch ATG Pocket locally, create or restore the dedicated test wallet, write down/check its phrase in the isolated window, fund its public address with Sepolia test ETH from a legitimate faucet, choose a controlled recipient, and explicitly approve/confirm an eligible small transfer. Then verify the hash and receipt via the app's independent RPC check and Sepolia Etherscan. Never provide seed material to Codex or place it in terminal/chat.
