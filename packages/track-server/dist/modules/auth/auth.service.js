import { createHash, randomBytes } from 'node:crypto';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../../domain/errors.js';
const STATE_TTL_MS = 5 * 60 * 1000;
const LOCAL_USERNAME = /^[A-Za-z0-9_-]{2,32}$/;
export function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}
export class AuthService {
    deps;
    now;
    constructor(deps) {
        this.deps = deps;
        this.now = deps.now ?? (() => new Date());
    }
    get feishuEnabled() {
        return Boolean(this.deps.feishu && this.deps.config.feishu.enabled);
    }
    get devLoginEnabled() {
        return this.deps.config.devLoginEnabled;
    }
    /**
     * 生成飞书授权页地址。同一个地址既用于「扫码」（前端 iframe 内嵌）也用于「授权」（整页跳转），
     * 区别只在前端呈现方式。
     */
    async createLoginUrl(mode) {
        if (!this.feishuEnabled) {
            throw new BadRequestError('飞书登录未配置：请设置 FEISHU_APP_ID / FEISHU_APP_SECRET');
        }
        const { feishu } = this.deps.config;
        const now = this.now();
        const state = randomBytes(16).toString('hex');
        const expiresAt = new Date(now.getTime() + STATE_TTL_MS);
        await this.deps.states.create(state, mode, expiresAt, now);
        // 顺手清理过期数据，避免表无限增长（失败不影响登录）
        await this.deps.states.deleteExpired(now).catch(() => undefined);
        await this.deps.sessions.deleteExpired(now).catch(() => undefined);
        const params = new URLSearchParams({
            client_id: feishu.appId,
            redirect_uri: feishu.redirectUri,
            response_type: 'code',
            state,
        });
        return {
            url: `${feishu.authBase}/suite/passport/oauth/authorize?${params.toString()}`,
            state,
            expiresIn: Math.floor(STATE_TTL_MS / 1000),
        };
    }
    /** 回调：校验 state → 换 token → 取用户 → 建会话 */
    async completeFeishuLogin(code, state, meta = {}) {
        const now = this.now();
        const consumed = await this.deps.states.consume(state, now);
        if (!consumed)
            throw new UnauthorizedError('登录状态已失效，请重新发起登录', 'invalid_state');
        if (!this.deps.feishu)
            throw new BadRequestError('飞书登录未配置');
        const profile = await this.deps.feishu.exchangeCode(code);
        const user = await this.bindFeishuUser(profile);
        const ticket = await this.issueSession(user, meta);
        return { ticket, mode: consumed.mode === 'redirect' ? 'redirect' : 'qr' };
    }
    /** 校验 Bearer token，返回当前用户 */
    async resolveToken(token) {
        const tokenHash = hashToken(token);
        const userId = await this.deps.sessions.findUserIdByTokenHash(tokenHash, this.now());
        if (userId === null)
            return null;
        const user = await this.deps.users.findById(userId);
        if (!user || user.status !== 'active')
            return null;
        return user;
    }
    async logout(token) {
        await this.deps.sessions.deleteByTokenHash(hashToken(token));
    }
    /** 本地调试登录：不走飞书，仅用于开发/测试环境验证权限链路 */
    async loginLocal(username, meta = {}) {
        if (!this.devLoginEnabled) {
            throw new ForbiddenError('本地登录未开启（DEV_LOGIN_ENABLED=false 或生产环境）');
        }
        if (!LOCAL_USERNAME.test(username)) {
            throw new BadRequestError('用户名只能是 2-32 位字母、数字、下划线或中划线');
        }
        const existing = await this.deps.users.findByLocalUsername(username);
        const user = existing ?? (await this.deps.users.createLocalUser(username, await this.decideRole(), this.now()));
        if (user.status !== 'active')
            throw new ForbiddenError('账号已被停用');
        return this.issueSession(user, meta);
    }
    async bindFeishuUser(profile) {
        const existing = await this.deps.users.findByOpenId(profile.openId);
        if (existing?.status === 'disabled') {
            throw new ForbiddenError('账号已被停用，请联系管理员');
        }
        const role = existing?.role ?? (await this.decideRole(profile.openId));
        return this.deps.users.upsertFeishuUser(profile, role, this.now());
    }
    /**
     * 角色判定：显式白名单 > 库里没有管理员时首个登录者自动成为管理员 > 默认只读。
     * 「首个登录者成为管理员」是为了避免全新部署时无人能进管理后台，属于一次性引导。
     */
    async decideRole(openId) {
        if (openId && this.deps.config.bootstrapAdminOpenIds.includes(openId))
            return 'admin';
        const admins = await this.deps.users.countActiveAdmins();
        return admins === 0 ? 'admin' : 'viewer';
    }
    async issueSession(user, meta) {
        const now = this.now();
        const token = randomBytes(32).toString('base64url');
        const expiresAt = new Date(now.getTime() + this.deps.config.sessionTtlHours * 3600 * 1000);
        await this.deps.sessions.create({
            tokenHash: hashToken(token),
            userId: user.id,
            expiresAt,
            ip: meta.ip ?? null,
            userAgent: meta.userAgent ?? null,
        }, now);
        await this.deps.users.touchLogin(user.id, now);
        return { token, expiresAt, user: { ...user, lastLoginAt: now } };
    }
}
//# sourceMappingURL=auth.service.js.map