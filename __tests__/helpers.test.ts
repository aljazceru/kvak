import { relativeTime, formatBytes, uid } from '../src/services/helpers';

describe('relativeTime', () => {
  const NOW = 1_700_000_000_000;
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));
  afterEach(() => jest.restoreAllMocks());

  it('under a minute → "just now"', () => {
    expect(relativeTime(NOW - 5_000)).toBe('just now');
  });
  it('minutes → "Xm ago"', () => {
    expect(relativeTime(NOW - 125_000)).toBe('2m ago'); // 125s
  });
  it('hours → "Xh ago"', () => {
    expect(relativeTime(NOW - 3 * 3600_000)).toBe('3h ago');
  });
  it('exactly one day → "yesterday"', () => {
    expect(relativeTime(NOW - 86_400_000)).toBe('yesterday');
  });
  it('two+ days → "Xd ago"', () => {
    expect(relativeTime(NOW - 5 * 86_400_000)).toBe('5d ago');
  });
  it('future/clock-skew clamps to "just now" (no negative bucket)', () => {
    expect(relativeTime(NOW + 30_000)).toBe('just now');
  });
});

describe('formatBytes', () => {
  it('renders KB below 1 MiB', () => {
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(512 * 1024)).toBe('512 KB');
  });
  it('renders MB between 1 MiB and 1 GiB', () => {
    expect(formatBytes(5 * 1048576)).toBe('5 MB');
  });
  it('renders GB with one decimal at/above 1 GiB', () => {
    expect(formatBytes(1.5 * 1073741824)).toBe('1.5 GB');
  });
  it('zero → "0 KB"', () => {
    expect(formatBytes(0)).toBe('0 KB');
  });
});

describe('uid', () => {
  it('produces timestamp_randomstring', () => {
    expect(uid()).toMatch(/^\d+_[a-z0-9]+$/);
  });
  it('stays unique across 1000 rapid calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uid()));
    expect(ids.size).toBe(1000);
  });
});
