/**
 * Task 鉴权服务 - Cloudflare D1 版本（生产环境）
 *
 * 使用 Cloudflare D1 持久化存储
 * 支持 Worker 重启后数据保留
 */

export interface TaskAuthRecord {
  task_id: string;
  kid: string;
  token_hash: string;
  created_at: string;
  last_used_at?: string;
  usage_count: number;
  status: 'active' | 'revoked';
}

export interface VerifyResult {
  valid: boolean;
  error?: 'TOKEN_INVALID' | 'TOKEN_REVOKED' | 'TOKEN_NOT_FOUND';
  task_id?: string;
  new_token?: string;
  old_token?: string;
}

const SECRET_KEY = 'your-task-secret-key-change-in-production';

/**
 * D1 存储的 TaskAuth 服务
 */
export class TaskAuthServiceD1 {
  constructor(private db: D1Database) {}

  /**
   * 生成随机 Kid
   */
  private generateKid(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * 生成 secretToken
   */
  private async generateSecretToken(taskId: string, kid: string): Promise<string> {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 15);
    const data = `${taskId}:${kid}:${timestamp}:${random}`;

    const encoder = new TextEncoder();
    const keyData = encoder.encode(SECRET_KEY);
    const messageData = encoder.encode(data);

    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, messageData);
    const hashArray = Array.from(new Uint8Array(signature));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * 计算 token hash
   */
  private async hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(SECRET_KEY);
    const messageData = encoder.encode(token);

    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, messageData);
    const hashArray = Array.from(new Uint8Array(signature));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * 生成完整 token
   */
  private async generateToken(taskId: string): Promise<{
    kid: string;
    secretToken: string;
    token: string;
    tokenHash: string;
  }> {
    const kid = this.generateKid();
    const secretToken = await this.generateSecretToken(taskId, kid);
    const token = `${kid}.${secretToken}`;
    const tokenHash = await this.hashToken(token);

    return { kid, secretToken, token, tokenHash };
  }

  /**
   * 解析 token
   */
  private parseToken(token: string): { kid: string; secretToken: string } | null {
    const parts = token.split('.');

    if (parts.length !== 2) {
      return null;
    }

    const [kid, secretToken] = parts;

    if (kid.length !== 6 || secretToken.length !== 64) {
      return null;
    }

    return { kid, secretToken };
  }

  /**
   * 创建鉴权记录
   */
  async createAuth(taskId: string): Promise<string> {
    const { kid, token, tokenHash } = await this.generateToken(taskId);
    const createdAt = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO task_auth (task_id, kid, token_hash, created_at, usage_count, status)
         VALUES (?, ?, ?, ?, 0, 'active')`
      )
      .bind(taskId, kid, tokenHash, createdAt)
      .run();

    console.log(`🔑 [TaskAuth-D1] 为 taskId ${taskId} 生成 token (kid: ${kid})`);

    return token;
  }

  /**
   * 验证并轮换 token
   */
  async verifyAndRotate(token: string): Promise<VerifyResult> {
    // 1. 解析 token
    const parsed = this.parseToken(token);

    if (!parsed) {
      console.warn(`⚠️  [TaskAuth-D1] Token 格式无效`);
      return {
        valid: false,
        error: 'TOKEN_INVALID',
      };
    }

    const { kid } = parsed;

    // 2. 查询记录
    const record = await this.db
      .prepare(`SELECT * FROM task_auth WHERE kid = ?`)
      .bind(kid)
      .first<TaskAuthRecord>();

    if (!record) {
      console.warn(`⚠️  [TaskAuth-D1] Kid 不存在: ${kid}`);
      return {
        valid: false,
        error: 'TOKEN_NOT_FOUND',
      };
    }

    // 3. 检查状态
    if (record.status === 'revoked') {
      console.warn(`⚠️  [TaskAuth-D1] Token 已被撤销: ${kid}`);
      return {
        valid: false,
        error: 'TOKEN_REVOKED',
      };
    }

    // 4. 验证 hash
    const tokenHash = await this.hashToken(token);

    if (tokenHash !== record.token_hash) {
      console.warn(`⚠️  [TaskAuth-D1] Token hash 不匹配: ${kid}`);
      return {
        valid: false,
        error: 'TOKEN_INVALID',
      };
    }

    // ✅ 验证成功
    const taskId = record.task_id;

    console.log(`✅ [TaskAuth-D1] Token 验证成功: taskId=${taskId}, kid=${kid}`);

    // 6. 作废旧 token
    await this.db
      .prepare(
        `UPDATE task_auth
         SET status = 'revoked', last_used_at = ?
         WHERE kid = ?`
      )
      .bind(new Date().toISOString(), kid)
      .run();

    console.log(`🔒 [TaskAuth-D1] 旧 token 已作废: kid=${kid}`);

    // 7. 生成新 token
    const newTokenData = await this.generateToken(taskId);

    await this.db
      .prepare(
        `INSERT INTO task_auth (task_id, kid, token_hash, created_at, usage_count, status)
         VALUES (?, ?, ?, ?, ?, 'active')`
      )
      .bind(
        taskId,
        newTokenData.kid,
        newTokenData.tokenHash,
        new Date().toISOString(),
        record.usage_count + 1
      )
      .run();

    console.log(`🔑 [TaskAuth-D1] 生成新 token: taskId=${taskId}, new_kid=${newTokenData.kid}`);

    return {
      valid: true,
      task_id: taskId,
      new_token: newTokenData.token,
      old_token: token,
    };
  }

  /**
   * 获取活跃 token
   */
  async getActiveToken(taskId: string): Promise<TaskAuthRecord | null> {
    const record = await this.db
      .prepare(
        `SELECT * FROM task_auth
         WHERE task_id = ? AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .bind(taskId)
      .first<TaskAuthRecord>();

    if (record) {
      return {
        ...record,
        token_hash: '***', // 不暴露
      };
    }

    return null;
  }

  /**
   * 清理已撤销的旧 token（可选的维护任务）
   */
  async cleanupRevokedTokens(olderThanDays: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.db
      .prepare(
        `DELETE FROM task_auth
         WHERE status = 'revoked' AND last_used_at < ?`
      )
      .bind(cutoffDate.toISOString())
      .run();

    const deletedCount = result.meta.changes || 0;

    if (deletedCount > 0) {
      console.log(`🧹 [TaskAuth-D1] 清理了 ${deletedCount} 个已撤销的旧 token`);
    }

    return deletedCount;
  }
}
