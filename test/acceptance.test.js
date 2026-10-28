import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeAbiParameters, parseAbiParameters, decodeFunctionData, parseAbi } from 'viem';
import { loadAgent, resolveUri, decodeDataUri, httpRpc, httpJson, SEL, toScore } from '../viewer.js';
import { REGISTRIES, NETWORKS } from '../config.js';

const ID_REG = '0x00000000000000000000000000000000000000aa';
const REP_REG = '0x00000000000000000000000000000000000000bb';
const OWNER = '0x1111111111111111111111111111111111111111';
const REG = { type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'Astra Data', description: 'Paid market data', image: 'ipfs://bafyimg', endpoints: [{ name: 'A2A', endpoint: 'https://astra.example/a2a' }], supportedTrust: ['reputation'] };
const abi = parseAbi(['function ownerOf(uint256) view returns (address)', 'function tokenURI(uint256) view returns (string)', 'function getClients(uint256) view returns (address[])', 'function readAllFeedback(uint256,address[],string,string,bool) view returns (address[],uint64[],int128[],uint8[],string[],string[],bool[])']);
const revert = () => Object.assign(new Error('execution reverted: ERC721NonexistentToken'), { code: 3 });

function chain({ owner = OWNER, tokenURI = 'ipfs://bafyreg', clients = [], feedback = null, ownerError, uriError } = {}) {
  const calls = [];
  const rpc = async (method, [tx]) => {
    assert.equal(method, 'eth_call');
    const { functionName, args } = decodeFunctionData({ abi, data: tx.data });
    calls.push({ to: tx.to, functionName, args });
    if (functionName === 'ownerOf') { if (ownerError) throw ownerError(); return encodeAbiParameters(parseAbiParameters('address'), [owner]); }
    if (functionName === 'tokenURI') { if (uriError) throw uriError(); return encodeAbiParameters(parseAbiParameters('string'), [tokenURI]); }
    if (functionName === 'getClients') return encodeAbiParameters(parseAbiParameters('address[]'), [clients]);
    if (functionName === 'readAllFeedback') {
      assert.deepEqual(args[1].map((a) => a.toLowerCase()), clients.map((c) => c.toLowerCase()));
      const f = feedback ?? [];
      return encodeAbiParameters(parseAbiParameters('address[],uint64[],int128[],uint8[],string[],string[],bool[]'), [f.map((x) => x.client), f.map((_, i) => BigInt(i + 1)), f.map((x) => x.value), f.map((x) => x.decimals ?? 0), f.map((x) => x.tag1 ?? ''), f.map((x) => x.tag2 ?? ''), f.map((x) => x.revoked ?? false)]);
    }
    throw new Error('unexpected ' + functionName);
  };
  return { rpc, calls };
}
const files = (map) => { const seen = []; return { seen, fetchJson: async (u) => { seen.push(u); if (!(u in map)) throw new Error('HTTP 404'); return structuredClone(map[u]); } }; };
const args = (c, f, extra = {}) => ({ agentId: 7, network: 'base', identityRegistry: ID_REG, rpc: c.rpc, fetchJson: f.fetchJson, ...extra });
const replay = (fx) => ({
  rpc: async (_m, [tx]) => { const hit = fx.calls.find((c) => c.to.toLowerCase() === tx.to.toLowerCase() && c.data === tx.data); if (!hit) throw new Error('no recording'); return hit.result; },
  fetchJson: async (u) => { if (!(u in fx.files)) throw new Error('no recording ' + u); return fx.files[u]; },
});

test('A1 an existing agent shows its owner, tokenURI and registration file', async () => {
  const c = chain({ tokenURI: 'https://astra.example/agent.json' });
  const f = files({ 'https://astra.example/agent.json': REG });
  const r = await loadAgent(args(c, f));
  assert.equal(r.status, 'ok');
  assert.equal(r.agentId, '7');
  assert.equal(r.owner, OWNER);
  assert.equal(r.tokenURI, 'https://astra.example/agent.json');
  assert.deepEqual(r.registration, REG);
  assert.equal(r.feedback, null, 'no reputation registry given');
  assert.deepEqual(c.calls.map((x) => [x.to, x.functionName, x.args[0]]), [[ID_REG, 'ownerOf', 7n], [ID_REG, 'tokenURI', 7n]]);
  // a recorded real agent on Base (agent 5, recorded 28 Oct 2026)
  const fx = JSON.parse(readFileSync(new URL('./fixtures/base-agent-5.json', import.meta.url), 'utf8'));
  const rr = await loadAgent({ agentId: 5, network: 'base', identityRegistry: REGISTRIES.base.identity, reputationRegistry: REGISTRIES.base.reputation, ...replay(fx) });
  assert.equal(rr.status, 'ok');
  assert.equal(rr.owner, fx.expected.owner);
  assert.equal(rr.registration.name, fx.expected.name);
});

