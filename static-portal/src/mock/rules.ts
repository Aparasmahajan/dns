/** Rules shared with the real portal (ported from the Spring Boot backend so both behave the same). */
import { badRequest } from './errors';
import type { MappingType, RecordType } from '../types';

// ---------------------------------------------------------------- small helpers

/** Like the backend's Maps.of: drops null / undefined values. */
export function m(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
}

export function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const t = value.trim();
  return t.length > max ? t.slice(0, max) : t;
}

export const contains = (haystack: string | null | undefined, needle: string) => (haystack ?? '').toLowerCase().includes(needle.toLowerCase());

export interface Page<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export function paginate<T>(items: T[], rawPage: unknown, rawSize: unknown, defaultSize: number): Page<T> {
  const page = Math.max(0, Number.parseInt(String(rawPage ?? '0'), 10) || 0);
  const size = Math.min(200, Math.max(1, Number.parseInt(String(rawSize ?? defaultSize), 10) || defaultSize));
  return {
    content: items.slice(page * size, page * size + size),
    page,
    size,
    totalElements: items.length,
    totalPages: Math.ceil(items.length / size),
  };
}

// ---------------------------------------------------------------- versions (10 = v1.0, 11 = v1.1 ...)

export const FIRST_REVISION = 10;

export function formatVersion(revision: number | null | undefined): string | null {
  if (revision === null || revision === undefined) return null;
  return `${Math.floor(revision / 10)}.${revision % 10}`;
}

export function parseVersion(version: string | null | undefined): number | null {
  if (!version) return null;
  const v = version.trim().replace(/^[vV]/, '');
  if (!/^\d{1,6}\.\d$/.test(v)) return null;
  const [major, minor] = v.split('.');
  return Number(major) * 10 + Number(minor);
}

// ---------------------------------------------------------------- names

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** F5 BIG-IP partition naming rule. */
export const PARTITION_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

export const normalizeUsername = (u: unknown) => (typeof u === 'string' ? u.trim().toLowerCase() : '');

// ---------------------------------------------------------------- password policy (Bank IS policy placeholder)

export const PASSWORD_MIN_LENGTH = 12;

export function checkPassword(password: unknown, username: string | null): string {
  if (typeof password !== 'string') throw badRequest('Enter a new password.');
  const missing: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) missing.push(`at least ${PASSWORD_MIN_LENGTH} characters`);
  if (!/[A-Z]/.test(password)) missing.push('an upper-case letter');
  if (!/[a-z]/.test(password)) missing.push('a lower-case letter');
  if (!/\d/.test(password)) missing.push('a digit');
  if (/^[\p{L}\p{N}]*$/u.test(password)) missing.push('a special character');
  if (missing.length) throw badRequest(`Password needs ${missing.join(', ')}.`);
  if (password.length > 128) throw badRequest('Password can be at most 128 characters.');
  if (username && password.toLowerCase().includes(username.toLowerCase())) throw badRequest('Password must not contain the username.');
  return password;
}

export function temporaryPassword(): string {
  const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const LOWER = 'abcdefghijkmnopqrstuvwxyz';
  const DIGITS = '23456789';
  const SPECIAL = '!@#$%^&*-_=+?';
  const rnd = (n: number) => {
    const a = new Uint32Array(1);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a);
    else a[0] = Math.floor(Math.random() * 2 ** 32);
    return a[0] % n;
  };
  const pick = (s: string) => s[rnd(s.length)];
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SPECIAL)];
  const all = UPPER + LOWER + DIGITS + SPECIAL;
  while (chars.length < 16) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// ---------------------------------------------------------------- DNS record validation (DnsValidator)

export const MIN_TTL = 60;
export const MAX_TTL = 86_400;
export const DEFAULT_TTL = 3_600;
const MAX_IPS = 32;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export interface RecordSpecInput {
  mappingType?: MappingType;
  domain?: string;
  ips?: string[];
  ttl?: number | null;
}

/** A validated, normalised record definition. */
export interface DnsSpec {
  recordType: RecordType;
  mappingType: MappingType;
  domain: string;
  ips: string[];
  ttl: number;
  key: string;
  ptrName: string | null;
}

