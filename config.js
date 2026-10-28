// ERC-8004 deployments targeted by this viewer.
// Source: github.com/erc-8004/erc-8004-contracts README (Base Mainnet and Base Sepolia sections), CREATE2 deterministic addresses.
export const REGISTRIES = {
  base: {
    identity: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  },
  'base-sepolia': {
    identity: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputation: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
  },
};
export const NETWORKS = {
  base: { chainId: 8453, name: 'Base', rpc: 'https://mainnet.base.org' },
  'base-sepolia': { chainId: 84532, name: 'Base Sepolia', rpc: 'https://sepolia.base.org' },
};
export const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
