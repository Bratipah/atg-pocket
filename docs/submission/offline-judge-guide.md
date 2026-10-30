# Judge Guide: Running ATG Pocket Offline

ATG Pocket can run its QVAC explanation copilot, deterministic example policy, local proposal/audit history, and entered-quote cost planner without internet **after dependencies and the model have been prepared**. A first-time, cold setup is not fully offline: install Node packages and download/cache the Qwen3 model while connected, then disconnect networking and relaunch the app.

The wallet section is separate. Wallet setup, balance and fee lookup, signing/broadcast, and receipt verification use Sepolia RPC and therefore need internet. Sepolia ETH is testnet-only. Do not present an offline proposal as a broadcast or settlement.

## Tested platform

- Ubuntu desktop with a graphical session
- Node.js 22.17 or later and npm 10.9 or later
- GNOME Keyring is needed only for the wallet workflow; it is not needed for the offline copilot, local policy, audit, or cost-planner demo.

## One-time preparation while online

Run from a terminal:

```bash
git clone https://github.com/Bratipah/atg-pocket.git
cd atg-pocket
npm ci
npm run dev:electron
```

Electron 45 requires a correctly installed Linux sandbox helper. If the launcher prints a permission repair instruction, apply the two exact `sudo chown` and `sudo chmod 4755` commands it prints, then rerun `npm run dev:electron`. Check the helper before proceeding:

```bash
stat -c '%A %a %U:%G' node_modules/electron/dist/chrome-sandbox
```

It should report mode `4755` and owner `root:root`. Dependency reinstall/update may reset the helper permissions. The launcher does not disable Chromium sandboxing.

In ATG Pocket:

1. Find **Treasury explanation** and choose **Initialize local model**.
2. Wait for the status to show **Local model ready**. On first initialization, QVAC downloads and caches the Qwen3 600M Q4_0 model (about 365 MiB); allow time for this to complete.
3. Confirm the model cache exists at `~/.config/atg-pocket/qvac/cache`.
4. Close ATG Pocket normally after initialization finishes. Do not remove the cache or reinstall dependencies between preparation and the offline demo.

## Offline demonstration

1. Disconnect Wi-Fi and Ethernet, or enable airplane mode. Keep the computer itself running.
2. Relaunch from the project directory:

   ```bash
   npm start
   ```

3. Under **Treasury explanation**, choose **Initialize local model** again. The cached model should load locally. Wait for **Local model ready**.
4. Use the default synthetic context or enter a prompt such as:

   > Explain the example budget: weekly KES 60,000, prior spending KES 24,000, proposed stock purchase KES 8,000. State that this is an illustrative scenario.

   Choose **Generate explanation**. The response is produced on-device. Show its displayed latency. Model output can be inaccurate, so treat it as advisory; the deterministic policy is the source of policy decisions.
5. Under **Evaluate a synthetic proposal**, save and evaluate `8000` KES (allow), then `10000` KES (requires approval), then `20000.01` KES (deny). These are synthetic KES policy examples, not KES payments or settlement.
6. Show **LOCAL AUDIT** / audit verification and the saved local proposal records. Explain that the local hash chain checks retained event consistency but is not a remote audit anchor.
7. Under **Compare stated route costs**, compare the example rows or enter your own values. The defaults are synthetic and the planner does not fetch or validate market quotes, liquidity, freshness, or fees.
8. Show the Sepolia test USD₮ wallet and its Sepolia ETH gas balance. Without internet, balance/fee refresh and all wallet network actions are unavailable. Do not attempt to broadcast while offline.

## What judges should expect

| Feature | Offline after setup? | What the demo proves |
|---|---:|---|
| QVAC explanation after model cache | Yes | A fresh on-device model response after app restart with networking disconnected. |
| KES example-policy evaluation | Yes | Deterministic policy output for synthetic inputs. |
| Local proposals and audit verification | Yes | Local persistence and hash-chain consistency on this device. |
| Entered-quote cost planner | Yes | Decimal-safe comparison of user-entered numbers only. |
| Sepolia wallet setup, balance, fees, signing/broadcast, receipt lookup | No | These require a network connection and Sepolia RPC. |
| Sepolia mock USD₮ test transfer | Online only | ERC-20 testnet transfer only; test token is not redeemable Tether USDT. Sepolia ETH pays gas. |
| Business USDT/USDC liquidity, swaps, FX routing, KES settlement | Not implemented | These are roadmap items, not part of this demonstration. |

## Troubleshooting

- **Model initialization fails offline:** reconnect, launch ATG Pocket, initialize and wait for **Local model ready**, then close and retry the offline steps. Check free disk space. The model must be fully cached before going offline.
- **Electron refuses to launch:** follow the launcher's sandbox-helper instructions. Do not add `--no-sandbox`.
- **AI answer is slow or inaccurate:** this is a known limitation of the small local model. It is advisory only; verify arithmetic and rely on the deterministic policy result.
- **Wallet status or balance is unavailable:** expected offline. Reconnect only for Sepolia actions; test ETH is not a business stablecoin balance.

For broader architecture and implementation status, see the [project README](../../README.md) and [milestone record](../implementation/milestone-plan.md).


## Online test USD₮ demonstration

Wallet transfers cannot be reproduced offline. To try the ERC-20 flow while online:

1. Ensure GNOME Keyring is available, then create or restore the dedicated Sepolia wallet and record its recovery phrase securely.
2. Fund it with Sepolia ETH for gas and obtain Sepolia mock USD₮ from a faucet linked by [WDK testnet guidance](https://docs.wdk.tether.io/sdk/wallet-modules/wallet-evm-erc-4337/configuration/).
3. Confirm the displayed token balance and contract verification. The configured contract is `0xd077A400968890Eacc75cdc901F0356c943e4fDb` (6 decimals); see [Candide’s Sepolia token list](https://docs.candide.dev/wallet/paymaster/tokens-supported/).
4. Enter a recipient address and an amount below 50 test USD₮, review the quote and fee in Sepolia ETH, then use the separate OS confirmation to submit. Amounts at or above 50 test USD₮ require an additional approval; the hard limit is 100.
5. Use **Verify receipt independently** to check the receipt, sender, recipient, token contract, exact amount and ERC-20 Transfer event. No faucet or token transfer is performed by automated tests.

The displayed USD₮ is a mock/test token and is not redeemable Tether USDT. Public RPC access, test token availability and Sepolia gas are required.
