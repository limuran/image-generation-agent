-- Migration 0001: Initial Schema
-- Created: 2025-10-19
-- Description: Create tables for task authentication and task memory

-- ============================================
-- Task Auth Table
-- 用于存储认证 token
-- ============================================
CREATE TABLE IF NOT EXISTS task_auth (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  kid TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('active', 'revoked')) DEFAULT 'active'
);

-- Indexes for task_auth
CREATE INDEX IF NOT EXISTS idx_task_auth_task_id ON task_auth(task_id);
CREATE INDEX IF NOT EXISTS idx_task_auth_kid ON task_auth(kid);
CREATE INDEX IF NOT EXISTS idx_task_auth_status ON task_auth(status);
CREATE INDEX IF NOT EXISTS idx_task_auth_created_at ON task_auth(created_at DESC);

-- ============================================
-- Task Memory Table
-- 用于存储图片生成历史
-- ============================================
CREATE TABLE IF NOT EXISTS task_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  optimized_prompt TEXT,
  generated_images TEXT NOT NULL,  -- JSON array
  count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Indexes for task_memory
CREATE INDEX IF NOT EXISTS idx_task_memory_task_id ON task_memory(task_id);
CREATE INDEX IF NOT EXISTS idx_task_memory_created_at ON task_memory(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_memory_expires_at ON task_memory(expires_at);

-- Composite index for common query pattern
CREATE INDEX IF NOT EXISTS idx_task_memory_task_expires
  ON task_memory(task_id, expires_at);
