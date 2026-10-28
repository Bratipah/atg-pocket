# ATG Pocket

ATG Pocket is an offline-first treasury oversight concept for small businesses. This repository contains the **Milestone 1 desktop foundation, Milestone 2 local QVAC inference, and Milestone 3 deterministic treasury policy demo**. All treasury values, policy limits, and prior spending shown by the demo are synthetic. Nothing is persisted; there are no connected wallets or payment actions. Local AI provides advisory explanations only and has no role in policy decisions.

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

- `src/electron/main.ts` — window lifecycle, local `app://atg` asset protocol, CSP, sender validation, allowlisted IPC, treasury evaluation entry point, and QVAC utility-process lifecycle.
- `src/electron/treasury-domain.ts` — currency metadata, exact integer minor-unit parsing, policy validation, and pure fail-closed policy evaluation. It imports no QVAC or Electron code.
- `src/electron/qvac-worker.ts` — isolated QVAC model initialization and constrained text completion.
- `src/electron/preload.cts` — typed status, explicit model initialization, and treasury explanation methods; no Node, raw IPC, filesystem, shell, wallet, or arbitrary model APIs.
- `src/renderer/` — React interface and local design system; policy input is sent to main and the renderer cannot submit a policy or decision.
- `tools/feasibility/` — isolated, preserved QVAC and WDK smoke evidence; neither is imported by the application.

## Trust boundaries and planned integrations

The renderer is an untrusted presentation process with context isolation, sandboxing, Node integration disabled, and a restrictive policy that denies network connections. Main-process IPC validates the calling window, exact local app origin, and main frame. Navigation and new windows are denied. Only local model status, explicit initialization, and one bounded explanation request are exposed.

Future QVAC inference belongs in the isolated Electron utility-process architecture already exercised by the QVAC feasibility harness, with a narrow validated request/response protocol. WDK and any secret handling must remain in a privileged service boundary; seed material, keys, signing methods, and raw transaction authority must never enter renderer state or preload. No secret storage or signing implementation has been selected or built. A later milestone must verify packaged behavior and the host's secure storage option before wallet onboarding.

The renderer cannot reach the network. Its "Network not checked" status is intentional and does not claim that connectivity was detected. Cached model inference was tested with network access disabled. Demo treasury values and the sample treasury context are synthetic and are not wallet balances. AI-generated explanations are untrusted advisory text and do not authorize payments, enforce limits, change budgets, or make binding financial decisions.

Milestone 3 adds a KES example policy (KES 20,000 per-transaction hard limit; KES 60,000 example-week cap; KES 10,000 approval threshold) and a visibly supplied synthetic prior-spending total of KES 24,000. KES is the reporting and policy currency for this scenario; this does not represent KES settlement or payment support. The user can select supported currency codes, but incompatible policy currencies fail closed; there is no currency conversion or exchange-rate assumption. Amounts use integer minor units and reject excess decimal precision without rounding. Prior spending is an explicit fixture, not transaction history. No treasury data is persisted.

## Dependency note

The application pins `@qvac/sdk@0.22.0` and overrides its transitive `zod@4.6.5` pin to patched `4.6.6` (`GHSA-mrhx-c7xc-m3w5`). The app dependency tree reports zero audit findings. The preserved QVAC smoke workspace remains unchanged and reports three high-severity entries through `@qvac/sdk@0.22.0`, `@qvac/inference@0.22.0`, and `zod@4.6.5`. npm suggests SDK 0.21.1, a semver-major change, and that downgrade was not applied.
