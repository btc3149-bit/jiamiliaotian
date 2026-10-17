// Crypto interop & tamper tests for the hardened wire format
// run: node test-crypto.mjs
import { encryptMessage, decryptMessage } from './worker/utils.js';
import { GCM } from '@stablelib/gcm';
import { AES } from '@stablelib/aes';
const gcmClient = (key) => new GCM(new AES(key));
import { ChaCha20Poly1305 } from '@stablelib/chacha20poly1305';
import { sha256 } from 'js-sha256';
import assert from 'node:assert';

let passed = 0, failed = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const run = async () => {
  for (const [name, fn] of tests) {
    try { await fn(); console.log('PASS', name); passed++; }
    catch (e) { console.log('FAIL', name, '::', e.message); failed++; }
  }
};

const key32 = Buffer.alloc(32, 7); // AES-256 / ChaCha20 key size
const msg = { a: 'c', p: 'hello 世界 🔐', c: 'peer1' };

// 1. node -> node roundtrip
t('node GCM encrypt/decrypt roundtrip', () => {
  const wire = encryptMessage(msg, key32);
  assert.strictEqual(decryptMessage(wire, key32).p, msg.p);
});

// 2. node encrypt -> stablelib (client) decrypt : transport-layer interop
t('node GCM wire format readable by client (@stablelib/gcm)', () => {
  const wire = encryptMessage(msg, key32);
  const [ivB64, sealedB64] = wire.split('|');
  const opened = gcmClient(key32).open(Buffer.from(ivB64, 'base64'), Buffer.from(sealedB64, 'base64'));
  assert.strictEqual(JSON.parse(Buffer.from(opened).toString('utf8')).p, msg.p);
});

// 3. stablelib (client) encrypt -> node decrypt : reverse interop
t('client (@stablelib/gcm) wire format readable by node', () => {
  const iv = Buffer.from(crypto.getRandomValues(new Uint8Array(12)));
  const sealed = gcmClient(key32).seal(iv, Buffer.from(JSON.stringify(msg), 'utf8'));
  const wire = iv.toString('base64') + '|' + Buffer.from(sealed).toString('base64');
  assert.strictEqual(decryptMessage(wire, key32).p, msg.p);
});

// 4. tamper detection (node side)
t('tampered ciphertext rejected by node GCM', () => {
  const wire = encryptMessage(msg, key32);
  const [ivB64, sealedB64] = wire.split('|');
  const sealed = Buffer.from(sealedB64, 'base64');
  sealed[0] ^= 0x01; // flip one bit
  const tampered = ivB64 + '|' + sealed.toString('base64');
  const out = decryptMessage(tampered, key32);
  assert.deepStrictEqual(out, {}); // auth failure -> empty object
});

// 5. tamper detection (client side)
t('tampered ciphertext rejected by client GCM', () => {
  const iv = Buffer.from(crypto.getRandomValues(new Uint8Array(12)));
  const sealed = Buffer.from(gcmClient(key32).seal(iv, Buffer.from('{"a":"j"}', 'utf8')));
  sealed[sealed.length - 1] ^= 0xFF; // flip a tag bit
  const opened = gcmClient(key32).open(iv, sealed);
  assert.strictEqual(opened, null);
});

// 6. ChaCha20-Poly1305 roundtrip + tamper (client-client layer)
t('ChaCha20-Poly1305 roundtrip + tamper rejection', () => {
  const k = Buffer.alloc(32, 9);
  const aead = new ChaCha20Poly1305(k);
  const iv = Buffer.from(crypto.getRandomValues(new Uint8Array(12)));
  const sealed = Buffer.from(aead.seal(iv, Buffer.from(JSON.stringify(msg), 'utf8')));
  const open1 = new ChaCha20Poly1305(k).open(iv, sealed);
  assert.strictEqual(JSON.parse(Buffer.from(open1).toString('utf8')).p, msg.p);
  sealed[3] ^= 0x02;
  assert.strictEqual(new ChaCha20Poly1305(k).open(iv, sealed), null);
});

// 7. PBKDF2 password stretching (replaces sha256(password))
// Node 22 exposes webcrypto as globalThis.crypto (same API the client uses)
const pbkdf2Hex = async (password, room) => {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode('nodecrypt:v2:' + room), iterations: 200000, hash: 'SHA-256' },
    baseKey, 256);
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
};
t('PBKDF2 200k derivation stable, 64-hex, != plain sha256', async () => {
  const a = await pbkdf2Hex('pw123', 'myroom');
  const b = await pbkdf2Hex('pw123', 'myroom');
  assert.strictEqual(a, b);
  assert.strictEqual(a.length, 64);
  assert.notStrictEqual(a, sha256('pw123'));
});
t('async PBKDF2 test harness', () => { /* async support check */ });

// 8. CBC legacy wire format must FAIL under GCM (cross-version protection)
t('legacy CBC payload rejected by new parser', () => {
  const iv16 = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
  const wire = iv16.toString('base64') + '|' + Buffer.alloc(16).toString('base64');
  assert.deepStrictEqual(decryptMessage(wire, key32), {});
});

await run();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
