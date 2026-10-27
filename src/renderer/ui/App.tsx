import { useEffect, useState } from 'react';
import type { ShellStatus } from '../../electron/api';

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

  useEffect(() => {
    if (!window.atg) return;
    void window.atg.getShellStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

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
            <div className="strip-item"><span className="strip-icon ai-icon">✳</span><div><span className="strip-label">LOCAL AI</span><strong>Not integrated</strong></div><span className="tag tag-neutral">MILESTONE 3</span></div>
            <div className="strip-separator" />
            <div className="strip-item"><span className="strip-icon shield-icon">◇</span><div><span className="strip-label">POLICY ENGINE</span><strong>Not configured</strong></div><span className="tag tag-neutral">MILESTONE 2</span></div>
            <div className="strip-separator" />
            <div className="strip-item"><span className="strip-icon network-icon">⌁</span><div><span className="strip-label">NETWORK</span><strong>Not checked</strong></div><span className="tag tag-neutral">NO DETECTION</span></div>
          </section>

          <section className="section-heading"><div><div className="section-kicker">01 <span /> OVERVIEW</div><h2>Treasury snapshot</h2></div><span className="demo-badge"><span /> SYNTHETIC DEMO VALUES</span></section>
          <section className="metric-grid" aria-label="Synthetic demonstration treasury values">
            <article className="metric-card featured"><div className="metric-top"><span className="metric-label">DEMO TREASURY VALUE</span><span className="metric-symbol">◈</span></div><div className="metric-value">KES 248,500<span className="metric-decimal">.00</span></div><div className="metric-foot"><span className="metric-mark">↗</span><span>Example only</span><span className="foot-sep">·</span><span>Not connected to a wallet</span></div><div className="card-corner" /></article>
            <article className="metric-card"><div className="metric-top"><span className="metric-label">DEMO THIS WEEK</span><span className="metric-symbol soft">⌁</span></div><div className="metric-value">KES 64,200<span className="metric-decimal">.00</span></div><div className="metric-foot"><span>Example activity total</span></div></article>
            <article className="metric-card"><div className="metric-top"><span className="metric-label">DEMO MOVEMENTS</span><span className="metric-symbol soft">⇄</span></div><div className="metric-value">08<span className="metric-small"> items</span></div><div className="metric-foot"><span>Illustrative count · no records loaded</span></div></article>
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

          <footer className="page-footer"><div><Mark /><span>LOCAL-FIRST BY DESIGN</span></div><div><span>Shell {status?.appVersion ?? '—'}</span><i /> <span>AI {status?.localAi ?? 'not integrated'}</span><i /> <span>Network {status?.network ?? 'not checked'}</span></div></footer>
        </div>
      </main>
    </div>
  );
}
