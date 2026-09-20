/**
 * 上海如静知华信息科技有限公司 https://www.zhuatech.cn/
 * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChargeService, createDemoService } from './domain.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.resolve(process.env.CHARGE_DATA_FILE || './data/charge.json');
const apiKey = process.env.CHARGE_API_KEY || 'zhuatech-demo-key';
const port = Number(process.env.PORT || 18101);

/** 读取本地业务快照；首次启动时生成完整演示数据。 */
function loadService() {
  try { return new ChargeService(JSON.parse(fs.readFileSync(dataFile, 'utf8'))); } catch { return createDemoService(); }
}
const service = loadService();
const persist = () => { fs.mkdirSync(path.dirname(dataFile), { recursive: true }); fs.writeFileSync(dataFile, JSON.stringify(service.dump(), null, 2)); };
persist();

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
};
const parseBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    if (chunks.reduce((sum, item) => sum + item.length, 0) > 1024 * 1024) throw new Error('请求体超过1MB');
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
};
const files = {
  '/': ['console.html', 'text/html; charset=utf-8'], '/console': ['console.html', 'text/html; charset=utf-8'],
  '/app': ['client.html', 'text/html; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8']
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (files[url.pathname]) {
      const [name, type] = files[url.pathname];
      return send(res, 200, fs.readFileSync(path.join(dirname, '..', 'public', name), 'utf8'), type);
    }
    if (url.pathname === '/health') return send(res, 200, { status: 'UP', service: 'zhuatech-ev-charge' });
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'NOT_FOUND' });
    if (req.headers['x-api-key'] !== apiKey && req.headers['x-device-token'] === undefined) return send(res, 401, { error: 'UNAUTHORIZED' });
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await parseBody(req) : {};
    const actor = req.headers['x-actor'] || 'api-user';
    let result;
    if (req.method === 'GET' && url.pathname === '/api/dashboard') result = service.dashboard();
    else if (req.method === 'POST' && url.pathname === '/api/stations') result = service.createStation(body, actor);
    else if (req.method === 'POST' && url.pathname === '/api/tariffs') result = service.createTariff(body, actor);
    else if (req.method === 'POST' && url.pathname === '/api/connectors') result = service.registerConnector(body, actor);
    else if (req.method === 'POST' && url.pathname === '/api/customers') result = service.createCustomer(body, actor);
    else if (req.method === 'POST' && url.pathname === '/api/reservations') result = service.reserve(body, actor);
    else if (req.method === 'POST' && url.pathname === '/api/sessions') result = service.startSession(body, actor, req.headers['idempotency-key'] || '');
    else {
      const topup = url.pathname.match(/^\/api\/customers\/([^/]+)\/topups$/);
      const meter = url.pathname.match(/^\/api\/sessions\/([^/]+)\/meters$/);
      const stop = url.pathname.match(/^\/api\/sessions\/([^/]+)\/stop$/);
      const fault = url.pathname.match(/^\/api\/connectors\/([^/]+)\/faults$/);
      const close = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/close$/);
      if (req.method === 'POST' && topup) result = service.topUp(topup[1], body.amount, actor);
      else if (req.method === 'POST' && meter) result = service.ingestMeter(meter[1], body);
      else if (req.method === 'POST' && stop) result = service.stopSession(stop[1], actor);
      else if (req.method === 'POST' && fault) result = service.reportFault(fault[1], body, actor);
      else if (req.method === 'POST' && close) result = service.closeWorkOrder(close[1], body.resolution, actor);
      else return send(res, 404, { error: 'NOT_FOUND' });
    }
    if (req.method !== 'GET') persist();
    return send(res, req.method === 'POST' ? 201 : 200, result);
  } catch (error) {
    return send(res, 400, { error: 'BUSINESS_ERROR', message: error.message });
  }
});

server.listen(port, () => console.log(`ZhuaTech EV Charge running at http://127.0.0.1:${port}`));
