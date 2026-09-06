export class PersonalityWidget {
  constructor(persona) {
    this.persona = persona;
    this.el = document.createElement('div');
    this.el.className = 'personality-widget';
    this._speechTimeout = null;
    this.render();
  }

  render() {
    this.el.innerHTML = `
      <div class="persona-card" title="Click to talk with Delta">
        <div class="persona-avatar">
          <div class="avatar-ring">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 15 8.5 22 9.3 17 14 18.2 21 12 17.8 5.8 21 7 14 2 9.3 9 8.5"/>
            </svg>
          </div>
          <span class="persona-mood-dot ${this.persona.mood}"></span>
        </div>
        <div class="persona-content">
          <span class="persona-name">${this.persona.name}</span>
          <span class="persona-role">Trading Assistant</span>
        </div>
        <div class="persona-speech hidden">
          <div class="speech-bubble">
            <p class="speech-text">${this.persona.greeting}</p>
          </div>
        </div>
      </div>
    `;

    // Click card to trigger speech or greeting
    const card = this.el.querySelector('.persona-card');
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const speechEl = this.el.querySelector('.persona-speech');
      if (speechEl && !speechEl.classList.contains('hidden')) {
        speechEl.classList.add('hidden');
      } else {
        this.showSpeech(this.persona.getGreeting());
      }
    });

    // Auto-show greeting after initial delay
    setTimeout(() => {
      this.showSpeech(this.persona.greeting);
    }, 2000);
  }

  showSpeech(text) {
    if (this._speechTimeout) {
      clearTimeout(this._speechTimeout);
      this._speechTimeout = null;
    }

    const speechEl = this.el.querySelector('.persona-speech');
    const textEl = this.el.querySelector('.speech-text');
    
    if (speechEl && textEl) {
      textEl.textContent = text;
      speechEl.classList.remove('hidden');
      speechEl.classList.add('speech-animate');
      
      // Auto-hide after 6 seconds
      this._speechTimeout = setTimeout(() => {
        speechEl.classList.add('hidden');
      }, 6000);
    }
  }

  reactToTrade(result, symbol, pnl) {
    const reaction = this.persona.getTradeReaction(result);
    const formattedPnl = typeof pnl === 'number' 
      ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` 
      : '';
    this.showSpeech(`${reaction} [${symbol || 'TRADE'}] ${formattedPnl}`.trim());
  }

  commentOnMarket(symbol, price, change) {
    const comment = this.persona.getMarketComment(symbol, price, change);
    this.showSpeech(comment);
  }

  getElement() {
    return this.el;
  }
}
