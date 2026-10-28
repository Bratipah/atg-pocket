import { useEffect, useState } from 'react';
import type { AiStatus, EvaluateProposalResponse, ExplanationResponse, ShellStatus } from '../../electron/api';
import { CURRENCY_METADATA } from '../../electron/treasury-domain';

const navigation = [
  { label: 'Overview', icon: '◫', active: true },
  { label: 'Treasury', icon: '◈', active: false },
  { label: 'Policies', icon: '≋', active: false },
  { label: 'Activity', icon: '↗', active: false },
];

function Mark() {
  return <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>;
}

export function App() {
  const [status, setStatus] = useState<ShellStatus | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ state: 'not-initialized', message: 'Model not initialized' });
  const [context, setContext] = useState('Synthetic example: a weekly procurement budget is KES 60,000, prior example spending is KES 24,000, and a proposed stock purchase is KES 8,000. Explain the context and arithmetic for review.');
  const [explanation, setExplanation] = useState<ExplanationResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [proposalAmount, setProposalAmount] = useState('8000');
  const [proposalCurrency, setProposalCurrency] = useState('KES');
  const [evaluation, setEvaluation] = useState<EvaluateProposalResponse | null>(null);
  const [policyError, setPolicyError] = useState('');

  function formatMoney(money: { currency: keyof typeof CURRENCY_METADATA; minorUnits: number }): string {
    const exponent = CURRENCY_METADATA[money.currency].minorUnitExponent;
    const digits = String(money.minorUnits).padStart(exponent + 1, '0');
    return `${money.currency} ${exponent ? `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}` : digits}`;
  }

  async function evaluateProposal() {
    setPolicyError(''); setEvaluation(null);
    try { setEvaluation(await window.atg.evaluateProposal({ amount: proposalAmount, currency: proposalCurrency })); }
    catch (reason) { setPolicyError(reason instanceof Error ? reason.message : 'The proposal could not be evaluated.'); }
  }

  useEffect(() => {
    if (!window.atg) return;
    void window.atg.getShellStatus().then(setStatus).catch(() => setStatus(null));
    void window.atg.getAiStatus().then(setAiStatus).catch(() => setAiStatus({ state: 'failed', message: 'Local model status is unavailable.' }));
  }, []);

  async function initializeAi() {
    setBusy(true); setError(''); setAiStatus({ state: 'initializing', message: 'Loading or downloading model…' });
    try { setAiStatus(await window.atg.initializeAi()); }
    catch { setError('Model initialization failed. Retry while connected and check free disk space.'); setAiStatus({ state: 'failed', message: 'Model initialization failed' }); }
    finally { setBusy(false); }
  }

  async function requestExplanation() {
    setBusy(true); setError(''); setExplanation(null); setAiStatus({ state: 'processing', message: 'Generating explanation…' });
    try { setExplanation(await window.atg.explainTreasury({ context })); setAiStatus(await window.atg.getAiStatus()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Local inference failed.'); setAiStatus(await window.atg.getAiStatus().catch(() => ({ state: 'failed' as const, message: 'Local model status is unavailable.' }))); }
    finally { setBusy(false); }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><Mark /><div><strong>ATG<span> / </span>POCKET</strong><small>TREASURY GUARDIAN</small></div></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button className={`nav-item${item.active ? ' active' : ''}`} key={item.label} aria-current={item.active ? 'page' : undefined}>
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}
              {item.active && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-divider" />
          <div className="side-status"><span className="status-led muted" /><div><strong>Local workspace</strong><small>Data stays on this device</small></div></div>
          <div className="profile"><div className="avatar">GK</div><div><strong>Demo workspace</strong><small>Local session</small></div><span className="profile-menu">···</span></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><b>/</b><strong>Overview</strong></div>
          <div className="topbar-right">
            <div className="connectivity"><span className="status-led muted" /><span>Network not checked</span></div>
            <div className="topbar-divider" />
            <button className="help-button" aria-label="Help">?</button>
          </div>
        </header>

        <div className="content-wrap">
          <section className="welcome-row">
            <div><div className="eyebrow"><span className="eyebrow-line" /> TREASURY CONTROL, AT A GLANCE</div><h1>Good morning<span className="period">.</span></h1><p className="intro">A clear view of your funds, guardrails, and proposed activity.</p></div>
            <div className="date-chip"><span className="calendar-icon">▦</span> DEMONSTRATION VIEW</div>
          </section>

          <section className="status-strip" aria-label="Application capability status">
            <div className="strip-item"><span className="strip-icon ai-icon">✳</span><div><span className="strip-label">LOCAL AI</span><strong>{aiStatus.message}</strong></div><span className="tag tag-neutral">{aiStatus.state.toUpperCase()}</span></div>
            <div className="strip-separator" />
            <div className="strip-item"><span className="strip-icon shield-icon">◇</span><div><span className="strip-label">POLICY ENGINE</span><strong>Deterministic demo policy</strong></div><span className="tag tag-neutral">MILESTONE 3</span></div>
            <div className="strip-separator" />
            <div className="strip-item"><span className="strip-icon network-icon">⌁</span><div><span className="strip-label">NETWORK</span><strong>Not checked</strong></div><span className="tag tag-neutral">NO DETECTION</span></div>
          </section>

          <section className="section-heading"><div><div className="section-kicker">01 <span /> OVERVIEW</div><h2>Treasury snapshot</h2></div><span className="demo-badge"><span /> SYNTHETIC DEMO VALUES</span></section>
          <section className="metric-grid" aria-label="Synthetic demonstration treasury values">
            <article className="metric-card featured"><div className="metric-top"><span className="metric-label">DEMO TREASURY VALUE</span><span className="metric-symbol">◈</span></div><div className="metric-value">KES 248,500<span className="metric-decimal">.00</span></div><div className="metric-foot"><span className="metric-mark">↗</span><span>Example only</span><span className="foot-sep">·</span><span>Not connected to a wallet</span></div><div className="card-corner" /></article>
            <article className="metric-card"><div className="metric-top"><span className="metric-label">DEMO THIS WEEK</span><span className="metric-symbol soft">⌁</span></div><div className="metric-value">KES 64,200<span className="metric-decimal">.00</span></div><div className="metric-foot"><span>Example activity total</span></div></article>
            <article className="metric-card"><div className="metric-top"><span className="metric-label">DEMO MOVEMENTS</span><span className="metric-symbol soft">⇄</span></div><div className="metric-value">08<span className="metric-small"> items</span></div><div className="metric-foot"><span>Illustrative count · no records loaded</span></div></article>
          </section>

          <section className="panel policy-demo" aria-labelledby="policy-demo-heading">
            <div className="panel-heading"><div><div className="section-kicker">02 <span /> DETERMINISTIC POLICY</div><h2 id="policy-demo-heading">Evaluate a synthetic proposal</h2></div><span className="demo-badge"><span /> SYNTHETIC SCENARIO</span></div>
            <p className="ai-advisory">This policy evaluation runs locally in the privileged application process. KES is the reporting and policy currency here; this is not payment or settlement support. No history is persisted.</p>
            <div className="policy-facts"><span>Per transaction hard limit <strong>KES 20,000.00</strong></span><span>Example week cap <strong>KES 60,000.00</strong></span><span>Approval threshold <strong>KES 10,000.00</strong></span><span>Supplied prior spending <strong>KES 24,000.00</strong></span></div>
            <div className="proposal-form">
              <div className="proposal-input"><label className="ai-label" htmlFor="proposal-amount">Proposed amount</label>
              <input id="proposal-amount" inputMode="decimal" value={proposalAmount} onChange={(event) => setProposalAmount(event.target.value)} aria-describedby="proposal-currency-note" />
              </div><select aria-label="Proposal currency" value={proposalCurrency} onChange={(event) => setProposalCurrency(event.target.value)}>{Object.keys(CURRENCY_METADATA).map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select>
              <button className="ai-button" onClick={() => void evaluateProposal()}>Evaluate proposal</button>
            </div>
            <small id="proposal-currency-note" className="policy-note">Currency selection labels the proposal amount only. No exchange rate or settlement conversion is applied.</small>
            {policyError && <p className="ai-error" role="alert">{policyError}</p>}
            {evaluation && <div className={`policy-result outcome-${evaluation.result.outcome}`} aria-live="polite">
              <strong>{evaluation.result.outcome.replace('_', ' ')}</strong><span>Proposal: {formatMoney(evaluation.transaction)} · Policy currency: {evaluation.policy.currency}</span>
              <span>Reason code: {evaluation.result.reasonCodes.join(', ')}</span><p>{evaluation.result.explanation}</p>
              <small>Evaluation only. No payment was made, signed, broadcast, or settled.</small>
            </div>}
          </section>

          <section className="lower-grid">
            <article className="panel policy-panel">
              <div className="panel-heading"><div><div className="section-kicker">02 <span /> GUARDRAILS</div><h2>Budget &amp; policies</h2></div><span className="outline-icon">≋</span></div>
              <div className="empty-state policy-empty"><div className="empty-illustration policy-illustration"><span className="ring ring-one"/><span className="ring ring-two"/><span className="shield-shape">◇</span><span className="tiny-spark">✳</span></div><div className="empty-title">No policies configured</div><p>Your treasury has no spending limits or approval rules yet. Policy controls will be introduced in a later milestone.</p><span className="soft-label">SETUP NOT AVAILABLE</span></div>
            </article>

            <article className="panel actions-panel">
              <div className="panel-heading"><div><div className="section-kicker">03 <span /> REVIEW QUEUE</div><h2>Proposed actions</h2></div><span className="count-pill">0</span></div>
              <div className="empty-state actions-empty"><div className="empty-illustration actions-illustration"><div className="doc-shape"><i/><i/><i/></div><span className="plus-shape">+</span></div><div className="empty-title">Nothing to review</div><p>Proposals will appear here for your review. No payment actions are available in this foundation.</p><span className="soft-label">NO ACTIONS PROPOSED</span></div>
            </article>
          </section>

          <section className="panel ai-panel" aria-labelledby="ai-heading">
            <div className="panel-heading"><div><div className="section-kicker">04 <span /> LOCAL MODEL</div><h2 id="ai-heading">Treasury explanation</h2></div><span className="tag tag-neutral">QWEN3 · ON DEVICE</span></div>
            <p className="ai-advisory">AI-generated advisory explanation. It does not authorize payments, enforce limits, or make financial decisions. Example context only.</p>
            <label className="ai-label" htmlFor="treasury-context">Context (up to 1,600 characters)</label>
            <textarea id="treasury-context" maxLength={1600} value={context} onChange={(event) => setContext(event.target.value)} disabled={busy} />
            <div className="ai-actions">
              {aiStatus.state !== 'ready' && <button className="ai-button secondary" onClick={() => void initializeAi()} disabled={busy}>{aiStatus.state === 'initializing' ? 'Initializing…' : aiStatus.state === 'failed' ? 'Retry model setup' : 'Initialize local model'}</button>}
              <button className="ai-button" onClick={() => void requestExplanation()} disabled={busy || aiStatus.state !== 'ready' || context.trim().length < 8}>{busy ? 'Working…' : 'Generate explanation'}</button>
              {explanation && <span className="ai-latency">Generated in {(explanation.latencyMs / 1000).toFixed(1)}s</span>}
            </div>
            {error && <p className="ai-error" role="alert">{error}</p>}
            {explanation && <div className="ai-response"><strong>AI-generated advisory explanation</strong><p>{explanation.answer}</p></div>}
          </section>

          <footer className="page-footer"><div><Mark /><span>LOCAL-FIRST BY DESIGN</span></div><div><span>Shell {status?.appVersion ?? '—'}</span><i /> <span>AI {status?.localAi ?? 'not integrated'}</span><i /> <span>Network {status?.network ?? 'not checked'}</span></div></footer>
        </div>
      </main>
    </div>
  );
}
