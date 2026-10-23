// REPO X-RAY — a paying client for the x402 route. Proves one paid call end to end.
//   node pay-test.mjs <repo> [--url http://localhost:5480] [--key path/to/solana-keypair.json]
// The keypair file is the Solana CLI JSON array format. It needs USDC on the network the server
// advertises (devnet USDC 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU by default). No SOL needed:
// the facilitator pays the transaction fee. The key is read, never printed.
import fs from 'node:fs';
import { createKeyPairSignerFromBytes } from '@solana/kit';
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from '@x402/fetch';
import { ExactSvmScheme } from '@x402/svm/exact/client';

const args = process.argv.slice(2);
const repo = args.find(a => !a.startsWith('--')) || 'sindresorhus/got';
const opt = (k, d) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : d; };
const base = opt('--url', 'http://localhost:5480');
const keyPath = opt('--key', process.env.XRAY_TEST_KEY);
if (!keyPath) { console.error('Pass the payer keypair: --key path/to/keypair.json (or set XRAY_TEST_KEY).'); process.exit(2); }

const signer = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, 'utf8'))));
console.log('payer:', signer.address);

// 1. the bare request: expect 402 with the price list
const url = `${base}/api/v1/xray?repo=${encodeURIComponent(repo)}`;
const first = await fetch(url);
console.log('without payment:', first.status);
const req = first.headers.get('payment-required') || first.headers.get('x-payment-required');
if (first.status === 402) {
  try {
    const decoded = JSON.parse(Buffer.from(req, 'base64').toString('utf8'));
    for (const a of decoded.accepts || []) console.log('  accepts:', a.scheme, a.network, 'amount', a.amount || a.maxAmountRequired, 'asset', a.asset, 'payTo', a.payTo);
  } catch { console.log('  (price list in body)', (await first.text()).slice(0, 300)); }
}

// 2. the paying request
const client = new x402Client().register('solana:*', new ExactSvmScheme(signer));
client.registerPolicy((_v, requirements) => requirements.filter(r => BigInt(r.amount || r.maxAmountRequired || 0) <= 20_000n)); // never more than $0.02
const paidFetch = wrapFetchWithPayment(fetch, client);
const t0 = Date.now();
const res = await paidFetch(url);
const ms = Date.now() - t0;
console.log('with payment:', res.status, `(${ms} ms)`);
const receipt = res.headers.get('payment-response') || res.headers.get('x-payment-response');
if (receipt) {
  const r = decodePaymentResponseHeader(receipt);
  console.log('receipt:', JSON.stringify(r));
}
const body = await res.json();
if (res.ok) console.log('result:', body.repo?.full_name, body.grade, '|', body.line);
else {
  const again = res.headers.get('payment-required');
  let why = body;
  if (res.status === 402 && again) { try { const d = JSON.parse(Buffer.from(again, 'base64').toString('utf8')); why = d.error || d; } catch {} }
  console.log('not paid:', typeof why === 'string' ? why : JSON.stringify(why));
}
