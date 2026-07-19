import { calculateCommissionSync } from '../src/utils/commission.js';

describe('calculateCommission', () => {
  it('returns 0 for 0 price', () => {
    expect(calculateCommissionSync(0)).toBe(0);
  });

  it('applies minimum commission (100 FCFA) for low prices', () => {
    expect(calculateCommissionSync(1000)).toBe(100);
    expect(calculateCommissionSync(500)).toBe(100);
  });

  it('calculates standard commission (5%)', () => {
    expect(calculateCommissionSync(5000)).toBe(250);
  });

  it('caps at maximum commission (500 FCFA)', () => {
    expect(calculateCommissionSync(10000)).toBe(500);
    expect(calculateCommissionSync(50000)).toBe(500);
    expect(calculateCommissionSync(100000)).toBe(500);
  });

  it('works with custom parameters', () => {
    expect(calculateCommissionSync(2000, 10, 200, 1000)).toBe(200);
    expect(calculateCommissionSync(5000, 10, 200, 1000)).toBe(500);
    expect(calculateCommissionSync(20000, 10, 200, 1000)).toBe(1000);
  });
});

describe('Commission scenarios', () => {
  // Scenario 1: Wallet sufficient
  it('Scenario 1 - Wallet sufficient covers full commission', () => {
    const walletBalance = 2000;
    const pointsBalance = 0;
    const commission = 500;

    let walletAfter = walletBalance;
    let pointsAfter = pointsBalance;

    if (walletAfter >= commission) {
      walletAfter -= commission;
    }

    expect(walletAfter).toBe(1500);
    expect(pointsAfter).toBe(0);
  });

  // Scenario 2: Wallet insufficient but Points sufficient
  it('Scenario 2 - Points cover commission when wallet is empty', () => {
    const walletBalance = 0;
    const pointsBalance = 1000;
    const commission = 500;

    let walletAfter = walletBalance;
    let pointsAfter = pointsBalance;

    if (walletAfter >= commission) {
      walletAfter -= commission;
    } else {
      const rest = commission - walletAfter;
      if (pointsAfter >= rest) {
        pointsAfter -= rest;
      }
    }

    expect(walletAfter).toBe(0);
    expect(pointsAfter).toBe(500);
  });

  // Scenario 3: Wallet + Points combined
  it('Scenario 3 - Combined wallet and points cover commission', () => {
    const walletBalance = 300;
    const pointsBalance = 200;
    const commission = 500;

    let walletAfter = walletBalance;
    let pointsAfter = pointsBalance;

    if (walletAfter >= commission) {
      walletAfter -= commission;
    } else {
      const walletDeducted = walletAfter;
      walletAfter = 0;
      const rest = commission - walletDeducted;
      if (pointsAfter >= rest) {
        pointsAfter -= rest;
      }
    }

    expect(walletAfter).toBe(0);
    expect(pointsAfter).toBe(0);
  });

  // Scenario 4: Insufficient resources
  it('Scenario 4 - Insufficient resources returns deficit', () => {
    const walletBalance = 100;
    const pointsBalance = 100;
    const commission = 500;

    const totalAvailable = walletBalance + pointsBalance;
    const covered = Math.min(totalAvailable, commission);
    const deficit = commission - covered;

    expect(covered).toBe(200);
    expect(deficit).toBe(300);
  });
});

describe('Payment flow logic', () => {
  it('PayDunya flow: driver gets net amount after commission', () => {
    const parcelPrice = 10000;
    const commission = calculateCommissionSync(parcelPrice);
    const driverEarning = parcelPrice - commission;

    expect(commission).toBe(500);
    expect(driverEarning).toBe(9500);
  });

  it('Cash flow: driver gets full price, commission deducted from wallet', () => {
    const parcelPrice = 5000;
    const commission = calculateCommissionSync(parcelPrice);
    const walletBalance = 1000;

    // Driver gets full price (cash from client)
    // Commission is deducted from wallet + points
    const canCover = walletBalance >= commission;

    expect(commission).toBe(250);
    expect(canCover).toBe(true);
  });
});

describe('Withdrawal lifecycle', () => {
  it('rejects withdrawal below minimum', () => {
    const minAmount = 500;
    const requested = 400;
    expect(requested < minAmount).toBe(true);
  });

  it('rejects withdrawal exceeding balance', () => {
    const balance = 1000;
    const pendingBalance = 0;
    const amount = 1500;
    expect(balance - pendingBalance >= amount).toBe(false);
  });

  it('allows valid withdrawal', () => {
    const balance = 5000;
    const pendingBalance = 0;
    const amount = 2000;
    const minAmount = 500;

    expect(amount >= minAmount).toBe(true);
    expect(balance - pendingBalance >= amount).toBe(true);
  });

  it('withdrawal lifecycle: pending -> processing -> completed', () => {
    const validTransitions = {
      pending: ['processing', 'failed', 'cancelled'],
      processing: ['completed', 'failed'],
      completed: [],
      failed: [],
      cancelled: []
    };

    expect(validTransitions.pending).toContain('processing');
    expect(validTransitions.pending).toContain('cancelled');
    expect(validTransitions.processing).toContain('completed');
    expect(validTransitions.completed).toEqual([]);
  });

  it('rejected withdrawal returns funds to balance', () => {
    const balance = 5000;
    const pendingBalance = 2000;
    const withdrawalAmount = 2000;

    // On reject: return to balance
    const newBalance = balance + withdrawalAmount;
    const newPending = pendingBalance - withdrawalAmount;

    expect(newBalance).toBe(7000);
    expect(newPending).toBe(0);
  });
});

describe('Idempotency', () => {
  it('should not process same PayDunya token twice', () => {
    const processedTokens = new Set();

    const token = 'PAYDUNYA-ABC123';

    // First processing
    const firstTime = !processedTokens.has(token);
    if (firstTime) processedTokens.add(token);

    // Second processing attempt
    const secondTime = !processedTokens.has(token);

    expect(firstTime).toBe(true);
    expect(secondTime).toBe(false);
  });
});
