/** 收银台漏斗事件（与架构文档 7.1 保持一致） */
export const EVENT = {
    CASHIER_VIEW: 'cashier_view',
    WALLET_SELECT: 'wallet_select',
    WALLET_CONNECTED: 'wallet_connected',
    PAY_CLICK: 'pay_click',
    PAY_SUCCESS: 'pay_success',
    PAY_FAILED: 'pay_failed',
};
export const KNOWN_EVENTS = Object.values(EVENT);
/** SDK 会上报的记录类型，服务端不得假设只有 event */
export const RECORD_TYPES = ['event', 'performance', 'page_stay', 'error'];
export const RECORD_TYPE_EVENT = 'event';
/**
 * properties 中需要提升为独立列的业务维度（架构 6：JSON 列无法建索引）。
 * 同时兼容 camelCase 与 snake_case，服务端上报时两种写法都可能出现。
 */
export const DIMENSION_FIELDS = {
    orderId: ['orderId', 'order_id'],
    walletType: ['walletType', 'wallet_type'],
    failReason: ['failReason', 'fail_reason'],
};
/** 列宽上限，超长必须截断，否则整批插入失败 */
export const COLUMN_LIMITS = {
    appId: 64,
    env: 16,
    batchId: 64,
    sessionId: 64,
    userId: 64,
    event: 64,
    recordType: 16,
    orderId: 64,
    walletType: 32,
    failReason: 64,
};
//# sourceMappingURL=events.js.map