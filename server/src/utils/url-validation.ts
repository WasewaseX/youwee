export const ALLOWED_PROTOCOLS = ['http:', 'https:'] as const;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
]);

const BLOCKED_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '127.0.0.0/8',
  '::1/128',
  'fe80::/10',
  'fc00::/7',
  '100.64.0.0/10',
];

const CLOUD_METADATA_IPS = ['169.254.169.254', '169.254.169.254'];

function ipToNumber(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function cidrToRange(cidr: string): { start: number; end: number } | null {
  const [ip, bits] = cidr.split('/');
  if (!ip || !bits) return null;
  const mask = ~((1 << (32 - parseInt(bits, 10))) - 1);
  const start = ipToNumber(ip) & mask;
  const end = start | (~mask >>> 0);
  return { start, end };
}

const CIDR_RANGES = BLOCKED_CIDRS.map(cidrToRange).filter(
  (r): r is { start: number; end: number } => r !== null,
);

function isPrivateIp(ip: string): boolean {
  const num = ipToNumber(ip);
  return CIDR_RANGES.some((range) => num >= range.start && num <= range.end);
}

async function resolveHostname(hostname: string): Promise<string[]> {
  try {
    const { promises: dns } = await import('node:dns');
    const result = await dns.resolve4(hostname);
    return result;
  } catch {
    return [];
  }
}

export async function validateUrl(urlString: string): Promise<{ valid: boolean; error?: string }> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (!ALLOWED_PROTOCOLS.includes(url.protocol as 'http:' | 'https:')) {
    return {
      valid: false,
      error: `Protocol ${url.protocol} not allowed. Only http: and https: are permitted.`,
    };
  }

  const hostname = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, error: 'Access to localhost addresses is not permitted' };
  }

  if (CLOUD_METADATA_IPS.includes(hostname)) {
    return { valid: false, error: 'Access to cloud metadata endpoints is not permitted' };
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (isPrivateIp(hostname)) {
      return { valid: false, error: 'Access to private IP ranges is not permitted' };
    }
    return { valid: true };
  }

  const ips = await resolveHostname(hostname);
  for (const ip of ips) {
    if (isPrivateIp(ip) || CLOUD_METADATA_IPS.includes(ip)) {
      return { valid: false, error: 'Hostname resolves to a blocked IP address' };
    }
  }

  return { valid: true };
}

export function validateUrlSync(urlString: string): { valid: boolean; error?: string } {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (!ALLOWED_PROTOCOLS.includes(url.protocol as 'http:' | 'https:')) {
    return {
      valid: false,
      error: `Protocol ${url.protocol} not allowed. Only http: and https: are permitted.`,
    };
  }

  const hostname = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, error: 'Access to localhost addresses is not permitted' };
  }

  if (CLOUD_METADATA_IPS.includes(hostname)) {
    return { valid: false, error: 'Access to cloud metadata endpoints is not permitted' };
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (isPrivateIp(hostname)) {
      return { valid: false, error: 'Access to private IP ranges is not permitted' };
    }
    return { valid: true };
  }

  return { valid: true };
}