test('A2 ipfs:// and data: tokenURIs are read correctly', async () => {
  let f = files({ 'https://ipfs.io/ipfs/bafyreg': REG });
  let r = await loadAgent(args(chain({ tokenURI: 'ipfs://bafyreg' }), f));
  assert.equal(r.status, 'ok');
  assert.deepEqual(f.seen, ['https://ipfs.io/ipfs/bafyreg']);
  f = files({ 'https://gw.example/ipfs/bafyreg': REG });
  r = await loadAgent(args(chain({ tokenURI: 'ipfs://ipfs/bafyreg' }), f, { gateway: 'https://gw.example/ipfs' }));
  assert.deepEqual(f.seen, ['https://gw.example/ipfs/bafyreg']);

  const b64 = 'data:application/json;base64,' + Buffer.from(JSON.stringify(REG)).toString('base64');
  f = files({});
  r = await loadAgent(args(chain({ tokenURI: b64 }), f));
  assert.deepEqual(r.registration, REG);
  assert.equal(f.seen.length, 0, 'no request for data: URIs');
  const plainUri = 'data:application/json,' + encodeURIComponent(JSON.stringify(REG));
  r = await loadAgent(args(chain({ tokenURI: plainUri }), f));
  assert.deepEqual(r.registration, REG);
  const utf = 'data:application/json;charset=utf-8;base64,' + Buffer.from(JSON.stringify({ name: 'Agent é ✓' })).toString('base64');
  assert.equal(decodeDataUri(utf).name, 'Agent é ✓');
  assert.equal(resolveUri('https://x/y'), 'https://x/y');
  assert.throws(() => decodeDataUri('data:text/plain,hi'), /application\/json/);
  // the recorded real Base Sepolia agent 1 has a base64 data: tokenURI
  const fx = JSON.parse(readFileSync(new URL('./fixtures/base-sepolia-agent-1.json', import.meta.url), 'utf8'));
  assert.match(fx.expected.tokenURI, /^data:application\/json;base64,/);
  const rr = await loadAgent({ agentId: 1, network: 'base-sepolia', identityRegistry: REGISTRIES['base-sepolia'].identity, ...replay(fx) });
  assert.equal(rr.registration.name, fx.expected.name);
});

test('A3 a missing agent is a clear empty state, failures a clear error state, nothing throws', async () => {
  const f = files({ 'https://ipfs.io/ipfs/bafyreg': REG });
  let r = await loadAgent(args(chain({ ownerError: revert }), f));
  assert.equal(r.status, 'empty');
  assert.match(r.error, /no agent 7/);
  r = await loadAgent(args(chain({ ownerError: () => new Error('ERC721: invalid token ID, execution reverted') }), f));
  assert.equal(r.status, 'empty');
  r = await loadAgent(args(chain({ owner: '0x0000000000000000000000000000000000000000' }), f));
  assert.equal(r.status, 'empty');
  r = await loadAgent(args(chain({ ownerError: () => Object.assign(new Error('rate limited'), { code: -32005 }) }), f));
  assert.equal(r.status, 'error');
  assert.match(r.error, /the RPC call failed: rate limited/);
  r = await loadAgent(args(chain({ uriError: () => new Error('timeout') }), f));
  assert.equal(r.status, 'error');
  assert.equal(r.owner, OWNER);
  assert.match(r.error, /tokenURI: timeout/);
  r = await loadAgent(args(chain({ tokenURI: 'ipfs://missing' }), f));
  assert.equal(r.status, 'error');
  assert.match(r.error, /registration file: HTTP 404/);
  r = await loadAgent(args(chain({ tokenURI: 'data:application/json;base64,!!!' }), f));
  assert.equal(r.status, 'error');
  r = await loadAgent(args(chain({ tokenURI: '' }), f));
  assert.match(r.error, /no tokenURI/);
  r = await loadAgent(args(chain(), f, { agentId: 'abc' }));
  assert.equal(r.status, 'error');
  assert.match(r.error, /whole number/);
  r = await loadAgent(args(chain(), f, { agentId: -1 }));
  assert.equal(r.status, 'error');
  r = await loadAgent(args(chain(), f, { rpc: async () => { throw 'string thrown'; } }));
  assert.equal(r.status, 'error');
});

