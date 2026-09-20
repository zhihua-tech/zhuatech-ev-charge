/**
 * 上海如静知华信息科技有限公司 https://www.zhuatech.cn/
 * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
 */
import crypto from 'node:crypto';

const now = () => new Date().toISOString();
const uid = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
const clone = (value) => structuredClone(value);
const required = (value, field) => {
  if (value === undefined || value === null || String(value).trim() === '') throw new Error(`${field}不能为空`);
  return String(value).trim();
};
const positive = (value, field) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field}必须大于0`);
  return number;
};

/**
 * 新能源汽车充电运营领域服务，覆盖场站、设备、预约、充电、分时计费、钱包、故障和运维闭环。
 * 上海如静知华信息科技有限公司：https://www.zhuatech.cn/
 * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
 */
export class ChargeService {
  constructor(seed = {}) {
    this.stations = new Map((seed.stations || []).map((item) => [item.id, item]));
    this.connectors = new Map((seed.connectors || []).map((item) => [item.id, item]));
    this.tariffs = new Map((seed.tariffs || []).map((item) => [item.id, item]));
    this.customers = new Map((seed.customers || []).map((item) => [item.id, item]));
    this.sessions = new Map((seed.sessions || []).map((item) => [item.id, item]));
    this.reservations = new Map((seed.reservations || []).map((item) => [item.id, item]));
    this.workOrders = new Map((seed.workOrders || []).map((item) => [item.id, item]));
    this.audit = seed.audit || [];
    this.requests = new Map(seed.requests || []);
  }

  /**
   * 建立运营场站，保存营业时间、经纬度与停车服务信息。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  createStation(input, actor = 'admin') {
    const code = required(input.code, '场站编码');
    if ([...this.stations.values()].some((item) => item.code === code)) throw new Error('场站编码已存在');
    const station = {
      id: uid('sta'), code, name: required(input.name, '场站名称'), address: required(input.address, '场站地址'),
      latitude: Number(input.latitude || 0), longitude: Number(input.longitude || 0),
      businessHours: input.businessHours || '00:00-24:00', parkingFreeMinutes: Number(input.parkingFreeMinutes || 0),
      status: 'active', createdAt: now()
    };
    this.stations.set(station.id, station);
    this.#record(actor, 'STATION_CREATED', station.id, { code });
    return clone(station);
  }

  /**
   * 配置分时电价与服务费，校验24小时全部时段均有价格覆盖。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  createTariff(input, actor = 'operator') {
    const periods = Array.isArray(input.periods) ? input.periods : [];
    if (!periods.length) throw new Error('至少配置一个计费时段');
    const normalized = periods.map((item) => ({
      startHour: Number(item.startHour), endHour: Number(item.endHour),
      energyPrice: positive(item.energyPrice, '电价'), servicePrice: Number(item.servicePrice || 0)
    }));
    for (let hour = 0; hour < 24; hour += 1) {
      if (!normalized.some((item) => item.startHour <= hour && hour < item.endHour)) throw new Error(`计费时段未覆盖${hour}时`);
    }
    const tariff = { id: uid('tar'), name: required(input.name, '计费规则名称'), currency: 'CNY', periods: normalized, createdAt: now() };
    this.tariffs.set(tariff.id, tariff);
    this.#record(actor, 'TARIFF_CREATED', tariff.id, { periodCount: periods.length });
    return clone(tariff);
  }

  /**
   * 接入充电枪并绑定场站、协议和计费规则。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  registerConnector(input, actor = 'operator') {
    if (!this.stations.has(input.stationId)) throw new Error('场站不存在');
    if (!this.tariffs.has(input.tariffId)) throw new Error('计费规则不存在');
    const code = required(input.code, '充电枪编码');
    if ([...this.connectors.values()].some((item) => item.code === code)) throw new Error('充电枪编码已存在');
    const connector = {
      id: uid('gun'), stationId: input.stationId, tariffId: input.tariffId, code,
      protocol: input.protocol || 'OCPP1.6J', ratedPowerKw: positive(input.ratedPowerKw, '额定功率'),
      status: 'available', meterKwh: Number(input.meterKwh || 0), lastHeartbeatAt: null, createdAt: now()
    };
    this.connectors.set(connector.id, connector);
    this.#record(actor, 'CONNECTOR_REGISTERED', connector.id, { stationId: connector.stationId });
    return clone(connector);
  }

  /**
   * 创建充电用户与预存账户。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  createCustomer(input, actor = 'customer-service') {
    const mobile = required(input.mobile, '手机号');
    if ([...this.customers.values()].some((item) => item.mobile === mobile)) throw new Error('手机号已注册');
    const customer = { id: uid('cus'), name: required(input.name, '用户姓名'), mobile, balance: Number(input.balance || 0), status: 'active', createdAt: now() };
    this.customers.set(customer.id, customer);
    this.#record(actor, 'CUSTOMER_CREATED', customer.id, { mobile });
    return clone(customer);
  }

  /**
   * 为钱包充值并形成不可变资金审计事件。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  topUp(customerId, amount, actor = 'cashier') {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error('用户不存在');
    customer.balance = Number((customer.balance + positive(amount, '充值金额')).toFixed(2));
    this.#record(actor, 'WALLET_TOPPED_UP', customerId, { amount: Number(amount), balance: customer.balance });
    return clone(customer);
  }

  /**
   * 预约可用充电枪，避免同一时间窗口被重复占用。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  reserve(input, actor = 'customer') {
    const connector = this.connectors.get(input.connectorId);
    if (!connector) throw new Error('充电枪不存在');
    if (!this.customers.has(input.customerId)) throw new Error('用户不存在');
    if (connector.status !== 'available') throw new Error('充电枪当前不可预约');
    const expiresAt = input.expiresAt || new Date(Date.now() + 15 * 60_000).toISOString();
    if (Date.parse(expiresAt) <= Date.now()) throw new Error('预约失效时间必须晚于当前时间');
    const reservation = { id: uid('rsv'), connectorId: connector.id, customerId: input.customerId, status: 'active', expiresAt, createdAt: now() };
    this.reservations.set(reservation.id, reservation);
    connector.status = 'reserved';
    this.#record(actor, 'CONNECTOR_RESERVED', reservation.id, { connectorId: connector.id });
    return clone(reservation);
  }

  /**
   * 启动充电会话，支持请求幂等、预约核销和枪状态机校验。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  startSession(input, actor = 'customer', idempotencyKey = '') {
    if (idempotencyKey && this.requests.has(idempotencyKey)) return clone(this.sessions.get(this.requests.get(idempotencyKey)));
    const connector = this.connectors.get(input.connectorId);
    const customer = this.customers.get(input.customerId);
    if (!connector) throw new Error('充电枪不存在');
    if (!customer || customer.status !== 'active') throw new Error('用户不可用');
    if (!['available', 'reserved'].includes(connector.status)) throw new Error('充电枪正在使用或故障');
    if (connector.status === 'reserved') {
      const reservation = [...this.reservations.values()].find((item) => item.connectorId === connector.id && item.status === 'active');
      if (!reservation || reservation.customerId !== customer.id || Date.parse(reservation.expiresAt) <= Date.now()) throw new Error('预约不属于当前用户或已失效');
      reservation.status = 'consumed';
    }
    const session = {
      id: uid('ses'), connectorId: connector.id, stationId: connector.stationId, customerId: customer.id,
      status: 'charging', startMeterKwh: connector.meterKwh, lastMeterKwh: connector.meterKwh,
      energyKwh: 0, energyAmount: 0, serviceAmount: 0, totalAmount: 0, startedAt: now(), stoppedAt: null
    };
    connector.status = 'charging';
    this.sessions.set(session.id, session);
    if (idempotencyKey) this.requests.set(idempotencyKey, session.id);
    this.#record(actor, 'SESSION_STARTED', session.id, { connectorId: connector.id });
    return clone(session);
  }

  /**
   * 接收表计读数，执行单调校验并按读数发生时段累计电费和服务费。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  ingestMeter(sessionId, input) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'charging') throw new Error('充电会话不存在或已结束');
    const meterKwh = Number(input.meterKwh);
    if (!Number.isFinite(meterKwh) || meterKwh < session.lastMeterKwh) throw new Error('表计读数不能回退');
    const connector = this.connectors.get(session.connectorId);
    const tariff = this.tariffs.get(connector.tariffId);
    const at = new Date(input.reportedAt || now());
    const period = tariff.periods.find((item) => item.startHour <= at.getHours() && at.getHours() < item.endHour);
    if (!period) throw new Error('当前时段没有计费规则');
    const delta = meterKwh - session.lastMeterKwh;
    session.lastMeterKwh = meterKwh;
    session.energyKwh = Number((session.energyKwh + delta).toFixed(4));
    session.energyAmount = Number((session.energyAmount + delta * period.energyPrice).toFixed(2));
    session.serviceAmount = Number((session.serviceAmount + delta * period.servicePrice).toFixed(2));
    session.totalAmount = Number((session.energyAmount + session.serviceAmount).toFixed(2));
    connector.meterKwh = meterKwh;
    connector.lastHeartbeatAt = now();
    return clone(session);
  }

  /**
   * 停止充电并完成钱包扣款、欠费标记和设备复位。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  stopSession(sessionId, actor = 'customer') {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'charging') throw new Error('充电会话不存在或已结束');
    const customer = this.customers.get(session.customerId);
    session.stoppedAt = now();
    if (customer.balance >= session.totalAmount) {
      customer.balance = Number((customer.balance - session.totalAmount).toFixed(2));
      session.status = 'paid';
    } else {
      session.status = 'unpaid';
      session.outstandingAmount = Number((session.totalAmount - customer.balance).toFixed(2));
      customer.balance = 0;
    }
    this.connectors.get(session.connectorId).status = 'available';
    this.#record(actor, 'SESSION_STOPPED', session.id, { status: session.status, totalAmount: session.totalAmount });
    return clone(session);
  }

  /**
   * 上报设备故障并自动生成运维工单。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  reportFault(connectorId, input, actor = 'device') {
    const connector = this.connectors.get(connectorId);
    if (!connector) throw new Error('充电枪不存在');
    connector.status = 'fault';
    const order = {
      id: uid('wo'), connectorId, stationId: connector.stationId, severity: input.severity || 'medium',
      code: required(input.code, '故障码'), description: required(input.description, '故障说明'),
      status: 'open', assignee: input.assignee || null, createdAt: now(), closedAt: null
    };
    this.workOrders.set(order.id, order);
    this.#record(actor, 'FAULT_REPORTED', order.id, { connectorId, code: order.code });
    return clone(order);
  }

  /**
   * 关闭运维工单，并在不存在其他未关闭故障时恢复设备可用状态。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  closeWorkOrder(orderId, resolution, actor = 'engineer') {
    const order = this.workOrders.get(orderId);
    if (!order || order.status !== 'open') throw new Error('工单不存在或已关闭');
    order.status = 'closed';
    order.resolution = required(resolution, '处理结果');
    order.closedAt = now();
    const otherOpen = [...this.workOrders.values()].some((item) => item.connectorId === order.connectorId && item.status === 'open');
    if (!otherOpen) this.connectors.get(order.connectorId).status = 'available';
    this.#record(actor, 'WORK_ORDER_CLOSED', order.id, { resolution: order.resolution });
    return clone(order);
  }

  /**
   * 汇总场站、充电枪、会话收入、能量和故障数据供运营驾驶舱使用。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  dashboard() {
    const sessions = [...this.sessions.values()];
    const connectors = [...this.connectors.values()];
    return {
      metrics: {
        stations: this.stations.size, connectors: connectors.length,
        available: connectors.filter((item) => item.status === 'available').length,
        charging: connectors.filter((item) => item.status === 'charging').length,
        energyKwh: Number(sessions.reduce((sum, item) => sum + item.energyKwh, 0).toFixed(2)),
        revenue: Number(sessions.filter((item) => item.status === 'paid').reduce((sum, item) => sum + item.totalAmount, 0).toFixed(2)),
        openWorkOrders: [...this.workOrders.values()].filter((item) => item.status === 'open').length
      },
      stations: [...this.stations.values()], connectors, sessions: sessions.slice(-20).reverse(),
      workOrders: [...this.workOrders.values()].slice(-20).reverse(), audit: this.audit.slice(-30).reverse()
    };
  }

  /**
   * 导出完整业务快照用于本地持久化与迁移。
   * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
   */
  dump() {
    return {
      stations: [...this.stations.values()], connectors: [...this.connectors.values()], tariffs: [...this.tariffs.values()],
      customers: [...this.customers.values()], sessions: [...this.sessions.values()], reservations: [...this.reservations.values()],
      workOrders: [...this.workOrders.values()], audit: this.audit, requests: [...this.requests.entries()]
    };
  }

  #record(actor, action, resourceId, detail) {
    this.audit.push({ id: uid('aud'), actor, action, resourceId, detail, occurredAt: now() });
  }
}

/**
 * 构造覆盖场站、充电和故障工单的可运行演示数据。
 * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
 */
export function createDemoService() {
  const service = new ChargeService();
  const station = service.createStation({ code: 'SH-HQ-01', name: '知华科技上海示范站', address: '上海市企业园区A座', parkingFreeMinutes: 120 });
  const tariff = service.createTariff({ name: '园区分时电价', periods: [
    { startHour: 0, endHour: 8, energyPrice: 0.58, servicePrice: 0.32 },
    { startHour: 8, endHour: 22, energyPrice: 1.05, servicePrice: 0.42 },
    { startHour: 22, endHour: 24, energyPrice: 0.58, servicePrice: 0.32 }
  ] });
  const gun1 = service.registerConnector({ stationId: station.id, tariffId: tariff.id, code: 'ZH-DC-001-A', ratedPowerKw: 120 });
  service.registerConnector({ stationId: station.id, tariffId: tariff.id, code: 'ZH-DC-001-B', ratedPowerKw: 120 });
  const customer = service.createCustomer({ name: '演示用户', mobile: '13800000001', balance: 100 });
  const session = service.startSession({ connectorId: gun1.id, customerId: customer.id }, 'demo', 'demo-session');
  service.ingestMeter(session.id, { meterKwh: 18.6 });
  service.reportFault([...service.connectors.values()][1].id, { code: 'E_STOP', description: '急停按钮触发', severity: 'high', assignee: '一线运维组' });
  return service;
}
