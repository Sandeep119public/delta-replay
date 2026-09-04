import { describe, expect, it } from 'vitest';
import { Order } from '../src/trading/Order.js';

describe('Order id normalization', () => {
  it('normalizes numeric and string ids to one stable string representation', () => {
    expect(new Order({ id: 1 }).id).toBe('1');
    expect(new Order({ id: '1' }).id).toBe('1');
  });
});
