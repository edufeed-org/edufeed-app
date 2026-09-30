#!/usr/bin/env node
/**
 * Stands in for the desktop companion until it exists: generates an agent
 * key, prints the nostrconnect:// link the companion would open, waits for
 * the web app to answer as NIP-46 signer, then asks for the owner pubkey.
 *
 *   node scripts/agents/pair-sim.mjs https://localhost:5173 wss://groups.example
 *
 * Prints the agent's nsec (hex) at the end so `buzz-acp` can be run with it.
 */
import { NostrConnectSigner } from 'applesauce-signers';
import { RelayPool } from 'applesauce-relay';
import { PrivateKeySigner } from 'applesauce-signers';

const [, , appUrl = 'http://localhost:5173', ...relays] = process.argv;
if (relays.length === 0) {
  console.error('usage: pair-sim.mjs <app url> <pairing relay> [more relays]');
  process.exit(1);
}

const pool = new RelayPool();
NostrConnectSigner.pool = pool;

const agentKey = new PrivateKeySigner();
const signer = new NostrConnectSigner({ relays, signer: agentKey });
const uri = signer.getNostrConnectURI({ name: 'Edufeed Agent (sim)' });
console.log('Open this in the browser where you are logged in:\n');
console.log(`${appUrl.replace(/\/$/, '')}/agents/connect#${encodeURIComponent(uri)}\n`);

await signer.waitForSigner();
const owner = await signer.getPublicKey();
console.log('paired. owner pubkey:', owner);
console.log('agent pubkey:', await agentKey.getPublicKey());
console.log('agent secret key (hex, for BUZZ_PRIVATE_KEY):', agentKey.key ? Buffer.from(agentKey.key).toString('hex') : '(see PrivateKeySigner API)');
process.exit(0);
