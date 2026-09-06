import { describe, expect, it } from 'vitest';
import { Order } from '../src/trading/Order.js';
import { PaperTradingEngine } from '../src/trading/PaperTradingEngine.js';

describe('Order id normalization', () => {
  it('normalizes numeric and string ids to one stable string representation', () => {
    expect(new Order({ id: 1 }).id).toBe('1');
    expect(new Order({ id: '1' }).id).toBe('1');
  });

  it('accepts numeric and string forms when retrieving canonical engine order ids', () => {
    const engine = new PaperTradingEngine();
    const id = engine._nextOrderId++;
    const order = new Order({ id, symbol: 'BTCUSD', side: 'LONG', type: 'LIMIT', quantity: 1, price: 100 });
    engine._orders.set(order.id, order);
    expect(engine.getOrder(id)?.id).toBe(String(id));
    expect(engine.getOrder(String(id))?.id).toBe(String(id));
  });

  it('removes a pending order when cancelled using a numeric id', () => {
    const engine = new PaperTradingEngine();
    const order = new Order({ id: 7, symbol: 'BTCUSD', side: 'LONG', type: 'LIMIT', quantity: 1, price: 100, status: 'PENDING' });
    engine._orders.set(order.id, order);
    engine._pendingOrderIds.push(order.id);
    engine.cancelOrder(7);
    expect(engine._pendingOrderIds).not.toContain(order.id);
  });
});
