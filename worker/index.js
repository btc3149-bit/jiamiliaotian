import { generateClientId, encryptMessage, decryptMessage, logEvent, isString, isObject, getTime } from './utils.js';
import { sendWebPush, isAcceptableEndpoint } from './push.js';

// Durable Object classes must be exported from the entrypoint for wrangler.
export { VapidStore } from './vapid.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Web Push：客户端启动订阅前先来取 VAPID 公钥（public by design）。
    // 密钥对由全局 VapidStore DO 懒生成并持久化，与推送签名方一致。
    if (url.pathname === '/api/vapid') {
      try {
        const stub = env.VAPID_STORE.get(env.VAPID_STORE.idFromName('jmlt-vapid'));
        const resp = await stub.fetch('https://vapid.internal/');
        if (!resp.ok) {
          return new Response(JSON.stringify({ error: 'vapid unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        }
        const keys = await resp.json();
        return new Response(JSON.stringify({ publicKey: keys.publicKey }), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
          }
        });
      } catch (error) {
        logEvent('api-vapid', error, 'error');
        return new Response(JSON.stringify({ error: 'vapid error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // 处理WebSocket请求
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader && upgradeHeader === 'websocket') {
      // SECURITY / SCALE: shard one Durable Object per room. The `c` query
      // param is the sha256 hex digest of the room name computed client-side,
      // so the server still never learns the room name. Distinct rooms map to
      // distinct DO instances — a hot room can no longer serialize all other
      // rooms through a single global object.
      const channelParam = url.searchParams.get('c');
      const roomKey = (channelParam && /^[0-9a-f]{64}$/.test(channelParam))
        ? 'room-' + channelParam
        : 'default';
      const id = env.CHAT_ROOM.idFromName(roomKey);
      const stub = env.CHAT_ROOM.get(id);
      return stub.fetch(request);
    }

    // 处理API请求
    if (url.pathname.startsWith('/api/')) {
      // ...API 逻辑...
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }

    // 其余全部交给 ASSETS 处理（自动支持 hash 文件名和 SPA fallback）
    const assetResponse = await env.ASSETS.fetch(request);

    // 注入安全响应头（CSP 为 XSS 纵深防御的最后一道线）
    const secureHeaders = {
      // v1.9.3: media-src must allow data: — voice messages render as
      // <audio src="data:audio/...">; without an explicit media-src the
      // directive falls back to default-src 'self' and the browser silently
      // blocks playback (no duration, dead controls).
      // v1.9.3：media-src 必须放行 data:——语音消息渲染为
      // <audio src="data:audio/...">；不显式声明 media-src 时继承
      // default-src 'self'，浏览器静默拦截播放（无时长、控件点不动）。
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' wss:; font-src 'self' data:",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      // v1.9.1: camera/microphone must be (self) - the previous hardening
      // ('()') disabled getUserMedia for our own page too, so web calls
      // always cancelled with "无法访问麦克风/摄像头". geolocation stays off.
      // v1.9.1：camera/microphone 必须是 (self)——此前加固写成 '()'，把我们
      // 自己页面的 getUserMedia 也禁了，网页端通话必然取消。地理定位仍禁用。
      'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()'
    };
    const secureResponse = new Response(assetResponse.body, assetResponse);
    for (const [k, v] of Object.entries(secureHeaders)) {
      secureResponse.headers.set(k, v);
    }
    return secureResponse;
  }
};

export class ChatRoom {  constructor(state, env) {
    this.state = state;
    this.env = env;

    // Use objects like original server.js instead of Maps
    this.clients = {};
    this.channels = {};

    // Web Push per-endpoint throttle (memory-only; resets on DO eviction).
    // 推送节流表（仅内存，DO 重启即清零）。
    this.pushThrottle = {};

    this.config = {
      seenTimeout: 60000,
      debug: false
    };
    
    // Initialize RSA key pair
    this.initRSAKeyPair();
  }

  async initRSAKeyPair() {
    try {
      let stored = await this.state.storage.get('rsaKeyPair');
      if (!stored) {
        stored = await this.generateAndStoreKeyPair();
      }

      // Reconstruct the private key
      if (stored.rsaPrivateData) {
        const privateKeyBuffer = new Uint8Array(stored.rsaPrivateData);

        stored.rsaPrivate = await crypto.subtle.importKey(
          'pkcs8',
          privateKeyBuffer,
          {
            name: 'RSASSA-PKCS1-v1_5',
            hash: 'SHA-256'
          },
          false,
          ['sign']
        );
      }
      this.keyPair = stored;

      // R1 fix: 24h rotation now KEEPS the previous keypair for 48h as a
      // migration signing key, so TOFU-pinned clients can verify the rotation
      // (old key signs the new public key) and update their pin seamlessly
      // instead of being locked out forever. 修复评审 R1。
      if (stored.createdAt && (Date.now() - stored.createdAt > 24 * 60 * 60 * 1000)) {
        if (Object.keys(this.clients).length === 0) {
          logEvent('key-rotation', 'rotating after 24h');
          await this.rotateKeyPair();
        } else {
          await this.state.storage.put('pendingKeyRotation', true);
        }
      }
    } catch (error) {
      logEvent('init-rsa-key-pair', error, 'error');
      throw error;
    }
  }

  // Generate a fresh keypair and persist it (exportable SPKI/PKCS8 forms).
  async generateAndStoreKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256'
      },
      true,
      ['sign', 'verify']
    );

    const [publicKeyBuffer, privateKeyBuffer] = await Promise.all([
      crypto.subtle.exportKey('spki', keyPair.publicKey),
      crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
    ]);

    const stored = {
      rsaPublic: btoa(String.fromCharCode(...new Uint8Array(publicKeyBuffer))),
      rsaPrivateData: Array.from(new Uint8Array(privateKeyBuffer)),
      createdAt: Date.now()
    };
    await this.state.storage.put('rsaKeyPair', stored);
    logEvent('key-generated', 'new RSA key pair stored');
    return stored;
  }

  // Rotate to a new keypair, preserving the previous one for 48h so pinned
  // clients can verify the handover via a migration signature.
  // 轮换到新密钥对，旧密钥保留 48 小时供客户端验证交接。
  async rotateKeyPair() {
    const old = await this.state.storage.get('rsaKeyPair');
    if (old) {
      await this.state.storage.put('rsaKeyPairOld', Object.assign({}, old, {
        retireAt: Date.now() + (48 * 60 * 60 * 1000)
      }));
    }
    await this.state.storage.delete('rsaKeyPair');
    await this.state.storage.delete('pendingKeyRotation');
    this.keyPair = null;
    this.oldKeyPair = null;
    const fresh = await this.generateAndStoreKeyPair();
    if (fresh.rsaPrivateData) {
      fresh.rsaPrivate = await crypto.subtle.importKey(
        'pkcs8',
        new Uint8Array(fresh.rsaPrivateData),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
      );
    }
    this.keyPair = fresh;
  }

  // R1: migration signature — the PREVIOUS private key signs the CURRENT
  // public key (raw SPKI bytes). A client pinning the old key verifies this
  // with its pin and rotates trust seamlessly. A MITM cannot produce this
  // signature without the old private key, so TOFU guarantees hold.
  // 迁移签名：旧私钥对新公钥（原始 SPKI 字节）签名，客户端用旧 pin 验证后无缝换 pin。
  async getMigrationSignature() {
    try {
      let old = await this.state.storage.get('rsaKeyPairOld');
      if (!old) return null;
      if (old.retireAt && Date.now() > old.retireAt) {
        await this.state.storage.delete('rsaKeyPairOld');
        this.oldKeyPair = null;
        return null;
      }
      if (!this.oldKeyPair || this.oldKeyPair.rsaPublic !== old.rsaPublic) {
        if (!old.rsaPrivateData) return null;
        const priv = await crypto.subtle.importKey(
          'pkcs8',
          new Uint8Array(old.rsaPrivateData),
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['sign']
        );
        this.oldKeyPair = { rsaPublic: old.rsaPublic, rsaPrivate: priv };
      }
      if (!this.keyPair || !this.keyPair.rsaPublic) return null;
      // raw SPKI bytes of the current public key
      const newKeyBytes = Uint8Array.from(atob(this.keyPair.rsaPublic), (c) => c.charCodeAt(0));
      const sig = await crypto.subtle.sign(
        { name: 'RSASSA-PKCS1-v1_5' },
        this.oldKeyPair.rsaPrivate,
        newKeyBytes
      );
      let binary = '';
      const bytes = new Uint8Array(sig);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    } catch (error) {
      logEvent('key-migration-signature', error, 'error');
      return null;
    }
  }

  async fetch(request) {
    // Check for WebSocket upgrade
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket Upgrade', { status: 426 });
    }

    // Ensure RSA keys are initialized
    if (!this.keyPair) {
      await this.initRSAKeyPair();
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Accept the WebSocket connection
    this.handleSession(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }  // WebSocket connection event handler
  async handleSession(connection) {    connection.accept();

    // 清理旧连接
    await this.cleanupOldConnections();

    const clientId = generateClientId();

    if (!clientId || this.clients[clientId]) {
      this.closeConnection(connection);
      return;
    }

    logEvent('connection', clientId, 'debug');    // Store client information
    this.clients[clientId] = {
      connection: connection,
      seen: getTime(),
      key: null,
      shared: null,
      channel: null
    };

    // Send RSA public key (plus R1 migration signature when a previous
    // keypair is still within its 48h handover window).
    // 下发 RSA 公钥（若旧密钥仍在 48 小时交接窗口内，附带迁移签名）。
    try {
      logEvent('sending-public-key', clientId, 'debug');
      const keyMsg = { type: 'server-key', key: this.keyPair.rsaPublic };
      const mig = await this.getMigrationSignature();
      if (mig) keyMsg.mig = mig;
      this.sendMessage(connection, JSON.stringify(keyMsg));
    } catch (error) {
      logEvent('sending-public-key', error, 'error');
    }    // Handle messages
    connection.addEventListener('message', async (event) => {
      const message = event.data;

      if (!isString(message) || !this.clients[clientId]) {
        return;
      }

      this.clients[clientId].seen = getTime();

      if (message === 'ping') {
        this.sendMessage(connection, 'pong');
        return;
      }

      // SECURITY: never log raw message content (may contain ciphertext or, worse, plaintext)
      logEvent('message', clientId, 'debug');      // Handle key exchange
      if (!this.clients[clientId].shared && message.length < 2048) {
        try {
          // Generate ECDH key pair using P-384 curve (equivalent to secp384r1)
          const keys = await crypto.subtle.generateKey(
            {
              name: 'ECDH',
              namedCurve: 'P-384'
            },
            true,
            ['deriveBits', 'deriveKey']
          );

          const publicKeyBuffer = await crypto.subtle.exportKey('raw', keys.publicKey);
          
          // Sign the public key using PKCS1 padding (compatible with original)
          const signature = await crypto.subtle.sign(
            {
              name: 'RSASSA-PKCS1-v1_5'
            },
            this.keyPair.rsaPrivate,
            publicKeyBuffer
          );

          // Convert hex string to Uint8Array for client public key
          const clientPublicKeyHex = message;
          const clientPublicKeyBytes = new Uint8Array(clientPublicKeyHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
          
          // Import client's public key
          const clientPublicKey = await crypto.subtle.importKey(
            'raw',
            clientPublicKeyBytes,
            { name: 'ECDH', namedCurve: 'P-384' },
            false,
            []
          );

          // Derive shared secret bits (equivalent to computeSecret in Node.js)
          const sharedSecretBits = await crypto.subtle.deriveBits(
            {
              name: 'ECDH',
              public: clientPublicKey
            },
            keys.privateKey,
            384 // P-384 produces 48 bytes (384 bits)
          );          // Take bytes 8-40 (32 bytes) for AES-256 key
          this.clients[clientId].shared = new Uint8Array(sharedSecretBits).slice(8, 40);

          const response = Array.from(new Uint8Array(publicKeyBuffer))
            .map(b => b.toString(16).padStart(2, '0')).join('') + 
            '|' + btoa(String.fromCharCode(...new Uint8Array(signature)));
          
          this.sendMessage(connection, response);

        } catch (error) {
          logEvent('message-key', [clientId, error], 'error');
          this.closeConnection(connection);
        }

        return;
      }

      // Handle encrypted messages
      if (this.clients[clientId].shared && message.length <= (8 * 1024 * 1024)) {
        this.processEncryptedMessage(clientId, message);
      }
    });    // Handle connection close
    connection.addEventListener('close', async (event) => {
      logEvent('close', [clientId, event], 'debug');

      const channel = this.clients[clientId].channel;

      if (channel && this.channels[channel]) {
        this.channels[channel].splice(this.channels[channel].indexOf(clientId), 1);

        if (this.channels[channel].length === 0) {
          delete(this.channels[channel]);
        } else {
          try {
            const members = this.channels[channel];

            for (const member of members) {
              const client = this.clients[member];              if (this.isClientInChannel(client, channel)) {
                this.sendMessage(client.connection, encryptMessage({
                  a: 'l',
                  p: members.filter((value) => {
                    return (value !== member ? true : false);
                  })
                }, client.shared));
              }
            }

          } catch (error) {
            logEvent('close-list', [clientId, error], 'error');
          }
        }
      }

      if (this.clients[clientId]) {
        delete(this.clients[clientId]);
      }
    });
  }
  // Process encrypted messages
  processEncryptedMessage(clientId, message) {
    let decrypted = null;

    try {
      decrypted = decryptMessage(message, this.clients[clientId].shared);

      // SECURITY: never log decrypted payloads. Log only the action type.
      if (isObject(decrypted) && isString(decrypted.a)) {
        logEvent('message-decrypted', [clientId, decrypted.a], 'debug');
      }

      if (!isObject(decrypted) || !isString(decrypted.a)) {
        return;
      }

      const action = decrypted.a;

      if (action === 'j') {
        this.handleJoinChannel(clientId, decrypted);
      } else if (action === 'c') {
        this.handleClientMessage(clientId, decrypted);
      } else if (action === 'w') {
        this.handleChannelMessage(clientId, decrypted);
      } else if (action === 'ps') {
        this.handlePushSubscribe(clientId, decrypted);
      } else if (action === 'pu') {
        this.handlePushUnsubscribe(clientId, decrypted);
      }

    } catch (error) {
      logEvent('process-encrypted-message', [clientId, error], 'error');
    } finally {
      decrypted = null;
    }
  }
  // Handle channel join requests
  handleJoinChannel(clientId, decrypted) {
    if (!isString(decrypted.p) || this.clients[clientId].channel) {
      return;
    }

    // R4 fix (review 4b): the client always joins with the sha256 hex hash of
    // the room name (same value used for DO routing). Enforce that format so
    // arbitrary strings cannot become channel names.
    // 修复评审 4b：频道名强制为房间名的 sha256 十六进制哈希，拒绝任意字符串。
    if (!/^[0-9a-f]{64}$/.test(decrypted.p)) {
      logEvent('message-join', [clientId, 'invalid channel format'], 'error');
      return;
    }

    try {
      const channel = decrypted.p;

      this.clients[clientId].channel = channel;

      if (!this.channels[channel]) {
        this.channels[channel] = [clientId];
      } else {
        this.channels[channel].push(clientId);
      }

      this.broadcastMemberList(channel);

    } catch (error) {
      logEvent('message-join', [clientId, error], 'error');
    }
  }
  // Handle client messages
  handleClientMessage(clientId, decrypted) {
    if (!isString(decrypted.p) || !isString(decrypted.c) || !this.clients[clientId].channel) {
      return;
    }

    try {
      const channel = this.clients[clientId].channel;
      const targetClient = this.clients[decrypted.c];

      if (this.isClientInChannel(targetClient, channel)) {
        const messageObj = {
          a: 'c',
          p: decrypted.p,
          c: clientId
        };

        const encrypted = encryptMessage(messageObj, targetClient.shared);
        this.sendMessage(targetClient.connection, encrypted);

        messageObj.p = null;
      }

      // Web Push: something was relayed in this room — nudge subscribers.
      // R2 fix: senders can set np:1 on the transport envelope for non-
      // message events (typing, read receipts, sync replay) so those never
      // wake offline subscribers with fake "new message" pushes. The flag is
      // a single transport-layer bit; content stays opaque to the server.
      // 修复评审 R2：发送方对非消息事件（typing/回执/重播）置 np:1，服务器跳过推送。
      if (!decrypted.np) {
        this.queuePushToSubscribers();
      }

    } catch (error) {
      logEvent('message-client', [clientId, error], 'error');
    }
  }  // Handle channel messages
  handleChannelMessage(clientId, decrypted) {
    if (!isObject(decrypted.p) || !this.clients[clientId].channel) {
      return;
    }
    
    try {
      const channel = this.clients[clientId].channel;
      // 过滤有效的目标成员
      const validMembers = Object.keys(decrypted.p).filter(member => {
        const targetClient = this.clients[member];
        return isString(decrypted.p[member]) && this.isClientInChannel(targetClient, channel);
      });

      // 处理所有有效的目标成员
      for (const member of validMembers) {
        const targetClient = this.clients[member];
        const messageObj = {
          a: 'c',
          p: decrypted.p[member],
          c: clientId
        };        const encrypted = encryptMessage(messageObj, targetClient.shared);
        this.sendMessage(targetClient.connection, encrypted);

        messageObj.p = null;
      }

      // Web Push nudge for channel relays too — unless the sender marked
      // this envelope as non-notifiable (R2: typing / receipts / sync).
      // 频道转发同样触发推送提醒，但发送方标记 np:1 的非消息事件除外。
      if (!decrypted.np) {
        this.queuePushToSubscribers();
      }

    } catch (error) {
      logEvent('message-channel', [clientId, error], 'error');
    }
  }
  // ==================== Web Push subscription management ====================
  // 订阅管理。SECURITY (RULES.md)：
  // - 端点经 E2EE 通道上报（'ps'/'pu'），DO 只存不透明端点 URL 本身
  // - 不存 p256dh/auth 密钥（空 payload 推送用不上）
  // - 上限 200 条、90 天过期；端点与 clientId 故意不关联，断连不产生关联性
  static get PUSH_SUB_LIMIT() { return 200; }
  static get PUSH_SUB_TTL_MS() { return 90 * 24 * 60 * 60 * 1000; }
  static get PUSH_THROTTLE_MS() { return 15000; }

  async getPushSubs() {
    const subs = await this.state.storage.get('pushSubs');
    return (subs && isObject(subs)) ? subs : {};
  }

  async handlePushSubscribe(clientId, decrypted) {
    try {
      const endpoint = decrypted.p;
      if (!isAcceptableEndpoint(endpoint)) {
        return;
      }
      const subs = await this.getPushSubs();
      const now = Date.now();
      // expire stale entries first / 先清理过期端点
      for (const ep of Object.keys(subs)) {
        if (!subs[ep] || !subs[ep].addedAt || (now - subs[ep].addedAt > ChatRoom.PUSH_SUB_TTL_MS)) {
          delete subs[ep];
        }
      }
      // cap: drop oldest when over limit / 超限淘汰最旧
      const eps = Object.keys(subs);
      if (!subs[endpoint] && eps.length >= ChatRoom.PUSH_SUB_LIMIT) {
        eps.sort((a, b) => (subs[a].addedAt || 0) - (subs[b].addedAt || 0));
        const excess = eps.length - ChatRoom.PUSH_SUB_LIMIT + 1;
        for (let i = 0; i < excess; i++) delete subs[eps[i]];
      }
      subs[endpoint] = { addedAt: now };
      await this.state.storage.put('pushSubs', subs);
    } catch (error) {
      logEvent('push-subscribe', [clientId, error], 'error');
    }
  }

  async handlePushUnsubscribe(clientId, decrypted) {
    try {
      const endpoint = decrypted.p;
      if (!isString(endpoint)) {
        return;
      }
      const subs = await this.getPushSubs();
      if (subs[endpoint]) {
        delete subs[endpoint];
        await this.state.storage.put('pushSubs', subs);
      }
    } catch (error) {
      logEvent('push-unsubscribe', [clientId, error], 'error');
    }
  }

  // Send generic (empty payload) pushes to all due subscribers. Throttled per
  // endpoint; dead endpoints (404/410) are pruned. Called fire-and-forget.
  // R4 fix (review 4a): DOs have no ctx.waitUntil; the DO stays alive while
  // its WebSocket connections are active, which covers this call site (it
  // only fires from live WS message handlers). Failures are logged, never
  // propagated to the caller.
  // 向到期订阅者发泛化推送（按端点节流，失效端点剔除）。异步后台执行，失败仅记日志。
  async queuePushToSubscribers() {
    try {
      if (!this.env || !this.env.VAPID_STORE) return;
      const subs = await this.getPushSubs();
      const now = Date.now();
      const due = Object.keys(subs).filter((ep) => {
        const last = this.pushThrottle[ep] || 0;
        return (now - last) >= ChatRoom.PUSH_THROTTLE_MS;
      }).slice(0, 50); // hard cap per event / 单事件硬上限
      if (due.length === 0) return;
      for (const ep of due) this.pushThrottle[ep] = now;

      const vapidResp = await this.env.VAPID_STORE
        .get(this.env.VAPID_STORE.idFromName('jmlt-vapid'))
        .fetch('https://vapid.internal/');
      if (!vapidResp.ok) return;
      const vapid = await vapidResp.json();

      const results = await Promise.all(due.map(async (ep) => {
        let dead = false;
        try {
          const status = await sendWebPush(ep, vapid);
          dead = (status === 404 || status === 410);
        } catch (_) {
          dead = false; // transient network error — keep the subscription
        }
        return dead ? ep : null;
      }));
      const deadEndpoints = results.filter(Boolean);
      if (deadEndpoints.length > 0) {
        const current = await this.getPushSubs();
        for (const ep of deadEndpoints) delete current[ep];
        await this.state.storage.put('pushSubs', current);
      }
    } catch (error) {
      logEvent('push-broadcast', error, 'error');
    }
  }

  // Broadcast member list to channel
  broadcastMemberList(channel) {
    try {
      const members = this.channels[channel];

      for (const member of members) {
        const client = this.clients[member];

        if (this.isClientInChannel(client, channel)) {
          const messageObj = {
            a: 'l',
            p: members.filter((value) => {
              return (value !== member ? true : false);
            })
          };

          const encrypted = encryptMessage(messageObj, client.shared);
          this.sendMessage(client.connection, encrypted);

          messageObj.p = null;
        }
      }
    } catch (error) {
      logEvent('broadcast-member-list', error, 'error');
    }
  }  // Check if client is in channel
  isClientInChannel(client, channel) {
    return (
      client &&
      client.connection &&
      client.shared &&
      client.channel &&
      client.channel === channel ?
      true :
      false
    );
  }
  // Send message helper
  sendMessage(connection, message) {
    try {
      // In Cloudflare Workers, WebSocket.READY_STATE_OPEN is 1
      if (connection.readyState === 1) {
        connection.send(message);
      }
    } catch (error) {
      logEvent('sendMessage', error, 'error');
    }
  }  // Close connection helper
  closeConnection(connection) {
    try {
      connection.close();    } catch (error) {
      logEvent('closeConnection', error, 'error');
    }
  }
  
  // 连接清理方法
  async cleanupOldConnections() {
    const seenThreshold = getTime() - this.config.seenTimeout;
    const clientsToRemove = [];

    // 先收集需要移除的客户端，避免在迭代时修改对象
    for (const clientId in this.clients) {
      if (this.clients[clientId].seen < seenThreshold) {
        clientsToRemove.push(clientId);
      }
    }

    // 然后一次性移除所有过期客户端
    for (const clientId of clientsToRemove) {
      try {
        logEvent('connection-seen', clientId, 'debug');
        this.clients[clientId].connection.close();
        delete this.clients[clientId];
      } catch (error) {
        logEvent('connection-seen', error, 'error');      }
    }
    
    // 如果没有任何客户端和房间，检查是否需要轮换密钥
    if (Object.keys(this.clients).length === 0 && Object.keys(this.channels).length === 0) {
      const pendingRotation = await this.state.storage.get('pendingKeyRotation');
      if (pendingRotation) {
        logEvent('key-rotation', 'rotating after last client left');
        // R1 fix: rotation keeps the old key 48h for client pin migration.
        await this.rotateKeyPair();
      }
    }
    
    return clientsToRemove.length; // 返回清理的连接数量
  }
}
