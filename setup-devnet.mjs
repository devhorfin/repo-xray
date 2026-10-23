// One-time devnet setup for the paid route: a receiver wallet and its devnet USDC token account.
//   node setup-devnet.mjs [--payer C:/path/to/devnet-keypair.json]
// Writes .keys/devnet-receiver.json (gitignored) and xray.config.json with { network: "devnet", payTo }.
// The payer's SOL covers the token account rent (~0.002 SOL). Keys are read, never printed.
import fs from 'node:fs';
import path from 'node:path';
import { createKeyPairSignerFromBytes, createKeyPairSignerFromPrivateKeyBytes, getAddressEncoder, createSolanaRpc, createSolanaRpcSubscriptions, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, signTransactionMessageWithSigners, sendAndConfirmTransactionFactory, getSignatureFromTransaction, address } from '@solana/kit';
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { USDC_DEVNET_ADDRESS, DEVNET_RPC_URL, DEVNET_WS_URL } from '@x402/svm';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : d; };
const payerPath = opt('--payer', process.env.XRAY_TEST_KEY);
if (!payerPath) { console.error('Pass a funded devnet keypair: --payer path/to/keypair.json (or set XRAY_TEST_KEY).'); process.exit(2); }
const keysDir = path.join(process.cwd(), '.keys');
const receiverPath = path.join(keysDir, 'devnet-receiver.json');
fs.mkdirSync(keysDir, { recursive: true });

const payer = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(fs.readFileSync(payerPath, 'utf8'))));
let receiver;
if (fs.existsSync(receiverPath)) {
  receiver = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(fs.readFileSync(receiverPath, 'utf8'))));
  console.log('receiver (existing):', receiver.address);
} else {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  receiver = await createKeyPairSignerFromPrivateKeyBytes(seed);
  const pub = getAddressEncoder().encode(receiver.address);
  fs.writeFileSync(receiverPath, JSON.stringify([...seed, ...pub])); // Solana CLI format: 32 seed + 32 public
  console.log('receiver (new):', receiver.address);
}

const rpc = createSolanaRpc(DEVNET_RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(DEVNET_WS_URL);
const mint = address(USDC_DEVNET_ADDRESS);
const [ata] = await findAssociatedTokenPda({ owner: receiver.address, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
const existing = await rpc.getAccountInfo(ata, { encoding: 'base64' }).send();
if (existing.value) {
  console.log('receiver USDC account exists:', ata);
} else {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    m => setTransactionMessageFeePayerSigner(payer, m),
    m => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    m => appendTransactionMessageInstructions([getCreateAssociatedTokenIdempotentInstruction({ payer, ata, owner: receiver.address, mint })], m),
  );
  const tx = await signTransactionMessageWithSigners(msg);
  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(tx, { commitment: 'confirmed' });
  console.log('created receiver USDC account:', ata, 'tx', getSignatureFromTransaction(tx));
}
const cfgPath = path.join(process.cwd(), 'xray.config.json');
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
cfg = { ...cfg, network: 'devnet', payTo: receiver.address, price: cfg.price || '$0.01' };
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
console.log('wrote xray.config.json:', cfg);
