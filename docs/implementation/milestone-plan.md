# ATG Pocket — Milestone and Submission Record

**Updated:** 2026-10-29 · **Demo target:** Ubuntu desktop · **Submission deadline recorded in feasibility notes:** 30 October 2026, 17:00 EAT.

## Delivery status

| Milestone | Status | Delivered |
|---|---|---|
| M0 — Feasibility | Complete | QVAC model and device tests, utility-process inference, WDK API/RPC exploration, measurements, constraints and preserved smoke harnesses. See [`feasibility.md`](../architecture/feasibility.md). |
| M1 — Desktop foundation | Complete | Electron + React + TypeScript, restricted renderer and app shell. |
| M2 — Local AI | Complete for prototype | QVAC utility process, cached Qwen3 600M Q4_0 inference and advisory UI. Output quality is limited; offline inference after caching has been demonstrated. |
| M3 — Deterministic policy | Complete | Exact-money synthetic KES example and separate Sepolia test USD₮ ERC-20 policy (Sepolia ETH gas). No KES settlement or stablecoin controls. |
| M4 — Local records | Complete | Atomic local proposal/audit persistence and hash-chain verification. Local owner can rewrite the full chain. |
| M5A — Sepolia wallet workflow | Implemented; real transaction acceptance outstanding | GNOME Keyring/safeStorage boundary, dedicated phrase window, WDK ERC-20 test USD₮ quote/transfer lifecycle with ETH gas, approval and confirmation, transfer store, independent RPC receipt checks, automated coverage. **No real transfer has been completed and independently verified.** |
| M6 — Treasury cost planner | Complete as illustrative arithmetic | Decimal-safe comparison of explicit entered quotes. No API, market data, liquidity, or execution. |

## Quote and FX feasibility decision

No reliable configured source was available for an integration that met this pass’s constraints. The reviewed 0x and Uniswap quote APIs require API keys, and the project has neither approved credentials nor a configured/verified asset and route. A useful comparison would also require supported chains and token contracts, actual route/liquidity availability, quote time and expiry, gross/net output semantics, conversion spread, provider/DEX charges, network and transfer fees, plus consistent baseline amount and timing. An indicative quote cannot be presented as executable; execution cannot be presented as settlement.

Therefore this release includes the safe fallback in [`treasury-cost.ts`](../../src/electron/treasury-cost.ts): it validates decimal inputs and same source amount, then calculates `(source amount + source-denominated fee) × user reference rate − net destination amount`. Quotes are entered by the user; defaults in the UI are synthetic. It reports arithmetic only. No token addresses, price, liquidity, provider fee, or savings claim is invented.

## Wallet and transfer acceptance

Implemented wallet transfer is the Sepolia mock USD₮ ERC-20 token (chain ID 11155111); native Sepolia ETH pays gas. It is not redeemable Tether USDT or a production stablecoin integration. KES demonstration policy is not reused for crypto. Online RPC, current balance, fees, confirmation, signing/broadcast and independent receipt lookup all require connectivity. Offline proposal creation or policy evaluation is not a payment.

Before reporting a real transfer as complete, a dedicated demo wallet must be created and backed up, funded with Sepolia mock USD₮ and test ETH for gas, and used for an explicitly reviewed transfer. Retain the hash and independently establish chain ID, successful receipt, sender, recipient, exact token contract, USD₮ amount, Transfer event and transaction shape using the second RPC and explorer. Until those steps have actually occurred, report the transfer as unverified. Automated tests must never send a transaction or generate/display a wallet phrase.

## Reproducible local demonstrations

### Offline-capable segment

1. Install dependencies (`npm ci`) and launch (`npm run dev:electron`) while online.
2. Initialize QVAC and wait until ready, allowing the pinned model to download and cache.
3. Disconnect networking, request a fresh explanation, and show the actual generated text and latency. The model has produced incorrect arithmetic and unconstrained `<think>` output; state plainly that policy decisions come from deterministic code.
4. Evaluate the synthetic KES proposal, save it locally, and verify the local audit chain. State that neither this proposal nor its KES units represent settlement.
5. Compare two sample/user-entered quote rows; identify their source, destination, time and assumptions. The built-in examples are synthetic, not market quotes.

### Online wallet segment

1. Confirm GNOME Keyring and secure storage availability. Use a dedicated test wallet and store its recovery phrase safely; do not capture it in recordings.
2. Confirm Sepolia network and current balance. Sepolia RPC failure must stop the demonstration; never substitute invented data.
3. Review recipient, exact amount, fee, total debit, policy result, any separate policy approval and the OS confirmation before signing.
4. Show accurate lifecycle state (broadcast/pending/unknown/failed/confirmed). Only mark confirmed after the independent receipt check succeeds. Do not retry an ambiguous broadcast without first resolving its state.

## Verification commands

```bash
npm run typecheck
npm test
npm run build
npm audit
```

The test suite covers domain rules, storage/audit integrity, wallet lifecycle and security checks. No automated transaction is sent. The feasibility smoke projects under `tools/feasibility/` are preserved and are not application runtime dependencies. Dependency audit details and the QVAC smoke workspace’s historical findings are recorded in the README and feasibility report.

## Prioritized submission checklist

1. Run typecheck, complete test suite, production build and dependency audit on the submission checkout.
2. Prepare the model cache and rehearse an actual offline inference on the submission device; capture the model’s real latency and label AI as advisory.
3. Check the README/UI for synthetic-data and testnet labels; remove no limitations or unverified status claims.
4. If showing the wallet: validate GNOME Keyring and Sepolia RPC before recording; have the backup and faucet path ready without exposing the phrase.
5. Only claim a completed transfer after independent receipt verification. Otherwise demonstrate setup/quote/policy/lifecycle only and explicitly say the transfer is unverified.
6. Do not claim live liquidity, USDT/USDC routing, FX savings, KES settlement or production readiness. Add repository/video links only when they exist.
