# API 摘要

管理接口使用 `x-api-key`，设备上行接口可使用 `x-device-token`。业务异常统一返回 `{error,message}`，创建充电会话支持 `Idempotency-Key`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/dashboard` | 场站、设备、会话、收入和工单汇总 |
| POST | `/api/stations` | 创建场站 |
| POST | `/api/tariffs` | 创建24小时分时电价 |
| POST | `/api/connectors` | 接入充电枪 |
| POST | `/api/customers` | 创建充电用户 |
| POST | `/api/customers/{id}/topups` | 钱包充值 |
| POST | `/api/reservations` | 预约枪位 |
| POST | `/api/sessions` | 幂等启动充电 |
| POST | `/api/sessions/{id}/meters` | 上报表计读数 |
| POST | `/api/sessions/{id}/stop` | 停止、计费和扣款 |
| POST | `/api/connectors/{id}/faults` | 上报故障并开工单 |
| POST | `/api/work-orders/{id}/close` | 关闭工单 |

示例：`curl -H 'x-api-key: zhuatech-demo-key' http://127.0.0.1:18101/api/dashboard`。
