import { z } from 'zod';
import { BadRequestError, UnauthorizedError } from '../../domain/errors.js';
import { readJsonBody, readString } from '../../lib/http.js';
import { toPublicUser } from './user.dto.js';
const DevLoginBody = z.object({ username: z.string().trim().min(2).max(32) });
function loginMeta(request) {
    const ua = request.headers['user-agent'];
    return {
        ip: request.ip,
        userAgent: typeof ua === 'string' ? ua.slice(0, 512) : null,
    };
}
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
/**
 * 回调结果页。扫码登录时飞书把 iframe 重定向到这里，
 * 这里用 postMessage 把 token/错误交给父窗口；没有父窗口（用户直接打开授权页）时兜底跳转。
 */
function renderCallbackPage(webOrigin, payload) {
    const data = JSON.stringify({ type: 'track-admin-login', ...payload }).replace(/</g, '\\u003c');
    const title = payload.error ? '登录失败' : '登录成功，正在返回…';
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
         background: #f4f6f9; color: #1f2733; display: flex; align-items: center; justify-content: center;
         min-height: 100vh; }
  .box { background: #fff; border: 1px solid #e8ecf2; border-radius: 12px; padding: 24px 28px;
         text-align: center; max-width: 360px; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  p { color: #7a8797; font-size: 13px; margin: 0 0 12px; word-break: break-word; }
  a { color: #2f6bff; font-size: 13px; text-decoration: none; }
</style>
</head>
<body>
  <div class="box">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(payload.error ?? '')}</p>
    <a href="${escapeHtml(webOrigin)}/login">返回登录页</a>
  </div>
<script>
  var payload = ${data};
  var target = ${JSON.stringify(webOrigin)};
  var delivered = false;
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, target);
      delivered = true;
    }
  } catch (e) {}
  if (!delivered) {
    try {
      if (window.opener) {
        window.opener.postMessage(payload, target);
        delivered = true;
      }
    } catch (e) {}
  }
  if (!delivered && payload.token) {
    location.replace(target + '/login/callback#token=' + encodeURIComponent(payload.token));
  }
</script>
</body>
</html>`;
}
export function registerAuthRoutes(app, deps) {
    /** 登录页据此决定展示哪些登录方式（不泄露 appId/secret） */
    app.get('/api/auth/config', async () => ({
        ok: true,
        feishuEnabled: deps.auth.feishuEnabled,
        devLoginEnabled: deps.auth.devLoginEnabled,
        authRequired: deps.config.authRequired,
    }));
    /**
     * 返回飞书授权页地址：
     * - mode=qr：前端放进 iframe 展示二维码，扫码后飞书直接回调
     * - mode=redirect：前端整页跳转（手机端或 iframe 被拦时的兜底）
     */
    app.get('/api/auth/feishu/login-url', async (request) => {
        const query = (request.query ?? {});
        const mode = readString(query, 'mode') === 'redirect' ? 'redirect' : 'qr';
        const result = await deps.auth.createLoginUrl(mode);
        return { ok: true, ...result };
    });
    /**
     * 飞书回调：一次性 state 校验后建会话。
     * - mode=redirect：整页跳转，直接 302 回前端并带 token（放 fragment，不进日志与 Referer）
     * - mode=qr：回调发生在登录页内嵌的 iframe 里，用 postMessage 把 token 交给父窗口
     */
    app.get('/api/auth/feishu/callback', async (request, reply) => {
        const query = (request.query ?? {});
        const code = readString(query, 'code');
        const state = readString(query, 'state');
        const error = readString(query, 'error');
        const origin = deps.config.webOrigin;
        if (error) {
            return reply
                .code(200)
                .type('text/html; charset=utf-8')
                .send(renderCallbackPage(origin, { error: `飞书返回错误：${error}` }));
        }
        if (!code || !state) {
            return reply
                .code(200)
                .type('text/html; charset=utf-8')
                .send(renderCallbackPage(origin, { error: '回调缺少 code 或 state，请重新登录' }));
        }
        try {
            const { ticket, mode } = await deps.auth.completeFeishuLogin(code, state, loginMeta(request));
            if (mode === 'redirect') {
                return reply.redirect(`${origin}/login/callback#token=${encodeURIComponent(ticket.token)}`);
            }
            return reply.code(200).type('text/html; charset=utf-8').send(renderCallbackPage(origin, { token: ticket.token }));
        }
        catch (cause) {
            const message = cause instanceof Error ? cause.message : '登录失败';
            request.log.warn({ err: cause }, 'feishu login failed');
            return reply.code(200).type('text/html; charset=utf-8').send(renderCallbackPage(origin, { error: message }));
        }
    });
    app.get('/api/auth/me', async (request, reply) => {
        if (!request.auth) {
            if (!deps.config.authRequired)
                return reply.send({ ok: true, user: null, authRequired: false });
            throw new UnauthorizedError();
        }
        return { ok: true, user: toPublicUser(request.auth.user), authRequired: deps.config.authRequired };
    });
    app.post('/api/auth/logout', async (request) => {
        if (request.auth)
            await deps.auth.logout(request.auth.token);
        return { ok: true };
    });
    /** 本地调试登录，生产环境 auth.service 内部直接拒绝 */
    app.post('/api/auth/dev-login', async (request) => {
        const parsed = DevLoginBody.safeParse(readJsonBody(request.body));
        if (!parsed.success)
            throw new BadRequestError('username 需为 2-32 位字符串');
        const ticket = await deps.auth.loginLocal(parsed.data.username, loginMeta(request));
        return {
            ok: true,
            token: ticket.token,
            expiresAt: ticket.expiresAt.toISOString(),
            user: toPublicUser(ticket.user),
        };
    });
}
//# sourceMappingURL=auth.route.js.map