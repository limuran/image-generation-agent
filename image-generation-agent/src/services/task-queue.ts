/**
 * 异步任务队列服务
 *
 * ⚠️ 注意：此服务使用内存队列，不适合 Cloudflare Workers 生产环境
 * - Workers 有执行时间限制（10ms-30s）
 * - 适用于本地开发和测试
 * - 生产环境建议使用 Cloudflare Queues 或 D1 + Durable Objects
 */

import type { D1Database } from '@cloudflare/workers-types';

export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Task {
  job_id: string;
  task_id: string;
  prompt: string;
  count: number;
  options?: {
    size?: '1024x1024' | '1024x1792' | '1792x1024';
    quality?: 'standard' | 'hd';
  };
  webhook_url?: string;
  status: TaskStatus;
  result?: {
    images: Array<{
      index: number;
      url: string;
      storage_key: string;
      file_name: string;
    }>;
    generation_time: number;
  };
  error?: {
    code: string;
    message: string;
  };
  created_at: string;
  started_at?: string;
  completed_at?: string;
  retry_count: number;
  max_retries: number;
}

type TaskExecutor = (task: Task) => Promise<Task['result']>;

/**
 * 内存版本的任务队列（不依赖 SQLite）
 */
export class TaskQueueService {
  private tasks: Map<string, Task> = new Map();
  private processingInterval: NodeJS.Timeout | null = null;
  private readonly PROCESS_INTERVAL = 1000; // 每秒检查一次队列
  private readonly MAX_RETRIES = 3;
  private isTicking = false;
  private executor: TaskExecutor | null = null;

  constructor(_dbPath?: string) {
    // 忽略 dbPath 参数，使用内存存储
    console.log('⚠️  [TaskQueue] 使用内存队列，数据不会持久化');
  }

  /**
   * 添加新任务到队列
   */
  addTask(params: {
    job_id: string;
    task_id: string;
    prompt: string;
    count: number;
    options?: Task['options'];
    webhook_url?: string;
  }): void {
    const task: Task = {
      job_id: params.job_id,
      task_id: params.task_id,
      prompt: params.prompt,
      count: params.count,
      options: params.options,
      webhook_url: params.webhook_url,
      status: 'pending',
      created_at: new Date().toISOString(),
      retry_count: 0,
      max_retries: this.MAX_RETRIES,
    };

    this.tasks.set(params.job_id, task);
    console.log(`📥 [TaskQueue] 任务已加入队列: ${params.job_id}`);
  }

  /**
   * 开始后台处理任务
   */
  startProcessing(executor: TaskExecutor): void {
    this.executor = executor;

    if (this.processingInterval) {
      return;
    }

    console.log('🛠️  [TaskQueue] 启动后台任务处理器');
    this.processingInterval = setInterval(() => {
      void this.tick();
    }, this.PROCESS_INTERVAL);

    void this.tick(); // 立即尝试处理一次
  }

