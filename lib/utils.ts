import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrencyINR(amount?: number): string {
  if (amount === undefined || amount === null) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDuration(seconds?: number): string {
  if (!seconds && seconds !== 0) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

export function formatDateTime(isoString?: string): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return isoString;
  }
}

export function formatTimeOnly(isoString?: string): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return isoString;
  }
}

/**
 * Standardizes phone numbers into canonical E.164 format.
 * Strips formatting artifacts and safely handles Indian national numbers (10 digits -> +91).
 */
export function normalizePhoneNumber(rawPhone: string): string {
  if (!rawPhone) return '';
  const digitsOnly = rawPhone.replace(/[^\d+]/g, '');
  if (digitsOnly.startsWith('+')) {
    return `+${digitsOnly.slice(1).replace(/\D/g, '')}`;
  }
  const clean = digitsOnly.replace(/\D/g, '');
  if (clean.length === 10) {
    return `+91${clean}`;
  }
  if (clean.length === 11 && clean.startsWith('0')) {
    return `+91${clean.slice(1)}`;
  }
  if (clean.length === 12 && clean.startsWith('91')) {
    return `+${clean}`;
  }
  return clean ? `+${clean}` : '';
}

/**
 * Masks phone number for PII minimization in audit trails.
 * Example: +919811122334 -> +91 98**** 2234
 */
export function formatMaskedPhone(phone?: string | null): string {
  if (!phone) return '—';
  const norm = normalizePhoneNumber(phone);
  if (norm.length >= 10) {
    const start = norm.slice(0, norm.length - 8);
    const mid = '****';
    const end = norm.slice(norm.length - 4);
    return `${start} ${norm.slice(norm.length - 8, norm.length - 6)}${mid} ${end}`;
  }
  return phone.replace(/\d(?=\d{3})/g, '*');
}

