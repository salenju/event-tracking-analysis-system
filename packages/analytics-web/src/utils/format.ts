/** 事件名 → 业务可读名称（未登记的事件直接展示原名） */
export const EVENT_LABELS: Record<string, string> = {
  cashier_view: '进入收银台',
  wallet_select: '选择钱包',
  wallet_connected: '钱包连接成功',
  pay_click: '点击支付',
  pay_success: '支付成功',
  pay_failed: '支付失败',
};

export function eventLabel(event: string | null | undefined): string {
  if (!event) return '未知事件';
  return EVENT_LABELS[event] ?? event;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('zh-CN');
}

export function formatPercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return '—';
  const percent = rate * 100;
  if (percent > 0 && percent < 1) return `${percent.toFixed(2)}%`;
  return `${percent.toFixed(1)}%`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

/** 长 ID 只保留头尾，便于表格里阅读 */
export function shortId(id: string | null | undefined, keep = 8): string {
  if (!id) return '—';
  if (id.length <= keep * 2 + 3) return id;
  return `${id.slice(0, keep)}…${id.slice(-keep)}`;
}

export function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
