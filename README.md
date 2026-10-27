# ATG Pocket

ATG Pocket is an offline-first treasury oversight concept for small businesses. This repository currently contains the **Milestone 1 desktop foundation and design system**. The dashboard's amounts and counts are synthetic examples; there are no connected wallets, financial records, policy rules, payment actions, or AI inference in this application.

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

`npm start` opens the last production build. There are no application unit tests or lint rules configured in Milestone 1. The separate feasibility scripts under `tools/feasibility/` are preserved and are not application tests.

## Structure

- `src/electron/main.ts` — window lifecycle, local `app://atg` asset protocol, CSP, and the only allowlisted shell-status IPC handler.
- `src/electron/preload.ts` — exposes the typed `window.atg.getShellStatus()` method; it does not expose Node, raw IPC, filesystem, shell, wallet, or service APIs.
- `src/renderer/` — React interface and local design system.
- `tools/feasibility/` — isolated, preserved QVAC and WDK smoke evidence; neither is imported by the application.

## Trust boundaries and planned integrations

The renderer is an untrusted presentation process with context isolation, sandboxing, Node integration disabled, and a restrictive policy that denies network connections. Main-process IPC validates the calling window, exact local app origin, and main frame. Navigation and new windows are denied. This milestone has no application service IPC beyond static shell status.

Future QVAC inference belongs in the isolated Electron utility-process architecture already exercised by the QVAC feasibility harness, with a narrow validated request/response protocol. WDK and any secret handling must remain in a privileged service boundary; seed material, keys, signing methods, and raw transaction authority must never enter renderer state or preload. No secret storage or signing implementation has been selected or built. A later milestone must verify packaged behavior and the host's secure storage option before wallet onboarding.

The renderer currently cannot reach the network. Its "Network not checked" status is intentional and does not claim that connectivity was detected. Local AI is marked "Not integrated". Demo treasury values are synthetic and are not wallet balances.

## Dependency note

The application intentionally does not depend on QVAC, WDK, or Zod. The preserved QVAC smoke workspace has three high-severity npm audit entries caused by its pinned transitive `zod@4.6.5` (`GHSA-mrhx-c7xc-m3w5`, affected range `<4.6.6`). The entries are scoped to that harness's `@qvac/sdk@0.22.0` dependency tree. The harness and lockfile were not changed to address them. Reassess this finding when QVAC is introduced in its authorized milestone.
