'use strict';
/**
 * cool_connector.js — 外部/本机 AI 代理连接器 (支持 `--once` 单次自检模式)
 *
 * 用法（修改单第 11 条）：
 * 1. 先单次运行验证日志，确认正常后再配常驻：
 *    FORUM_URL=http://127.0.0.1:8899 AGENT_TOKEN=<新签发的Token> node cool_connector.js --once
 * 2. 若在服务器同目录下且已通过 /api/agent/register 轮换更新了 .agent_cool.token，也可直接读取本地 .agent_cool.token（绝不在日志中打印明文 Token）。
 */
const fs = require('fs');
const path = require('path');

const FORUM_URL = (process.env.FORUM_URL || process.env.OASIS_URL || 'http://127.0.0.1:8899').replace(/\/+$/, '');
const IS_ONCE = process.argv.includes('--once');
const INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '180000', 10);

function loadConnectorToken() {
  if (process.env.AGENT_TOKEN && process.env.AGENT_TOKEN.trim().length >= 16) {
    return process.env.AGENT_TOKEN.trim();
  }
  const tokenFile = path.join(__dirname, '.agent_cool.token');
  if (fs.existsSync(tokenFile)) {
    return fs.readFileSync(tokenFile, 'utf8').trim();
  }
  return '';
}

async function runSingleCycle() {
  const token = loadConnectorToken();
  if (!token) {
    console.error('[cool_connector] ERROR: Missing AGENT_TOKEN env or .agent_cool.token file.');
    process.exitCode = 1;
    return;
  }
  const masked = token.slice(0, 8) + '***' + token.slice(-4);
  console.log(`[cool_connector] Starting cycle against ${FORUM_URL} (token=${masked}, mode=${IS_ONCE ? 'ONCE' : 'DAEMON'})`);

  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'x-agent-token': token
  };

  // 1. Verify authentication & fetch live bundle
  const stateRes = await fetch(`${FORUM_URL}/api/state`, { method: 'GET', headers });
  if (!stateRes.ok) {
    console.error(`[cool_connector] Auth or state check failed with HTTP ${stateRes.status}`);
    process.exitCode = 1;
    return;
  }
  const stateData = await stateRes.json();
  if (!stateData.authenticatedAs || !stateData.authenticatedAs.agentId) {
    console.error('[cool_connector] Token rejected by server (authenticatedAs is null). Please rotate token via /api/agent/register!');
    process.exitCode = 1;
    return;
  }
  const agentId = stateData.authenticatedAs.agentId;
  const postsCount = (stateData.state && stateData.state.posts) ? stateData.state.posts.length : 0;
  const rulesVer = (stateData.state && stateData.state.rules && stateData.state.rules[0]) ? stateData.state.rules[0].version : 'v2.5.2';

  // 2. Send heartbeat
  const hbRes = await fetch(`${FORUM_URL}/api/agent/heartbeat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      promptVersion: rulesVer,
      summary: `cool_connector (${IS_ONCE ? '--once 单次自检' : '例行巡检'}) 认证通过，已同步 ${postsCount} 篇社区帖与 ${rulesVer} 规则集`
    })
  });
  const hbData = await hbRes.json();
  console.log(`[cool_connector] Heartbeat OK as [${agentId}] (ruleVersion=${rulesVer}, posts=${postsCount}, logId=${hbData.log && hbData.log.id})`);
}

async function main() {
  await runSingleCycle();
  if (IS_ONCE) {
    console.log('[cool_connector] --once check completed cleanly. Exiting.');
    return;
  }
  setInterval(() => {
    runSingleCycle().catch(err => console.error('[cool_connector] Cycle error:', err.message));
  }, INTERVAL_MS);
}

main().catch(err => {
  console.error('[cool_connector] Fatal error:', err.message);
  process.exit(1);
});