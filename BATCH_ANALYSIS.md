# 批量分析队列功能文档

## 概述

批量分析队列功能允许用户一次提交多个股票代码进行分析，系统会在后台顺序处理这些任务。用户可以关闭浏览器，稍后再回来查看结果。

## 功能特性

1. **批量输入**：支持输入多个股票代码（用逗号分隔）
2. **后台处理**：服务器端 worker 顺序处理队列中的任务
3. **持久化存储**：使用 SQLite 数据库存储任务和结果
4. **状态追踪**：实时显示每个任务的处理状态
5. **离线处理**：用户关闭浏览器后，任务继续在服务器端处理

## 数据库架构

### BatchJob 模型
- `id`: 批量任务唯一标识
- `tickers`: 逗号分隔的股票代码列表
- `status`: 任务状态（PENDING, PROCESSING, COMPLETED, FAILED）
- `language`: 分析语言（en/cn）
- `jobs`: 关联的单个分析任务

### AnalysisJob 模型
- `id`: 单个分析任务唯一标识
- `batchJobId`: 所属批量任务 ID
- `ticker`: 股票代码
- `query`: 原始查询
- `status`: 任务状态
- `result`: 分析结果（JSON 格式）

## API 端点

### POST /api/jobs/batch
创建新的批量任务

**请求体**：
```json
{
  "tickers": "AAPL, MSFT, TSLA",
  "language": "en"
}
```

**响应**：
```json
{
  "batchJobId": "uuid",
  "jobCount": 3,
  "jobs": [
    { "id": "uuid1", "ticker": "AAPL" },
    { "id": "uuid2", "ticker": "MSFT" },
    { "id": "uuid3", "ticker": "TSLA" }
  ]
}
```

### GET /api/jobs/batch/:id
获取批量任务状态

**响应**：
```json
{
  "id": "uuid",
  "tickers": "AAPL, MSFT, TSLA",
  "status": "PROCESSING",
  "overallStatus": "PROCESSING",
  "stats": {
    "total": 3,
    "pending": 1,
    "processing": 1,
    "completed": 1,
    "failed": 0
  },
  "jobs": [...]
}
```

### GET /api/jobs/:id
获取单个任务详情和结果

## 使用方法

### 1. 启动服务器

确保数据库已初始化：
```bash
npx prisma migrate dev
npx prisma generate
```

启动服务器（会自动启动 worker）：
```bash
npm run dev
```

### 2. 提交批量任务

1. 打开应用
2. 勾选"批量模式"复选框
3. 输入多个股票代码，用逗号分隔（如：`AAPL, MSFT, TSLA`）
4. 点击"提交批量任务"

### 3. 查看任务状态

- 任务提交后，页面会显示实时状态
- 显示每个任务的处理进度
- 可以关闭浏览器，稍后再回来查看

### 4. 查看结果

- 任务完成后，可以通过 API 获取结果
- 结果存储在数据库中，可以随时查询

## Worker 工作原理

1. **启动**：服务器启动时自动启动 worker
2. **轮询**：每 2 秒检查一次待处理任务
3. **处理**：顺序处理每个 PENDING 状态的任务
4. **更新状态**：处理过程中更新任务状态
5. **保存结果**：完成后将结果保存到数据库

## 数据库位置

- **开发环境**：`prisma/dev.db` (SQLite)
- **生产环境**：可通过环境变量 `DATABASE_URL` 配置 PostgreSQL 或其他数据库

## 环境变量

```bash
# 数据库连接（SQLite 默认）
DATABASE_URL="file:./dev.db"

# Google Cloud 配置（用于 Vertex AI）
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=us-central1
```

## 故障排除

### Worker 未启动
- 检查服务器日志
- 确认 Vertex AI 客户端初始化成功
- 检查数据库连接

### 任务卡在 PENDING 状态
- 检查 worker 是否运行
- 查看服务器日志中的错误信息
- 确认 Vertex AI API 调用正常

### 数据库错误
- 运行 `npx prisma migrate dev` 确保数据库是最新的
- 检查 `DATABASE_URL` 环境变量
- 确认数据库文件权限

## 性能考虑

1. **顺序处理**：任务按顺序处理，避免 API 速率限制
2. **错误处理**：单个任务失败不影响其他任务
3. **资源管理**：Worker 使用单例模式，避免重复初始化

## 未来改进

1. **并发处理**：支持多个 worker 并发处理
2. **优先级队列**：支持任务优先级
3. **重试机制**：失败任务自动重试
4. **结果通知**：完成后发送通知（邮件/Webhook）
5. **结果导出**：支持导出分析结果为 PDF/Excel

## 代码结构

```
server/
├── db.ts                 # Prisma 客户端
├── worker.ts             # 队列处理 worker
├── routes/
│   ├── jobs.ts          # 批量任务 API
│   └── vertex-ai.ts     # Vertex AI 代理
└── services/
    └── analysis.ts      # 分析逻辑服务

hooks/
└── useBatchJobs.ts      # 批量任务 React Hook

components/
└── SearchComponent.tsx   # 搜索组件（支持批量模式）
```

## 注意事项

1. **数据库备份**：定期备份数据库文件
2. **存储限制**：SQLite 适合中小规模使用，大规模建议使用 PostgreSQL
3. **API 限制**：注意 Vertex AI API 的速率限制
4. **错误处理**：确保 worker 的错误处理逻辑完善
