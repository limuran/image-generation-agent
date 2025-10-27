/**
 * 基于 taskId 的短期记忆服务 - Cloudflare D1 版本
 *
 * 用于记录每个 taskId 的图片生成历史
 * 使用 D1 持久化存储，支持生产环境
 */

export interface TaskMemoryEntry {
  task_id: string;
  prompt: string;
  optimized_prompt?: string;
  generated_images: Array<{
    url: string;
    r2_key?: string;
    file_name: string;
    storage_type: 'r2' | 'local';
  }>;
  count: number;
  created_at: string;
  expires_at: string;
}

export interface TaskHistory {
  task_id: string;
  total_generations: number;
  entries: TaskMemoryEntry[];
  first_generation: string;
  last_generation: string;
}

/**
 * TaskMemory 服务类 - D1 版本
 */
export class TaskMemoryServiceD1 {
  private readonly TTL_DAYS = 7; // 记忆保留 7 天

  constructor(private db: D1Database) {}

  /**
   * 保存任务记忆
   */
  async saveMemory(entry: Omit<TaskMemoryEntry, 'created_at' | 'expires_at'>): Promise<void> {
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    await this.db
      .prepare(
        `INSERT INTO task_memory
        (task_id, prompt, optimized_prompt, generated_images, count, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        entry.task_id,
        entry.prompt,
        entry.optimized_prompt || null,
        JSON.stringify(entry.generated_images),
        entry.count,
        createdAt,
        expiresAt
      )
      .run();

    console.log(`💾 [TaskMemory-D1] 已保存记忆: ${entry.task_id} (TTL: ${this.TTL_DAYS}天)`);
  }

  /**
   * 获取指定 taskId 的历史记录
   */
  async getHistory(taskId: string): Promise<TaskHistory | null> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM task_memory
         WHERE task_id = ? AND expires_at > datetime('now')
         ORDER BY created_at DESC`
      )
      .bind(taskId)
      .all<any>();

    if (!rows.results || rows.results.length === 0) {
      return null;
    }

    const entries: TaskMemoryEntry[] = rows.results.map(row => ({
      task_id: row.task_id,
      prompt: row.prompt,
      optimized_prompt: row.optimized_prompt,
      generated_images: JSON.parse(row.generated_images),
      count: row.count,
      created_at: row.created_at,
      expires_at: row.expires_at,
    }));

    return {
      task_id: taskId,
      total_generations: entries.length,
      entries,
      first_generation: rows.results[rows.results.length - 1].created_at,
      last_generation: rows.results[0].created_at,
    };
  }

  /**
   * 获取上一次生成的内容（最近的一次）
   */
  async getLastGeneration(taskId: string): Promise<TaskMemoryEntry | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM task_memory
         WHERE task_id = ? AND expires_at > datetime('now')
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .bind(taskId)
      .first<any>();

    if (!row) {
      return null;
    }

    return {
      task_id: row.task_id,
      prompt: row.prompt,
      optimized_prompt: row.optimized_prompt,
      generated_images: JSON.parse(row.generated_images),
      count: row.count,
      created_at: row.created_at,
      expires_at: row.expires_at,
    };
  }

  /**
   * 清理过期记忆
   */
  async cleanupExpiredMemories(): Promise<number> {
    const result = await this.db
      .prepare(
        `DELETE FROM task_memory
         WHERE expires_at <= datetime('now')`
      )
      .run();

    const deletedCount = result.meta.changes || 0;

    if (deletedCount > 0) {
      console.log(`🧹 [TaskMemory-D1] 清理了 ${deletedCount} 条过期记忆`);
    }

    return deletedCount;
  }

  /**
   * 获取所有任务的统计信息
   */
  async getStatistics(): Promise<{
    total_tasks: number;
    total_generations: number;
    active_tasks: number;
  }> {
    const stats = await this.db
      .prepare(
        `SELECT
          COUNT(DISTINCT task_id) as total_tasks,
          COUNT(*) as total_generations,
          COUNT(DISTINCT CASE WHEN expires_at > datetime('now') THEN task_id END) as active_tasks
        FROM task_memory`
      )
      .first<any>();

    return {
      total_tasks: stats?.total_tasks || 0,
      total_generations: stats?.total_generations || 0,
      active_tasks: stats?.active_tasks || 0,
    };
  }

  /**
   * 删除特定任务的所有历史
   */
  async deleteTaskHistory(taskId: string): Promise<number> {
    const result = await this.db
      .prepare(`DELETE FROM task_memory WHERE task_id = ?`)
      .bind(taskId)
      .run();

    const deletedCount = result.meta.changes || 0;

    if (deletedCount > 0) {
      console.log(`🗑️  [TaskMemory-D1] 删除了 ${taskId} 的 ${deletedCount} 条记录`);
    }

    return deletedCount;
  }
}
