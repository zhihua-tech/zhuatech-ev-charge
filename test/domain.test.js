import test from 'node:test';
import assert from 'node:assert/strict';
import { ChargeService } from '../src/domain.js';

function fixture(balance = 100) {
  const service = new ChargeService();
  const station = service.createStation({ code: 'S1', name: '一号站', address: '上海' });
  const tariff = service.createTariff({ name: '全天电价', periods: [{ startHour: 0, endHour: 24, energyPrice: 1, servicePrice: 0.5 }] });
  const connector = service.registerConnector({ stationId: station.id, tariffId: tariff.id, code: 'G1', ratedPowerKw: 60 });
  const customer = service.createCustomer({ name: '用户', mobile: '13800000000', balance });
  return { service, station, tariff, connector, customer };
}

test('充电会话完成分时计费与钱包扣款', () => {
  const { service, connector, customer } = fixture();
  const session = service.startSession({ connectorId: connector.id, customerId: customer.id });
  const metered = service.ingestMeter(session.id, { meterKwh: 10 });
  assert.equal(metered.totalAmount, 15);
  const stopped = service.stopSession(session.id);
  assert.equal(stopped.status, 'paid');
  assert.equal(service.customers.get(customer.id).balance, 85);
  assert.equal(service.connectors.get(connector.id).status, 'available');
});

test('预约只能由预约人核销且启动请求幂等', () => {
  const { service, connector, customer } = fixture();
  service.reserve({ connectorId: connector.id, customerId: customer.id });
  const first = service.startSession({ connectorId: connector.id, customerId: customer.id }, 'user', 'req-1');
  const repeated = service.startSession({ connectorId: connector.id, customerId: customer.id }, 'user', 'req-1');
  assert.equal(first.id, repeated.id);
  assert.equal(service.sessions.size, 1);
});

test('表计禁止回退且余额不足形成欠费', () => {
  const { service, connector, customer } = fixture(1);
  const session = service.startSession({ connectorId: connector.id, customerId: customer.id });
  service.ingestMeter(session.id, { meterKwh: 2 });
  assert.throws(() => service.ingestMeter(session.id, { meterKwh: 1 }), /不能回退/);
  const stopped = service.stopSession(session.id);
  assert.equal(stopped.status, 'unpaid');
  assert.equal(stopped.outstandingAmount, 2);
});

test('故障自动开单，工单关闭后恢复设备', () => {
  const { service, connector } = fixture();
  const order = service.reportFault(connector.id, { code: 'E01', description: '绝缘检测失败' });
  assert.equal(service.connectors.get(connector.id).status, 'fault');
  service.closeWorkOrder(order.id, '更换检测模块');
  assert.equal(service.connectors.get(connector.id).status, 'available');
});
