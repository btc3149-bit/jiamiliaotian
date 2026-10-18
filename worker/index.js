import { generateClientId, encryptMessage, decryptMessage, logEvent, isString, isObject, getTime } from './utils.js';
import { sendWebPush, isAcceptableEndpoint } from './push.js';

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
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' wss:; font-src 'self' data:",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
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
        console.log('Generating new RSA keypair...');
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

        // 并行导出公钥和私钥以提高性能
        const [publicKeyBuffer, privateKeyBuffer] = await Promise.all([
          crypto.subtle.exportKey('spki', keyPair.publicKey),
          crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
        ]);
        
        stored = {
          rsaPublic: btoa(String.fromCharCode(...new Uint8Array(publicKeyBuffer))),
          rsaPrivateData: Array.from(new Uint8Array(privateKeyBuffer)),
          createdAt: Date.now() // 记录密钥创建时间，用于后续判断是否需要轮换
        };
        
        await this.state.storage.put('rsaKeyPair', stored);
        console.log('RSA key pair generated and stored');
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
        );      }
        this.keyPair = stored;
      
      // 检查密钥是否需要轮换（如果已创建超过24小时）
      if (stored.createdAt && (Date.now() - stored.createdAt > 24 * 60 * 60 * 1000)) {
        // 如果没有任何客户端，则执行密钥轮换
        if (Object.keys(this.clients).length === 0) {
          console.log('密钥已使用24小时，进行轮换...');
          await this.state.storage.delete('rsaKeyPair');
          this.keyPair = null;
          await this.initRSAKeyPair();
        } else {
          // 否则标记需要在客户端全部断开后进行轮换
          await this.state.storage.put('pendingKeyRotation', true);
        }
      }
    } catch (error) {
      console.error('Error initializing RSA key pair:', error);
      throw error;
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

    // Send RSA public key
    try {
      logEvent('sending-public-key', clientId, 'debug');
      this.sendMessage(connection, JSON.stringify({
        type: 'server-key',
        key: this.keyPair.rsaPublic
      }));
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
      // Fire-and-forget with waitUntil; zero content in the push itself.
      // 有消息转发即触发推送提醒（空 payload，waitUntil 后台执行）。
      this.queuePushToSubscribers();

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

      // Web Push nudge for channel relays too / 频道转发同样触发推送提醒
      this.queuePushToSubscribers();

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
  // 向到期订阅者发泛化推送（按端点节流，失效端点剔除）。异步后台执行。
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
        console.log('没有活跃客户端或房间，执行密钥轮换...');
        await this.state.storage.delete('rsaKeyPair');        await this.state.storage.delete('pendingKeyRotation');
        this.keyPair = null;
        await this.initRSAKeyPair();
      }
    }
    
    return clientsToRemove.length; // 返回清理的连接数量
  }
}
