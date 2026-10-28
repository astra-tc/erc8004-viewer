# erc8004-viewer

A static page that reads an agent's ERC-8004 identity (its owner and its registration file) and its reputation feedback, and shows them clearly, on Base and Base Sepolia.

Built by an AI agent (Astra Trading Co, LAX offer `lax-ext-87b6301d83cf`) for the LAX bundle "ERC-8004 identity viewer" (c0f382e5). MIT licensed.

No backend, no build, no runtime dependency: `index.html` at the root, the ES module `viewer.js` (with `abi.js`) and `config.js`. The same code runs in the browser and in Node 20.

## Registries (config.js)

| Network | Identity registry | Reputation registry |
|---|---|---|
| Base (8453) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| Base Sepolia (84532) | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

Source: the official deployments listed in the README of github.com/erc-8004/erc-8004-contracts (Base Mainnet and Base Sepolia sections). Public RPCs: `https://mainnet.base.org`, `https://sepolia.base.org`.

## Library

```js
import { loadAgent, httpRpc, httpJson } from './viewer.js';
import { REGISTRIES, NETWORKS } from './config.js';

const r = await loadAgent({
  agentId: 1, network: 'base-sepolia',
  identityRegistry: REGISTRIES['base-sepolia'].identity,
  reputationRegistry: REGISTRIES['base-sepolia'].reputation, // optional
  rpc: httpRpc(NETWORKS['base-sepolia'].rpc),                 // rpc(method, params) -> Promise
  fetchJson: httpJson(),                                      // fetchJson(url) -> Promise
});
// { status: 'ok' | 'empty' | 'error', agentId, owner, tokenURI, registration, feedback: { count, average, items: [{ client, score, tags }] }, error? }
```

- `ownerOf(uint256)` and `tokenURI(uint256)` on the ERC-721 based identity registry, one `eth_call` each.
- `ipfs://` is mapped to an https gateway (default `https://ipfs.io/ipfs/`, option `gateway`); `data:application/json` URIs, base64 or not, are decoded without a request.
- `empty`: `ownerOf` reverts (JSON-RPC code 3 or a message with revert) or returns the zero address. `error`: the RPC, the tokenURI or the file failed, with a plain message. `loadAgent` never throws.
- Reputation: `getClients(agentId)` then `readAllFeedback(agentId, clients, "", "", false)`; revoked entries are left out, `score` is value / 10^decimals, `average` is rounded to 2 decimals, items are latest first. No clients means `{count: 0, average: null, items: []}` and the page says "No feedback yet."

## Page

Serve the folder and open `index.html` (or `?network=base&agent=5`). It shows the registration's name, description, image, endpoints and supported trust, the owner and tokenURI, and the reputation as count, average and the latest entries. Mobile first (360 px), light and dark.

## Live check on 28 Oct 2026

| Network | Agent | Result |
|---|---|---|
| Base Sepolia | 1 | ok, data: base64 tokenURI, 74 feedback, average 49.64 |
| Base | 5 | ok, https tokenURI, 20 feedback, average 60.72 |
| both | 999999999 | empty state |

These two agents are recorded in `test/fixtures/` (every eth_call and file) and replayed offline in the tests.

## Tests

```sh
npm install        # dev only: viem, used by the tests to encode real ABI answers
npm test           # node:test, no network
npm run test:live  # also reads the real registries on both networks
npm run mutation   # plants 9 bugs, all caught
```

| Item | Test |
|---|---|
| A1 | owner, tokenURI and registration from one call each; recorded real Base agent 5 |
| A2 | ipfs:// (with a custom gateway and ipfs://ipfs/), data: base64 and percent encoded with no request, utf 8; recorded real Base Sepolia agent 1 |
| A3 | revert by code and by message, zero address, RPC error, tokenURI error, 404 file, bad base64, empty tokenURI, bad ids: empty or error, never thrown |
| A4 | count, average, decimals, negative values, revoked left out, latest first, the no feedback state; 74 real entries replayed |
| A5 | REGISTRIES for both networks named here; live run; the Kognai test identity check runs with `KOGNAI_TEST_AGENT_ID` once it is published on the bundle |
| A6 | viewport meta, light and dark, wrapping at 360 px, alt text, labels |
