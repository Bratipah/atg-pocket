import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/styles.css';

declare global { interface Window { walletBackup: { getMode(): Promise<'backup' | 'recovery'>; getPhrase(): Promise<string>; restorePhrase(phrase: string): Promise<{ address: string }>; confirmWritten(): Promise<void> } } }
function WalletBackup() {
  const [mode, setMode] = useState<'backup' | 'recovery'>('backup');
  const [phrase, setPhrase] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [restoredAddress, setRestoredAddress] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => { void window.walletBackup.getMode().then(async (value) => { setMode(value); if (value === 'backup') setPhrase(await window.walletBackup.getPhrase()); }).catch(() => setError('The restricted wallet window could not be initialized. Close it and retry from the wallet section.')); }, []);
  async function restore() {
    setError('');
    try { const result = await window.walletBackup.restorePhrase(recoveryInput); setRecoveryInput(''); setRestoredAddress(result.address); }
    catch { setRecoveryInput(''); setError('Recovery failed. Check the phrase and Sepolia RPC, then re-enter the phrase.'); }
  }
  async function complete() {
    try { await window.walletBackup.confirmWritten(); setPhrase(''); setDone(true); }
    catch { setError('Backup confirmation could not be saved. Keep your written phrase safe and try again.'); }
  }
  return <main style={{ maxWidth: 720, margin: '48px auto', padding: 28, color: '#edf3ef', background: '#151c1a', borderRadius: 16, fontFamily: 'system-ui, sans-serif' }}>
    <h1>{mode === 'recovery' ? 'Restore a Sepolia test wallet' : 'Back up this Sepolia test wallet'}</h1>
    {done ? <p>Backup confirmation saved. You may close this window.</p> : <>
      {mode === 'backup' ? <>
        <p>This phrase controls this testnet wallet. Write it on paper and keep it private. Anyone who sees it can control the wallet. Do not take a screenshot, paste it into a document or share it. This dedicated local window displays it once while this app is running.</p>
        <p>ATG Pocket stores only an OS-encrypted copy on this device. Transfers stay disabled until you confirm that you recorded the phrase. If you lose the phrase and device, the wallet cannot be recovered.</p>
        {phrase && <ol style={{ columns: 3, fontSize: 18, lineHeight: 2 }}>{phrase.split(' ').map((word, i) => <li key={i}><b>{i + 1}.</b> {word}</li>)}</ol>}
        <button onClick={() => void complete()} disabled={!phrase}>I wrote down and checked all 12 words</button>
      </> : <>
        <p>Enter your previously backed up recovery phrase only in this dedicated local window. It is sent to the trusted main process for validation and OS encryption. It is not written to disk or audit history as plaintext. Make sure the phrase is from your dedicated Sepolia test wallet.</p>
        {!restoredAddress ? <><label htmlFor="recovery-phrase">Recovery phrase</label><textarea id="recovery-phrase" autoComplete="off" spellCheck={false} value={recoveryInput} onChange={(event) => setRecoveryInput(event.target.value)} /><button disabled={!recoveryInput.trim()} onClick={() => void restore()}>Validate recovery wallet</button></> : <><p>Derived public address: <code>{restoredAddress}</code></p><p>Check this address against your own backup records. The wallet will be stored encrypted on this device after confirmation.</p><button onClick={() => void complete()}>Confirm and store encrypted recovery</button></>}
      </>}
      {error && <p role="alert">{error}</p>}
    </>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<WalletBackup />);
