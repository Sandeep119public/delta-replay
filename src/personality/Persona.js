export class Persona {
  constructor() {
    this.name = 'Delta';
    this.mood = this.calculateMood();
    this.quotes = this.getQuotes();
    this.greeting = this.getGreeting();
  }

  calculateMood() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'energetic';
    if (hour >= 12 && hour < 17) return 'focused';
    if (hour >= 17 && hour < 22) return 'reflective';
    return 'vigilant';
  }

  getGreeting() {
    const hour = new Date().getHours();
    const greetings = {
      morning: [
        "Good morning, trader. The markets await your analysis.",
        "Fresh candles, fresh opportunities. Let's make today count.",
        "Early risers catch the best breakouts. Ready to dive in?"
      ],
      afternoon: [
        "Markets are heating up. Stay sharp.",
        "Afternoon session — perfect for momentum plays.",
        "The mid-day grind is where discipline is forged."
      ],
      evening: [
        "Evening trading — where patience meets opportunity.",
        "Asian session approaching. Time to review your setups.",
        "The calm before the storm. Study the charts carefully."
      ],
      night: [
        "Late night alpha hunting. Stay vigilant.",
        "The overnight session rewards the prepared mind.",
        "While others sleep, opportunities emerge in the charts."
      ]
    };
    
    let timeKey;
    if (hour >= 5 && hour < 12) timeKey = 'morning';
    else if (hour >= 12 && hour < 17) timeKey = 'afternoon';
    else if (hour >= 17 && hour < 22) timeKey = 'evening';
    else timeKey = 'night';
    
    const options = greetings[timeKey];
    return options[Math.floor(Math.random() * options.length)];
  }

  getQuotes() {
    return {
      win: [
        "Well played. But remember — consistency beats occasional brilliance.",
        "A win! But don't let it go to your head. The market always gives and takes.",
        "Profit secured. Now, did you follow your rules?"
      ],
      loss: [
        "Losses are lessons in disguise. What did this one teach you?",
        "The market humbled you today. Good — now you're ready to learn.",
        "Even the best traders take losses. It's how you respond that matters."
      ],
      streak: [
        "Hot streak! But remember: the house always wins if you don't know when to stop.",
        "Momentum is on your side. Ride it wisely.",
        "Winning feels good. Don't let euphoria cloud your judgment."
      ]
    };
  }

  getTradeReaction(tradeResult) {
    const quotes = this.quotes[tradeResult] || this.quotes.loss;
    return quotes[Math.floor(Math.random() * quotes.length)];
  }

  getMarketComment(symbol, price, change) {
    const comments = {
      bullish: [
        `${symbol} showing strength. Bulls in control.`,
        `${symbol} momentum building. Watch for continuation.`,
        `${symbol} price action looking healthy. Respect the trend.`
      ],
      bearish: [
        `${symbol} under pressure. Bears dominating.`,
        `${symbol} selling pressure evident. Caution advised.`,
        `${symbol} downtrend intact. Don't catch falling knives.`
      ],
      neutral: [
        `${symbol} in consolidation. Patience is key.`,
        `${symbol} market indecision. Wait for a clear signal.`,
        `${symbol} choppy conditions. Stick to high-probability setups.`
      ]
    };
    
    let mood;
    if (change > 1) mood = 'bullish';
    else if (change < -1) mood = 'bearish';
    else mood = 'neutral';
    
    const options = comments[mood];
    return options[Math.floor(Math.random() * options.length)];
  }
}
