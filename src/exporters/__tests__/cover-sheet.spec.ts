import { formatCoverDate } from '../cover-sheet';

describe('formatCoverDate', () => {
  it('formats a date as "DD Month YYYY"', () => {
    expect(formatCoverDate(new Date(2026, 3, 30))).toBe('30 April 2026');
  });

  it('uses single-digit days without zero-padding', () => {
    expect(formatCoverDate(new Date(2026, 0, 5))).toBe('5 January 2026');
  });

  it('round-trips all twelve months', () => {
    const months = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December'
    ];
    for (let m = 0; m < 12; m++) {
      expect(formatCoverDate(new Date(2026, m, 15))).toBe(
        `15 ${months[m]} 2026`
      );
    }
  });
});
