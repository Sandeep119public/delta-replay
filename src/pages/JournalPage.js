export class JournalPage {
  constructor(tradingEngine) {
    this.tradingEngine = tradingEngine;
    this.el = document.getElementById('page-journal');
    this.entries = this.loadEntries();
    this.selectedTag = null;
  }

  loadEntries() {
    try {
      const stored = localStorage.getItem('delta-journal');
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.error('Failed to load journal entries from localStorage:', e);
    }
    // Default starter entries if empty
    return [
      {
        id: '1',
        date: new Date(Date.now() - 86400000).toISOString().split('T')[0],
        symbol: 'BTCUSDT',
        side: 'long',
        outcome: 'win',
        setup: 'Bullish engulfing bounce on 4h support level',
        notes: 'Patience paid off. Held through the 15m pullback and exited on TP target without emotion.',
        confidence: 8,
        tags: ['breakout', 'winner']
      },
      {
        id: '2',
        date: new Date(Date.now() - 172800000).toISOString().split('T')[0],
        symbol: 'ETHUSDT',
        side: 'short',
        outcome: 'loss',
        setup: 'Double top rejection scalp',
        notes: 'Entered too early before confirmation candle closed. Stopped out on wick expansion. Obey rule #3.',
        confidence: 5,
        tags: ['scalp', 'mistake']
      }
    ];
  }

  saveEntries() {
    try {
      localStorage.setItem('delta-journal', JSON.stringify(this.entries));
    } catch (e) {
      console.error('Failed to save journal entries:', e);
    }
  }

  render() {
    if (!this.el) {
      this.el = document.getElementById('page-journal');
      if (!this.el) return;
    }

    const filtered = this.selectedTag
      ? this.entries.filter(e => e.tags && e.tags.includes(this.selectedTag))
      : this.entries;

    this.el.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <h1 class="page-title">Trading Journal</h1>
          <p class="page-subtitle">Reflect on your executions, track psychology, and build discipline</p>
        </div>
        
        <div class="journal-layout">
          <div class="journal-sidebar">
            <button class="btn btn-primary btn-new-entry" id="btn-new-entry">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              New Entry
            </button>
            
            <div class="journal-tags">
              <span class="tag-label">Tags Filter</span>
              <div class="tag-chips">
                <button class="tag-chip ${!this.selectedTag ? 'active' : ''}" data-tag="">All</button>
                <button class="tag-chip ${this.selectedTag === 'breakout' ? 'active' : ''}" data-tag="breakout">Breakout</button>
                <button class="tag-chip ${this.selectedTag === 'reversal' ? 'active' : ''}" data-tag="reversal">Reversal</button>
                <button class="tag-chip ${this.selectedTag === 'scalp' ? 'active' : ''}" data-tag="scalp">Scalp</button>
                <button class="tag-chip ${this.selectedTag === 'swing' ? 'active' : ''}" data-tag="swing">Swing</button>
                <button class="tag-chip ${this.selectedTag === 'mistake' ? 'active' : ''}" data-tag="mistake">Mistake</button>
                <button class="tag-chip ${this.selectedTag === 'winner' ? 'active' : ''}" data-tag="winner">Winner</button>
              </div>
            </div>
            
            <div class="journal-stats">
              <h3>Journal Stats</h3>
              <div class="journal-stat">
                <span class="js-label">Total Entries</span>
                <span class="js-value">${this.entries.length}</span>
              </div>
              <div class="journal-stat">
                <span class="js-label">This Week</span>
                <span class="js-value">${this.getThisWeekCount()}</span>
              </div>
              <div class="journal-stat">
                <span class="js-label">Win Entries</span>
                <span class="js-value">${this.entries.filter(e => e.outcome === 'win').length}</span>
              </div>
            </div>
          </div>
          
          <div class="journal-content">
            <div class="journal-entries">
              ${filtered.length === 0 
                ? '<div class="empty-state">No journal entries found. Click "+ New Entry" to log a trade setup!</div>'
                : filtered.map(e => this.renderEntry(e)).join('')
              }
            </div>
          </div>
        </div>
        
        <!-- New Entry Modal -->
        <div class="journal-modal hidden" id="journal-modal">
          <div class="journal-modal-backdrop" id="modal-backdrop"></div>
          <div class="journal-modal-content">
            <div class="journal-modal-header">
              <h3>New Journal Entry</h3>
              <button class="modal-close" id="modal-close" aria-label="Close modal">&times;</button>
            </div>
            <form id="journal-form">
              <div class="form-group">
                <label for="entry-date">Trade Date</label>
                <input type="date" id="entry-date" required value="${new Date().toISOString().split('T')[0]}" />
              </div>
              <div class="form-group">
                <label for="entry-symbol">Symbol</label>
                <select id="entry-symbol">
                  <option value="BTCUSDT">BTC/USDT</option>
                  <option value="ETHUSDT">ETH/USDT</option>
                  <option value="SOLUSDT">SOL/USDT</option>
                </select>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="entry-side">Side</label>
                  <select id="entry-side">
                    <option value="long">Long</option>
                    <option value="short">Short</option>
                  </select>
                </div>
                <div class="form-group">
                  <label for="entry-outcome">Outcome</label>
                  <select id="entry-outcome">
                    <option value="win">Win</option>
                    <option value="loss">Loss</option>
                    <option value="breakeven">Breakeven</option>
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label for="entry-setup">Setup / Strategy</label>
                <input type="text" id="entry-setup" placeholder="e.g., Bullish engulfing at 4h support" required />
              </div>
              <div class="form-group">
                <label for="entry-notes">Trade Notes & Psychology</label>
                <textarea id="entry-notes" rows="4" placeholder="What went well? What could improve? Emotional state, execution discipline..."></textarea>
              </div>
              <div class="form-group">
                <label for="entry-confidence">Execution Confidence (1-10): <span id="confidence-value">5</span></label>
                <input type="range" id="entry-confidence" min="1" max="10" value="5" />
              </div>
              <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="btn-cancel">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Entry</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;
    
    this.attachEventListeners();
  }

  renderEntry(entry) {
    return `
      <div class="journal-entry-card ${entry.outcome}" data-entry-id="${entry.id}">
        <div class="entry-header">
          <div class="entry-meta">
            <span class="entry-date">${new Date(entry.date).toLocaleDateString()}</span>
            <span class="entry-symbol">${entry.symbol}</span>
            <span class="entry-side ${entry.side}">${entry.side.toUpperCase()}</span>
          </div>
          <div class="entry-outcome-badge ${entry.outcome}">${entry.outcome.toUpperCase()}</div>
        </div>
        <div class="entry-setup">${entry.setup}</div>
        <div class="entry-notes">${entry.notes || 'No extra notes provided.'}</div>
        <div class="entry-footer">
          <div class="confidence-bar">
            <span class="confidence-label">Confidence: ${entry.confidence}/10</span>
            <div class="confidence-track">
              <div class="confidence-fill" style="width: ${entry.confidence * 10}%"></div>
            </div>
          </div>
          <div class="entry-actions">
            <button class="btn btn-xs btn-danger" data-action="delete" data-id="${entry.id}">Delete</button>
          </div>
        </div>
      </div>
    `;
  }

  getThisWeekCount() {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return this.entries.filter(e => new Date(e.date).getTime() > weekAgo).length;
  }

  attachEventListeners() {
    const newBtn = this.el.querySelector('#btn-new-entry');
    const modal = this.el.querySelector('#journal-modal');
    const closeBtn = this.el.querySelector('#modal-close');
    const cancelBtn = this.el.querySelector('#btn-cancel');
    const backdrop = this.el.querySelector('#modal-backdrop');
    const form = this.el.querySelector('#journal-form');
    const confidenceSlider = this.el.querySelector('#entry-confidence');
    const confidenceValue = this.el.querySelector('#confidence-value');

    const openModal = () => modal?.classList.remove('hidden');
    const closeModal = () => modal?.classList.add('hidden');

    newBtn?.addEventListener('click', openModal);
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    backdrop?.addEventListener('click', closeModal);
    
    confidenceSlider?.addEventListener('input', (e) => {
      if (confidenceValue) confidenceValue.textContent = e.target.value;
    });

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const entry = {
        id: Date.now().toString(),
        date: this.el.querySelector('#entry-date')?.value || new Date().toISOString().split('T')[0],
        symbol: this.el.querySelector('#entry-symbol')?.value || 'BTCUSDT',
        side: this.el.querySelector('#entry-side')?.value || 'long',
        outcome: this.el.querySelector('#entry-outcome')?.value || 'win',
        setup: this.el.querySelector('#entry-setup')?.value || 'Trade setup',
        notes: this.el.querySelector('#entry-notes')?.value || '',
        confidence: parseInt(this.el.querySelector('#entry-confidence')?.value || '5', 10),
        tags: []
      };
      
      this.entries.unshift(entry);
      this.saveEntries();
      this.render();
    });

    // Tag filtering
    this.el.querySelectorAll('.tag-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.tag || null;
        this.selectedTag = tag;
        this.render();
      });
    });

    // Delete actions
    this.el.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (id) {
          this.entries = this.entries.filter(x => x.id !== id);
          this.saveEntries();
          this.render();
        }
      });
    });
  }
}
