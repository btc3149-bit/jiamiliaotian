# 服务端限流运维清单（S-1/S-2，PR-4）

代码层限流（Worker DO 内与 Node 内，参数见 `worker/ratelimit.js` 与
`server/server.js` 的 RL 常量，两处同步）只能在帧到达进程后生效。
真正能在连接到达服务端前削峰的只有平台层，部署时请一并配置：

## Cloudflare（Workers 路径）

- 为 WebSocket 升级路径配置 Rate Limiting 规则：单 IP 新建连接
  ≤ 30 次/分钟（合法重连风暴约为每人 1 次，30/min 给同一 NAT 后
  30 人同时重连留余量）。
- WAF 拦截非 Upgrade 的异常请求打到 WS 路径。
- DO 按房间哈希分片，单房间被攻击的爆炸半径限于该房间，这一点是
  现架构固有缓解；DO 内 8MB 判断仍是整帧到达后丢弃，不要宣称已
  在接收前限流。

## Node / Docker 路径

- `ws` 的 `maxPayload`（8MB）是唯一在整帧入内存前生效的限制，已启用。
- 每 IP 连接上限（100）与每 IP 握手上限（10/分钟）按
  `remoteAddress` 计数。Docker 的 nginx 反代后 `remoteAddress` 恒为
  代理 IP：超过 100 人共用同一出口的部署必须上调
  `RL.maxConnectionsPerIp`（`server/server.js` 顶部常量），否则会误伤
  整个团队。服务端默认不信任 `X-Forwarded-For`。
- Node 限流计数为单进程内存态，重启清零，多实例部署各自计数
  （Node 路径本身即单进程，属已知边界）。

## 调参绑定

令牌桶参数（容量 120、回充 60/s）与客户端文件发送峰值绑定：
`client/js/util.file.js` 的分卷批次为每批 5 卷、批间隔 100ms
（峰值 50 帧/s）。若未来客户端上调发送批次，必须同步上调桶参数，
否则合法文件传输会被误杀。
