import { describe, it, expect } from 'vitest';
import { PaperTradingEngine, EXECUTION_TIMING } from '../src/trading/PaperTradingEngine.js';
const c=(time,open,high,low,close)=>({time,open,high,low,close,volume:1});
describe('Audited accounting hardening',()=>{
  it('constrains new entries by cross-margin availableMargin',()=>{
    const e=new PaperTradingEngine({startingBalance:10000,feeRate:0,marginRate:0.1,maintMarginRate:0.05,executionTiming:EXECUTION_TIMING.IMMEDIATE_CLOSE});
    e.onMarketCandle({candle:c(0,100,100,100,100),index:0,symbol:'BTCUSD'});
    expect(e.placeOrder({symbol:'BTCUSD',side:'BUY',quantity:100}).success).toBe(true);
    e.onMarketCandle({candle:c(1,50,50,50,50),index:1,symbol:'ETHUSD'});
    const rejected=e.placeOrder({symbol:'ETHUSD',side:'BUY',quantity:1820});
    expect(rejected.success).toBe(false);
    expect(e.getAccountSnapshot().availableMargin).toBe(9000);
  });
  it('prices each crossed funding boundary at its event-time interpolated mark',()=>{
    const e=new PaperTradingEngine({startingBalance:10000,feeRate:0,executionTiming:EXECUTION_TIMING.IMMEDIATE_CLOSE,fundingSchedule:{intervalSec:28800,defaultRate:0.001}});
    e.onMarketCandle({candle:c(0,100,100,100,100),index:0,symbol:'BTCUSD'}); e.placeOrder({symbol:'BTCUSD',side:'BUY',quantity:10});
    e.onMarketCandle({candle:c(86400,200,200,200,200),index:1,symbol:'BTCUSD'});
    const h=e.getFundingHistory(); expect(h.map(x=>x.timestamp)).toEqual([28800,57600,86400]);
    expect(h[0].markPrice).toBeCloseTo(133.333333,5); expect(h[1].markPrice).toBeCloseTo(166.666667,5); expect(h[2].markPrice).toBeCloseTo(200,5); expect(e.getAccountSnapshot().walletBalance).toBeCloseTo(9995,8);
  });
});
