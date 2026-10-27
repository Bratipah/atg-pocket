import WDK from '@tetherto/wdk'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'

const rpc = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const ephemeralSeed = WDK.getRandomSeedPhrase()
const wdk = new WDK(ephemeralSeed)
  .registerWallet('ethereum-sepolia', WalletManagerEvm, {
    provider: rpc,
    chainId: 11155111,
  })

try {
  const account = await wdk.getAccount('ethereum-sepolia', 0)
  const address = await account.getAddress()
  const balance = await account.getBalance()
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('WDK returned an invalid EVM address')
  process.stdout.write(
    `${JSON.stringify({
      chain: 'Sepolia',
      chainId: 11155111,
      walletApi: 'ok',
      rpcRead: 'ok',
      nativeBalanceBaseUnits: balance.toString(),
      ephemeralWalletAddressDisplayed: false,
      seedPhraseLoggedOrPersisted: false,
    })}\n`,
  )
} finally {
  wdk.dispose()
}
