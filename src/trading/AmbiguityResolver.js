export const AMBIGUITY_RESOLUTION = Object.freeze({
  NONE: 'NONE',
  SL_FIRST: 'SL_FIRST',
  TP_FIRST: 'TP_FIRST',
  HEURISTIC_PROXIMITY: 'HEURISTIC_PROXIMITY',
});

export const AMBIGUITY_POLICY = Object.freeze({
  CONSERVATIVE: 'CONSERVATIVE',
  SL_FIRST: 'SL_FIRST',
  TP_FIRST: 'TP_FIRST',
  OPEN_PROXIMITY: 'OPEN_PROXIMITY',
});

export const EXECUTION_POLICY = Object.freeze({
  SIMPLIFIED: 'SIMPLIFIED',
  REALISTIC: 'REALISTIC',
});

/**
 * AmbiguityResolver resolves intrabar SL/TP collision when both
 * stop loss and take profit thresholds are reached within a single bar.
 */
export class AmbiguityResolver {
  constructor({ policy = AMBIGUITY_POLICY.CONSERVATIVE, executionPolicy = EXECUTION_POLICY.SIMPLIFIED } = {}) {
    this.policy = policy;
    this.executionPolicy = executionPolicy;
  }

  setPolicy(policy) {
    if (!Object.values(AMBIGUITY_POLICY).includes(policy)) {
      throw new Error(`Invalid ambiguity policy: ${policy}`);
    }
    this.policy = policy;
  }

  setExecutionPolicy(policy) {
    if (!Object.values(EXECUTION_POLICY).includes(policy)) {
      throw new Error(`Invalid execution policy: ${policy}`);
    }
    this.executionPolicy = policy;
  }

  /**
   * Evaluate whether SL, TP, or both are triggered on a candle for a position.
   *
   * @param {object} params
   * @param {object} params.position
   * @param {object} params.candle
   * @param {number} params.candleIndex
   * @returns {{ triggered: boolean, exitReason?: 'STOP_LOSS'|'TAKE_PROFIT', exitPrice?: number, ambiguityResolution: string, isAmbiguous: boolean }}
   */
  evaluate({ position, candle, candleIndex } = {}) {
    if (!position || !candle) {
      return { triggered: false, ambiguityResolution: AMBIGUITY_RESOLUTION.NONE, isAmbiguous: false };
    }

    if (position.openedIndex >= candleIndex) {
      return { triggered: false, ambiguityResolution: AMBIGUITY_RESOLUTION.NONE, isAmbiguous: false };
    }

    const sl = position.stopLossPrice;
    const tp = position.takeProfitPrice;
    const slIdx = position.stopLossCreatedIndex;
    const tpIdx = position.takeProfitCreatedIndex;

    let triggerSL = false;
    let triggerTP = false;

    if (sl != null && Number.isFinite(sl) && slIdx < candleIndex) {
      if (position.side === 'LONG' && candle.low <= sl) triggerSL = true;
      if (position.side === 'SHORT' && candle.high >= sl) triggerSL = true;
    }

    if (tp != null && Number.isFinite(tp) && tpIdx < candleIndex) {
      if (position.side === 'LONG' && candle.high >= tp) triggerTP = true;
      if (position.side === 'SHORT' && candle.low <= tp) triggerTP = true;
    }

    let ambiguityResolution = AMBIGUITY_RESOLUTION.NONE;
    let isAmbiguous = false;

    if (triggerSL && triggerTP) {
      isAmbiguous = true;
      if (this.policy === AMBIGUITY_POLICY.TP_FIRST) {
        ambiguityResolution = AMBIGUITY_RESOLUTION.TP_FIRST;
        triggerSL = false;
      } else if (this.policy === AMBIGUITY_POLICY.OPEN_PROXIMITY && Number.isFinite(candle.open)) {
        ambiguityResolution = AMBIGUITY_RESOLUTION.HEURISTIC_PROXIMITY;
        const slDist = Math.abs(candle.open - sl);
        const tpDist = Math.abs(candle.open - tp);
        if (tpDist < slDist) triggerSL = false;
        else triggerTP = false;
      } else {
        ambiguityResolution = AMBIGUITY_RESOLUTION.SL_FIRST;
        triggerTP = false;
      }
    }

    if (triggerSL) {
      let price = sl;
      if (this.executionPolicy === EXECUTION_POLICY.REALISTIC && Number.isFinite(candle.open)) {
        if (position.side === 'LONG' && candle.open < sl) price = candle.open;
        else if (position.side === 'SHORT' && candle.open > sl) price = candle.open;
      }
      return {
        triggered: true,
        exitReason: 'STOP_LOSS',
        exitPrice: price,
        ambiguityResolution,
        isAmbiguous,
      };
    }

    if (triggerTP) {
      let price = tp;
      if (this.executionPolicy === EXECUTION_POLICY.REALISTIC && Number.isFinite(candle.open)) {
        if (position.side === 'LONG' && candle.open > tp) price = candle.open;
        else if (position.side === 'SHORT' && candle.open < tp) price = candle.open;
      }
      return {
        triggered: true,
        exitReason: 'TAKE_PROFIT',
        exitPrice: price,
        ambiguityResolution,
        isAmbiguous,
      };
    }

    return {
      triggered: false,
      ambiguityResolution: AMBIGUITY_RESOLUTION.NONE,
      isAmbiguous: false,
    };
  }
}
