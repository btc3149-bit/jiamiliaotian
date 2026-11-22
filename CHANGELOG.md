# Changelog

All notable changes to jiamiliaotian are recorded here. Versions are kept
in sync across `package.json`, `desktop/src-tauri/tauri.conf.json` and
`desktop/src-tauri/Cargo.toml` by `scripts/sync-version.mjs`
(`node scripts/sync-version.mjs --check` verifies agreement).

## v1.9.4

Security-hardening release: the eight hardening PRs merged after v1.9.3
(PR #1–#8), plus dependency and CI engineering updates. No wire-format or
protocol changes; fully interoperable with v1.9.3 clients.

### Security fixes (the eight PRs merged after v1.9.3)

- **PR #1 — Docs & CI batch:** README key-derivation formula corrected to
  PBKDF2-SHA256 with 200,000 iterations (both languages); unauthenticated-join
  and legacy-replay scope disclosed honestly in the READMEs and RULES.md;
  third-party default server attributed; v1.9.2 regression tests wired into
  the CI test chain with a docs-consistency test.
- **PR #2 — Docker & server dependencies:** `ws` upgraded 7.x → 8.23.0 with
  the matching Buffer-to-string handler adaptation; Docker build now installs
  server dependencies reproducibly from the lockfile (`npm ci --omit=dev`);
  Docker security headers (CSP / Permissions-Policy) aligned word-for-word
  with the Worker path, with TLS/HSTS reverse-proxy guidance documented.
- **PR #3 — Node/Worker parity:** Node relay gained the same 64-hex channel
  guard as the Worker; client removal made idempotent and shared between the
  close path and the expiry sweep (which now also removes channel membership
  and broadcasts on both paths); bilingual deployment-difference table
  completed; real-handshake black-box integration tests added.
- **PR #4 — Server rate limiting (both relays):** shared rate-limit semantics
  on Worker and Node — per-connection and per-IP handshake caps, token-bucket
  frame limiting with close-on-abuse, byte window, fan-out and channel-size
  caps, handshake frame-shape pre-validation, 8 MB max payload; handshake
  keypairs are now non-extractable; a `ws` 'error' listener prevents a single
  oversize frame from crashing the Node process; platform rate-limit ops
  checklist documented.
- **PR #5 — Ratchet peek/commit:** incoming ratchet decryption now peeks
  before committing state, so a forged frame can no longer burn the message
  key and permanently destroy the legitimate frame that follows it; golden
  v1.9.3 wire fixtures pin interoperability.
- **PR #6 — Crypto hardening:** migration-container passphrases must now be
  at least 12 code points (old weak containers remain importable); shared-secret
  derivation rejects all-zero results at all call sites; ratchet header
  comments aligned with the implementation.
- **PR #7 — Push endpoint allowlist:** Web Push subscription endpoints are
  restricted to the real push-service hosts (with explicit port rules and
  length bounds), look-alike/suffix-smuggled endpoints are rejected, and
  non-compliant stored endpoints are cleaned up.
- **PR #8 — Share hand-off TTL:** system-share payloads handed off through
  the Service Worker cache now carry a timestamp and expire after 5 minutes;
  the share cache is explicitly deleted on SW activation, and the residual
  on-disk caveat is disclosed honestly in both READMEs.

### Dependencies & CI (this release)

- DOMPurify 3.2.6 → 3.4.18; Vite 6.3.5 → 6.4.6 (patch line only);
  patch batch: @dicebear/core 9.4.3 / @dicebear/micah 9.4.2,
  emoji-picker-element 1.29.1, fflate 0.8.3, js-sha256 0.11.1,
  terser 5.51.4, autoprefixer 10.7.0, cssnano 7.1.9,
  server bufferutil 4.2.0. No major-version upgrades.
- Dependabot configured (npm root + server, cargo, github-actions, docker;
  weekly, patch/minor grouped, no auto-merge); CI gained a non-blocking
  `npm audit --audit-level=high` step (observation period) and a Node
  20 + 22 test matrix.
- `softprops/action-gh-release` pinned to a commit SHA in the desktop and
  Android release workflows; Cargo lockfile discipline added
  (`cargo fetch --locked` verification in release CI).

## v1.9.3

- Last tagged release before the hardening series above; see the git
  history and release notes for details.
