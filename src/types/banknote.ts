export type Denomination = 100 | 500 | 1000 | 2000;

export type BanknoteStatus = 'HELD' | 'SPENT';

export interface Banknote {
  id: string;
  user_id: string;
  serial_number: string;
  denomination: Denomination;
  status: BanknoteStatus;
  note?: string | null;
  scan_image?: string | null;
  created_at: string;
  updated_at?: string;
}

export const SUPPORTED_DENOMINATIONS: readonly Denomination[] = [
  100, 500, 1000, 2000,
] as const;

export const DENOMINATION_STYLES: Record<
  Denomination,
  {
    label: string;
    badgeBg: string;
    badgeText: string;
    border: string;
    activeRing: string;
  }
> = {
  100: {
    label: '100 TWD',
    badgeBg: 'bg-rose-500/15',
    badgeText: 'text-rose-400',
    border: 'border-rose-500/30',
    activeRing: 'ring-2 ring-rose-500 bg-rose-500/20 text-rose-200 border-rose-400',
  },
  500: {
    label: '500 TWD',
    badgeBg: 'bg-amber-500/15',
    badgeText: 'text-amber-400',
    border: 'border-amber-500/30',
    activeRing: 'ring-2 ring-amber-500 bg-amber-500/20 text-amber-200 border-amber-400',
  },
  1000: {
    label: '1.000 TWD',
    badgeBg: 'bg-sky-500/15',
    badgeText: 'text-sky-400',
    border: 'border-sky-500/30',
    activeRing: 'ring-2 ring-sky-500 bg-sky-500/20 text-sky-200 border-sky-400',
  },
  2000: {
    label: '2.000 TWD',
    badgeBg: 'bg-purple-500/15',
    badgeText: 'text-purple-400',
    border: 'border-purple-500/30',
    activeRing: 'ring-2 ring-purple-500 bg-purple-500/20 text-purple-200 border-purple-400',
  },
};

export function normalizeSerialNumber(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatTWD(amount: number): string {
  return new Intl.NumberFormat('vi-VN').format(amount) + ' TWD';
}

export function formatDateTimeVN(isoString?: string): string {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  } catch {
    return '';
  }
}