export function validateSpec(input: RecordSpecInput | null | undefined): DnsSpec {
  if (!input || !input.mappingType) throw badRequest('Choose a mapping type: one-to-one, one-to-many or PTR.');
  const errors: string[] = [];
  const domain = normaliseDomain(input.domain, errors);
  const ips = normaliseIps(input.ips, errors);
  switch (input.mappingType) {
    case 'SINGLE':
      if (ips.length !== 1) errors.push('A one-to-one mapping needs exactly one IP address.');
      break;
    case 'MULTI':
      if (ips.length < 2) errors.push('A one-to-many mapping needs at least two IP addresses.');
      else if (ips.length > MAX_IPS) errors.push(`A record can have at most ${MAX_IPS} IP addresses.`);
      break;
    case 'PTR':
      if (ips.length !== 1) errors.push('A PTR record needs exactly one IP address.');
      break;
    default:
      throw badRequest('Choose a mapping type: one-to-one, one-to-many or PTR.');
  }
  const ttl = input.ttl === null || input.ttl === undefined ? DEFAULT_TTL : Number(input.ttl);
  if (!Number.isInteger(ttl) || ttl < MIN_TTL || ttl > MAX_TTL) errors.push(`TTL must be between ${MIN_TTL} and ${MAX_TTL} seconds.`);
  if (errors.length) throw badRequest(errors.join(' '));

  const recordType: RecordType = input.mappingType === 'PTR' ? 'PTR' : 'A';
  const key = recordType === 'A' ? domain : ips[0];
  const ptrName = recordType === 'PTR' ? reverseName(ips[0]) : null;
  return { recordType, mappingType: input.mappingType, domain, ips, ttl, key, ptrName };
}

export function reverseName(ip: string): string {
  const p = ip.split('.');
  return `${p[3]}.${p[2]}.${p[1]}.${p[0]}.in-addr.arpa`;
}

function normaliseDomain(raw: unknown, errors: string[]): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    errors.push('Enter a domain name.');
    return '';
  }
  let domain = raw.trim().toLowerCase();
  if (domain.endsWith('.')) domain = domain.slice(0, -1);
  if (domain.length > 253) {
    errors.push('A domain name can be at most 253 characters.');
    return domain;
  }
  const labels = domain.split('.');
  if (labels.length < 2) {
    errors.push('Enter a fully qualified domain name, for example app.example.com.');
    return domain;
  }
  for (const label of labels) {
    if (!LABEL.test(label)) {
      errors.push(
        `'${raw.trim()}' is not a valid domain name. Use letters, digits and hyphens; each part is 1–63 characters and cannot start or end with a hyphen.`,
      );
      return domain;
    }
  }
  if (/^\d+$/.test(labels[labels.length - 1])) errors.push('The last part of a domain name cannot be only digits.');
  return domain;
}

function normaliseIps(raw: unknown, errors: string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const ip = value.trim();
    if (!IPV4.test(ip)) errors.push(`'${ip}' is not a valid IPv4 address.`);
    else if (ip === '0.0.0.0' || ip === '255.255.255.255') errors.push(`${ip} cannot be used as a record address.`);
    else if (seen.has(ip)) errors.push(`${ip} is listed more than once.`);
    else seen.add(ip);
  }
  const numeric = (ip: string) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
  return [...seen].sort((a, b) => numeric(a) - numeric(b));
}

export function specToMap(spec: DnsSpec): Record<string, unknown> {
  return m({ recordType: spec.recordType, mappingType: spec.mappingType, domain: spec.domain, ips: [...spec.ips], ttl: spec.ttl, ptrName: spec.ptrName });
}

export function specFromMap(map: Record<string, unknown>): DnsSpec {
  const recordType = String(map.recordType) as RecordType;
  const mappingType = String(map.mappingType) as MappingType;
  const ips = Array.isArray(map.ips) ? map.ips.map(String) : [];
  const domain = String(map.domain);
  return {
    recordType,
    mappingType,
    domain,
    ips,
    ttl: Number(map.ttl),
    key: recordType === 'A' ? domain : ips[0],
    ptrName: map.ptrName ? String(map.ptrName) : null,
  };
}

/** True when the spec would not change the record (IP order does not matter). */
export function sameAs(spec: DnsSpec, r: { mappingType: MappingType; domain: string; ips: string[]; ttl: number }): boolean {
  const a = new Set(spec.ips);
  return spec.mappingType === r.mappingType && spec.domain === r.domain && a.size === r.ips.length && r.ips.every((ip) => a.has(ip)) && spec.ttl === r.ttl;
}
