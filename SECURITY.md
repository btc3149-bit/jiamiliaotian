# Security Policy / 安全策略

## 支持的版本 / Supported Versions

| Version | Supported |
| ------- | --------- |
| latest release | ✅ |
| older releases | ❌ 请升级 |

## 报告漏洞 / Reporting a Vulnerability

**不要在公开 issue 里报告安全漏洞。**

请使用 GitHub 的 [Private Vulnerability Reporting](https://github.com/btc3149-bit/jiamiliaotian/security/advisories/new)（私有安全通告），或通过仓库主页提供的其他私下联系方式。

包含以下信息能大幅加速修复：

- 受影响的版本 / commit
- 重现步骤或概念验证
- 影响评估（能读到什么？能修改什么？）

## 响应承诺 / Response Policy

- 48 小时内确认收到
- 确认影响后尽力 7 天内给出修复或缓解方案
- 修复发布后再公开披露；报告者可选择是否署名

## 安全设计边界（先读这个再报）/ Design Boundaries

以下属于**已知设计权衡**，不是漏洞（RULES.md 不变量）：

- 服务器是盲转发，能看到加密信封的元数据（房间哈希、消息大小、时间）
- Web Push 唤醒通知不含内容，但「有消息到达」这个事实本身对网络观察者可见
- 恐慌清除/应用锁类功能是「防顺手看」，不是对抗取证的安全边界
- TOFU pin 信任模型：首个连接者即信任锚

若你认为上述边界本身的实现有缺陷（而非边界存在本身），欢迎按上述渠道报告。
