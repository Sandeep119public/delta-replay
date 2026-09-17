export const appShellMarkup = () => `
  <aside id="app-sidebar" class="app-sidebar" aria-label="Application navigation">
    <div class="app-brand"><span class="app-brand-mark" aria-hidden="true">Δ</span><div><strong>DELTA REPLAY</strong><span>RESEARCH WORKSTATION</span></div></div>
    <nav class="app-nav" aria-label="Main navigation">
      <a class="nav-link" data-page="dashboard" href="#dashboard">Overview</a>
      <a class="nav-link" data-page="replay" href="#replay">Replay</a>
      <div class="nav-section-label">Data</div>
      <a class="nav-link" data-page="downloads" href="#downloads">Downloads</a>
      <a class="nav-link" data-page="datasets" href="#datasets">Datasets</a>
      <a class="nav-link" data-page="validation" href="#validation">Validation</a>
      <a class="nav-link" data-page="storage" href="#storage">Storage</a>
      <div class="nav-section-label">Research</div>
      <a class="nav-link" data-page="experiments" href="#experiments">Experiments</a>
      <a class="nav-link" data-page="strategies" href="#strategies">Strategies</a>
      <a class="nav-link" data-page="journal" href="#journal">Journal</a>
      <div class="nav-section-label">System</div>
      <a class="nav-link" data-page="jobs" href="#jobs">Jobs</a>
      <a class="nav-link" data-page="system" href="#system">System</a>
    </nav>
    <div class="app-sidebar-footer"><span class="status-dot"></span> Local research environment</div>
  </aside>
  <button id="mobile-nav-toggle" class="mobile-nav-toggle" type="button" aria-label="Open navigation" aria-controls="app-sidebar" aria-expanded="false">☰</button>
  <div id="mobile-nav-scrim" class="mobile-nav-scrim" aria-hidden="true"></div>
  <main id="page-host" class="page-host">
    <section id="page-dashboard" class="app-page page" data-page="dashboard" hidden></section>
    <section id="page-downloads" class="app-page page" data-page="downloads" hidden></section>
    <section id="page-datasets" class="app-page page" data-page="datasets" hidden></section>
    <section id="page-validation" class="app-page page" data-page="validation" hidden></section>
    <section id="page-storage" class="app-page page" data-page="storage" hidden></section>
    <section id="page-experiments" class="app-page page" data-page="experiments" hidden></section>
    <section id="page-strategies" class="app-page page" data-page="strategies" hidden></section>
    <section id="page-journal" class="app-page page" data-page="journal" hidden></section>
    <section id="page-jobs" class="app-page page" data-page="jobs" hidden></section>
    <section id="page-system" class="app-page page" data-page="system" hidden></section>
    <section id="page-replay" class="page active" data-page="replay" data-paper-layout="1">REPLAY_CONTENT</section>
  </main>
`;