  /**
   * 停止后台处理
   */
  stopProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    this.executor = null;
  }

  /**
   * 是否已经启动处理器
   */
  hasProcessor(): boolean {
    return !!this.processingInterval;
  }

  private async tick(): Promise<void> {
    if (this.isTicking || !this.executor) {
      return;
    }

    this.isTicking = true;

    try {
      const pendingTasks = this.getPendingTasks(1);

      for (const task of pendingTasks) {
        await this.processTask(task, this.executor);
      }
    } catch (error) {
      console.error('💥 [TaskQueue] 处理任务时出错:', error);
    } finally {
      this.isTicking = false;
    }
  }

  /**
   * 获取任务状态
   */
  getTask(jobId: string): Task | null {
    return this.tasks.get(jobId) || null;
  }

  /**
   * 更新任务状态
   */
  updateTaskStatus(
    jobId: string,
    status: TaskStatus,
    updates?: {
      result?: Task['result'];
      error?: Task['error'];
      started_at?: string;
      completed_at?: string;
    }
  ): void {
    const task = this.getTask(jobId);
    if (!task) {
      throw new Error(`任务不存在: ${jobId}`);
    }

    task.status = status;
    if (updates?.result) task.result = updates.result;
    if (updates?.error) task.error = updates.error;
    if (updates?.started_at) task.started_at = updates.started_at;
    if (updates?.completed_at) task.completed_at = updates.completed_at;

    this.tasks.set(jobId, task);
    console.log(`🔄 [TaskQueue] 任务状态更新: ${jobId} -> ${status}`);
  }

  /**
   * 获取待处理的任务
   */
  getPendingTasks(limit: number = 10): Task[] {
    const allTasks = Array.from(this.tasks.values())
      .filter(t => t.status === 'pending' && t.retry_count < t.max_retries)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, limit);

    return allTasks;
  }

  /**
   * 增加重试次数
   */
  incrementRetry(jobId: string): void {
    const task = this.getTask(jobId);
    if (task) {
      task.retry_count++;
      this.tasks.set(jobId, task);
    }
  }

  /**
   * 发送 Webhook 回调
   */
  async sendWebhook(task: Task): Promise<boolean> {
    if (!task.webhook_url) {
      console.log(`⚠️  [TaskQueue] 任务 ${task.job_id} 没有配置 webhook_url`);
      return true; // 没有 webhook 视为成功
    }

    try {
      console.log(`📡 [TaskQueue] 发送 webhook: ${task.webhook_url}`);

      const payload = {
        job_id: task.job_id,
        task_id: task.task_id,
        status: task.status,
        result: task.result,
        error: task.error,
        completed_at: task.completed_at,
        generation_time: task.result?.generation_time,
      };

      const response = await fetch(task.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ImageGenerationAgent/1.0',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Webhook 返回错误: ${response.status} ${response.statusText}`);
      }

      console.log(`✅ [TaskQueue] Webhook 发送成功: ${task.job_id}`);
      return true;
    } catch (error: any) {
      console.error(`❌ [TaskQueue] Webhook 发送失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 处理单个任务（由外部调用）
   */
  async processTask(
    task: Task,
    executor: (task: Task) => Promise<Task['result']>
  ): Promise<void> {
    try {
      console.log(`⏳ [TaskQueue] 开始处理任务: ${task.job_id}`);

      // 更新状态为处理中
      this.updateTaskStatus(task.job_id, 'processing', {
        started_at: new Date().toISOString(),
      });

      // 执行任务
      const result = await executor(task);

      // 更新状态为完成
      this.updateTaskStatus(task.job_id, 'completed', {
        result,
        completed_at: new Date().toISOString(),
      });

      // 发送 webhook 回调
      const updatedTask = this.getTask(task.job_id)!;
      await this.sendWebhook(updatedTask);

      console.log(`✅ [TaskQueue] 任务处理完成: ${task.job_id}`);
    } catch (error: any) {
      console.error(`❌ [TaskQueue] 任务处理失败: ${task.job_id}`, error);

      // 增加重试次数
      this.incrementRetry(task.job_id);

      // 更新状态为失败
      this.updateTaskStatus(task.job_id, 'failed', {
        error: {
          code: 'EXECUTION_FAILED',
          message: error.message || '任务执行失败',
        },
        completed_at: new Date().toISOString(),
      });

      // 发送失败通知
      const updatedTask = this.getTask(task.job_id)!;
      await this.sendWebhook(updatedTask);
    }
  }

  /**
   * 获取队列统计信息
   */
  getStatistics(): {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    total: number;
  } {
    const allTasks = Array.from(this.tasks.values());

    return {
      pending: allTasks.filter(t => t.status === 'pending').length,
      processing: allTasks.filter(t => t.status === 'processing').length,
      completed: allTasks.filter(t => t.status === 'completed').length,
      failed: allTasks.filter(t => t.status === 'failed').length,
      total: allTasks.length,
    };
  }

  /**
   * 清理旧任务（超过 7 天）
   */
  cleanupOldTasks(): number {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoffDate = sevenDaysAgo.toISOString();

    let deletedCount = 0;
    for (const [jobId, task] of this.tasks.entries()) {
      if (
        task.created_at < cutoffDate &&
        (task.status === 'completed' || task.status === 'failed')
      ) {
        this.tasks.delete(jobId);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`🧹 [TaskQueue] 清理了 ${deletedCount} 个旧任务`);
    }

    return deletedCount;
  }

  close(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    this.executor = null;
    this.isTicking = false;
    this.tasks.clear();
  }
}

// 单例
let taskQueueInstance: TaskQueueService | null = null;

export function getTaskQueue(): TaskQueueService {
  if (!taskQueueInstance) {
    taskQueueInstance = new TaskQueueService();
  }
  return taskQueueInstance;
}

export default TaskQueueService;
