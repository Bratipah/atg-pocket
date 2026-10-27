# ATG Pocket — Initial Architecture Proposal

**Milestone:** 0 (proposal only; requires user approval before implementation)  
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
- `services/ai`: `LocalAIService` contract and production QVAC adapter. The model parses intent and explains validated context; app code performs calculations and enforces policy. Runtime-schema validation is mandatory.
- `services/wallet`: narrow `WalletService` using verified WDK EVM methods. Separate online verification, user confirmation, signing, broadcast and receipt confirmation. No automatic execution from model output or policy result.
- `services/persistence`: local, schema-versioned repository. Candidate is SQLite via Electron main process for one desktop host; IndexedDB is an alternative if platform/packaging favors it. Select only after a short persistence feasibility check in Milestone 1. Treat records as untrusted; do not claim encryption at rest.
- `services/audit`: append-only application-level events, explicitly not cryptographically tamper-proof.

## Initial integration choices (provisional)

| Concern | Proposal | Verification still required |
|---|---|---|
| QVAC package | Feasibility harness uses `@qvac/sdk@0.22.0` | Online/offline inference and Electron utility-process inference passed; product adapter, output policy, packaging and app-level sandbox/security checks remain |
| Initial model candidate | QVAC catalog `QWEN3_600M_INST_Q4` (382 MB, Apache-2.0 pinned artifact) | Checksum and license metadata verified; inference works but exact-output instruction following was weak; evaluate answer quality before relying on it |
| Wallet packages | Feasibility harness uses `@tetherto/wdk@1.0.0-beta.22`, `@tetherto/wdk-wallet-evm@1.0.0-beta.24` | Typings, initialization and Sepolia RPC read passed; real Sepolia transfer, token address/faucet and independently verified receipt remain untested |
| First test network | Ethereum Sepolia | Confirm RPC reliability and demo-specific test ETH / mock USD₮ source |
| Reporting currency | KES, stored as integer cents | Do not convert KES to token without a live, sourced, fresh rate and explicit user review; conversion may be deferred in the MVP |
| Test token | Mock/test USD₮ only if faucet and contract are confirmed | Clearly distinguish from Tether-issued mainnet USD₮; testnet token identity and decimals must be documented |
| Model cache | QVAC cache in user data directory; same configured cache for download and offline reload | Verify lifecycle and disk footprint on the demo host; provide visible model state and recovery guidance |

## Typed renderer interface

Expose one method per allowed operation through preload/contextBridge; never expose raw `ipcRenderer` or general-purpose `send/invoke`. All arguments and results are runtime-schema validated in the privileged process. Validate sender frame origin `app://atg`, expected `webContents` id and main-frame status on every call.

```ts
interface AtgApi {
  getRuntimeStatus(): Promise<RuntimeStatus>
  askTreasuryCopilot(input: { question: string; proposalId?: string }): Promise<{ answer: string; inferenceId: string }>
  createPaymentProposal(input: { supplierId: string; amountMinor: string; currency: 'KES' }): Promise<ProposalSummary>
  evaluateProposal(input: { proposalId: string }): Promise<PolicyDecision>
  executeApprovedProposal(input: { proposalId: string; approvalChallenge: string }): Promise<TransactionState>
  onRuntimeStatus(listener: (status: RuntimeStatus) => void): () => void
}
```

No renderer method accepts a filesystem path, command, raw transaction, arbitrary signer request, or generic IPC channel. QVAC has no wallet tools. `executeApprovedProposal` resolves only a stored proposal which has passed deterministic policy and fresh online checks, with an explicit confirmation bound to that proposal.

## Security and offline behavior

- Default-deny network execution. Offline users can inspect local records, ask questions based on validated local data, create/evaluate proposals, and view audit records.
- Offline proposal creation is not payment execution. Online execution requires fresh chain/network and balance checks, explicit transaction review and human authorization, then WDK action and network evidence.
- Keep signing keys only in a dedicated test wallet's process memory or an approved OS secure store if later verified. Never commit secrets, log keys/seed phrases, or put them in renderer state or persisted business records.
- Show connection state, last-verified timestamps, QVAC state, wallet/network state and exact proposal/transaction state. A cached balance is always marked stale/offline.
- Packaged Electron renderer security remains an architecture gate. QVAC utility-process inference worked without `--no-sandbox`; do not add that switch based on the upstream tutorial.
- Create the renderer with `{ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }`; serve only bundled `app://atg/` content. Set a restrictive CSP (`default-src 'none'`, local scripts/styles/assets only, `connect-src 'none'`), deny navigation and new windows, disable `<webview>`, and validate every sender. Electron official security guidance specifically calls for these controls.
- QVAC utility process uses a narrow, validated request/response protocol. WDK lives in a privileged wallet service. Use a dedicated test wallet and keep secret material only in that process’s memory or a reviewed OS keyring; do not select or claim a keyring until its implementation is verified. Never return secrets to renderer or logs.
- Offline inference has been observed after online model setup by running QVAC in a process isolated from external networking. App-level offline QA must still show local inference works and that signing/broadcast fails closed while disconnected.

## Deliberately deferred

No application shell, design system, persistence implementation, financial domain code, tests, wallet code, or model integration is part of Milestone 0. Those begin only after this plan is approved. The interface and database technology can be refined during Milestone 1 without changing the core integration boundaries.
