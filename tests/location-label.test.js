import { meaningfulLocationLabel } from '../src/utils/location-label.js';

describe('meaningfulLocationLabel', () => {
  test.each(['Ma position', 'Position actuelle', 'current location', '14.72000, -17.49000'])(
    'refuse le faux libellé %s',
    (value) => {
      expect(meaningfulLocationLabel(value)).toBeNull();
    }
  );

  test.each(['Ouakam', 'Grand Dakar, Dakar, Sénégal', 'Thiès'])(
    'conserve la localité lisible %s',
    (value) => {
      expect(meaningfulLocationLabel(value)).toBe(value);
    }
  );
});
