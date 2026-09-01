export class Logger {
  constructor(prefix = 'DeltaReplay') {
    this.prefix = prefix;
    this.enabled = true;
  }

  _fmt(level, args) {
    return [`[${this.prefix}] [${level}]`, ...args];
  }

  info(...args) {
    if (this.enabled) console.log(...this._fmt('INFO', args));
  }

  warn(...args) {
    if (this.enabled) console.warn(...this._fmt('WARN', args));
  }

  error(...args) {
    console.error(...this._fmt('ERROR', args));
  }

  debug(...args) {
    if (this.enabled) console.debug(...this._fmt('DEBUG', args));
  }
}

export const logger = new Logger();
