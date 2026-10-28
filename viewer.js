// ERC-8004 identity and reputation viewer logic. Pure ES module: browser and Node 20, no dependency.
import { hexToBytes, num, stringAt, addressAt, int256, staticArrayAt, stringArrayAt, word, encUint, encBool, encodeCall, encStringTail, encAddressArrayTail } from './abi.js';
import { IPFS_GATEWAY } from './config.js';

export const SEL = { ownerOf: '0x6352211e', tokenURI: '0xc87b56dd', getClients: '0x42dd519c', readAllFeedback: '0xd9d84224' };
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const plain = (e) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
/** A revert: JSON-RPC code 3, or a message that says revert. */
export function isRevert(e) {
  return !!e && (e.code === 3 || /revert/i.test(plain(e)));
}

/** Maps ipfs:// to an https gateway; other URIs unchanged. */
export function resolveUri(uri, gateway = IPFS_GATEWAY) {
  if (uri.startsWith('ipfs://')) return gateway.replace(/\/?$/, '/') + uri.slice('ipfs://'.length).replace(/^ipfs\//, '');
  return uri;
}

/** Decodes a data:application/json URI (base64 or percent encoded) without a request. */
export function decodeDataUri(uri) {
  const m = /^data:application\/json(;[^,]*)?,(.*)$/s.exec(uri);
  if (!m) throw new Error('unsupported data: URI (only application/json)');
  const params = (m[1] || '').toLowerCase();
  let text;
  if (params.includes(';base64')) {
    const bin = globalThis.atob(m[2].trim());
    text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } else text = decodeURIComponent(m[2]);
  return JSON.parse(text);
}

/** Reads the registration file from a tokenURI. */
export async function readRegistration(tokenURI, fetchJson, gateway) {
  if (!tokenURI) throw new Error('the agent has no tokenURI');
  if (tokenURI.startsWith('data:')) return decodeDataUri(tokenURI);
  return fetchJson(resolveUri(tokenURI, gateway));
}

const call = (rpc, to, data) => rpc('eth_call', [{ to, data }, 'latest']);

/** Decodes readAllFeedback outputs. */
export function decodeFeedback(hex) {
  const b = hexToBytes(hex);
  const at = (i) => num(b, i * 32);
  const clients = staticArrayAt(b, at(0), addressAt);
  const values = staticArrayAt(b, at(2), int256);
  const decimals = staticArrayAt(b, at(3), (bb, o) => Number(word(bb, o)));
  const tag1s = stringArrayAt(b, at(4));
  const tag2s = stringArrayAt(b, at(5));
  const revoked = staticArrayAt(b, at(6), (bb, o) => word(bb, o) !== 0n);
  return clients.map((client, i) => ({ client, value: values[i], decimals: decimals[i], tag1: tag1s[i], tag2: tag2s[i], revoked: revoked[i] }));
}

/** value / 10^decimals as a Number (scores are small). */
export function toScore(value, decimals) {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const d = 10n ** BigInt(decimals);
  const s = Number(v / d) + Number(v % d) / Number(d);
  return neg ? -s : s;
}

export async function readFeedback({ agentId, reputationRegistry, rpc }) {
  const id = encUint(agentId);
  const clientsHex = await call(rpc, reputationRegistry, SEL.getClients + id);
  const cb = hexToBytes(clientsHex);
  const clients = staticArrayAt(cb, num(cb, 0), addressAt);
  if (clients.length === 0) return { count: 0, average: null, items: [] };
  const data = encodeCall(SEL.readAllFeedback, [
    { static: id },
    { dynamic: encAddressArrayTail(clients) },
    { dynamic: encStringTail('') },
    { dynamic: encStringTail('') },
    { static: encBool(false) },
  ]);
  const rows = decodeFeedback(await call(rpc, reputationRegistry, data)).filter((r) => !r.revoked);
  const items = rows.map((r) => ({ client: r.client, score: toScore(r.value, r.decimals), tags: [r.tag1, r.tag2].filter(Boolean) }));
  const average = items.length ? Math.round((items.reduce((a, x) => a + x.score, 0) / items.length) * 100) / 100 : null;
  return { count: items.length, average, items: items.reverse() }; // latest first
}

/**
 * Loads an agent's identity, registration file and reputation. Never throws.
 * @param {{agentId: string|number|bigint, network: string, identityRegistry: string, reputationRegistry?: string, rpc: (method: string, params: unknown[]) => Promise<string>, fetchJson: (url: string) => Promise<any>, gateway?: string}} args
 */
export async function loadAgent({ agentId, network, identityRegistry, reputationRegistry, rpc, fetchJson, gateway }) {
  const base = { status: 'error', agentId: String(agentId), network, owner: null, tokenURI: null, registration: null, feedback: null };
  let id;
  try {
    id = BigInt(agentId);
    if (id < 0n) throw new Error();
  } catch {
    return { ...base, error: 'the agent id must be a whole number' };
  }
  base.agentId = id.toString();
  let owner;
  try {
    const out = await call(rpc, identityRegistry, SEL.ownerOf + encUint(id));
    owner = addressAt(hexToBytes(out), 0);
  } catch (e) {
    if (isRevert(e)) return { ...base, status: 'empty', error: `no agent ${id} on this registry` };
    return { ...base, error: `the RPC call failed: ${plain(e)}` };
  }
  if (owner === ZERO_ADDRESS) return { ...base, status: 'empty', error: `no agent ${id} on this registry` };
  base.owner = owner;
  try {
    const out = await call(rpc, identityRegistry, SEL.tokenURI + encUint(id));
    const b = hexToBytes(out);
    base.tokenURI = stringAt(b, num(b, 0));
  } catch (e) {
    return { ...base, error: `could not read the tokenURI: ${plain(e)}` };
  }
  try {
    base.registration = await readRegistration(base.tokenURI, fetchJson, gateway);
  } catch (e) {
    return { ...base, error: `could not read the registration file: ${plain(e)}` };
  }
  if (reputationRegistry) {
    try {
      base.feedback = await readFeedback({ agentId: id, reputationRegistry, rpc });
    } catch (e) {
      return { ...base, error: `could not read the reputation: ${plain(e)}` };
    }
  }
  return { ...base, status: 'ok' };
}

/** fetch based helpers for the page. */
export function httpRpc(url, fetchFn = globalThis.fetch) {
  let n = 0;
  return async (method, params) => {
    const res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }) });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw Object.assign(new Error(j.error.message || 'RPC error'), { code: j.error.code });
    return j.result;
  };
}
export function httpJson(fetchFn = globalThis.fetch) {
  return async (url) => {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  };
}