test('A4 reputation is read and summarised; an agent without feedback says so', async () => {
  const clients = ['0x2222222222222222222222222222222222222222', '0x3333333333333333333333333333333333333333'];
  const feedback = [
    { client: clients[0], value: 90n, tag1: 'quality' },
    { client: clients[1], value: 755n, decimals: 1, tag1: 'speed', tag2: 'x402' },
    { client: clients[0], value: 10n, revoked: true },
    { client: clients[1], value: -20n },
  ];
  const f = files({ 'https://ipfs.io/ipfs/bafyreg': REG });
  const c = chain({ clients, feedback });
  const r = await loadAgent(args(c, f, { reputationRegistry: REP_REG }));
  assert.equal(r.status, 'ok');
  assert.equal(r.feedback.count, 3, 'revoked left out');
  assert.equal(r.feedback.average, 48.5);
  assert.deepEqual(r.feedback.items[0], { client: clients[1], score: -20, tags: [] }, 'latest first');
  assert.deepEqual(r.feedback.items[1], { client: clients[1], score: 75.5, tags: ['speed', 'x402'] });
  assert.deepEqual(c.calls.slice(2).map((x) => [x.to, x.functionName]), [[REP_REG, 'getClients'], [REP_REG, 'readAllFeedback']]);
  const none = await loadAgent(args(chain({ clients: [] }), f, { reputationRegistry: REP_REG }));
  assert.deepEqual(none.feedback, { count: 0, average: null, items: [] });
  assert.equal(toScore(-1505n, 2), -15.05);
  // the recorded real agent on Base Sepolia has 74 feedback entries
  const fx = JSON.parse(readFileSync(new URL('./fixtures/base-sepolia-agent-1.json', import.meta.url), 'utf8'));
  const rr = await loadAgent({ agentId: 1, network: 'base-sepolia', identityRegistry: REGISTRIES['base-sepolia'].identity, reputationRegistry: REGISTRIES['base-sepolia'].reputation, ...replay(fx) });
  assert.equal(rr.feedback.count, fx.expected.count);
  assert.equal(rr.feedback.average, fx.expected.average);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /No feedback yet\./);
});

test('A5 works on Base and Base Sepolia with the registries named in config.js', async () => {
  assert.deepEqual(Object.keys(REGISTRIES).sort(), ['base', 'base-sepolia']);
  for (const n of ['base', 'base-sepolia']) {
    for (const k of ['identity', 'reputation']) assert.match(REGISTRIES[n][k], /^0x8004[0-9a-fA-F]{36}$/);
  }
  assert.equal(NETWORKS.base.chainId, 8453);
  assert.equal(NETWORKS['base-sepolia'].chainId, 84532);
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const n of ['base', 'base-sepolia']) for (const k of ['identity', 'reputation']) assert.ok(readme.includes(REGISTRIES[n][k]), 'README names ' + REGISTRIES[n][k]);
  // httpRpc keeps the JSON-RPC error code so reverts are recognised
  const rpc = httpRpc('https://x', async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 3, message: 'execution reverted' } })));
  await assert.rejects(rpc('eth_call', []), (e) => e.code === 3);
  await assert.rejects(httpRpc('https://x', async () => new Response('', { status: 502 }))('eth_call', []), /502/);
  await assert.rejects(httpJson(async () => new Response('', { status: 404 }))('https://x'), /404/);
});

test('A5 reads the Base Sepolia test identity Kognai publishes on this bundle', { skip: !process.env.KOGNAI_TEST_AGENT_ID && 'set KOGNAI_TEST_AGENT_ID once Kognai publishes it on the bundle' }, async () => {
  const r = await loadAgent({ agentId: process.env.KOGNAI_TEST_AGENT_ID, network: 'base-sepolia', identityRegistry: REGISTRIES['base-sepolia'].identity, reputationRegistry: REGISTRIES['base-sepolia'].reputation, rpc: httpRpc(NETWORKS['base-sepolia'].rpc), fetchJson: httpJson() });
  assert.equal(r.status, 'ok', r.error);
});

test('A5 live: real registries on Base and Base Sepolia (ERC8004_LIVE=1)', { skip: process.env.ERC8004_LIVE !== '1' }, async () => {
  for (const [network, id] of [['base-sepolia', 1], ['base', 1]]) {
    const r = await loadAgent({ agentId: id, network, identityRegistry: REGISTRIES[network].identity, reputationRegistry: REGISTRIES[network].reputation, rpc: httpRpc(NETWORKS[network].rpc), fetchJson: httpJson() });
    assert.equal(r.status, 'ok', r.error);
    const empty = await loadAgent({ agentId: 999999999, network, identityRegistry: REGISTRIES[network].identity, rpc: httpRpc(NETWORKS[network].rpc), fetchJson: httpJson() });
    assert.equal(empty.status, 'empty');
  }
});

test('A6 mobile friendly (viewport, 360 px), light and dark', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /color-scheme: light dark/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /overflow-wrap: anywhere/);
  assert.match(html, /min-width: 0/);
  assert.match(html, /<img src="[^"]*" alt="Image of/);
  assert.match(html, /<label for="agentId"/);
  assert.match(html, /<html lang="en">/);
  assert.ok(!/[\u2013\u2014]/.test(html));
});
