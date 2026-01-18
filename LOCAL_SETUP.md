# 本地开发环境设置指南

## 问题分析

您遇到的"页面完全空白"问题主要由以下原因导致：

1. **模块加载时抛出错误**：`services/gemini.ts` 在模块加载时就检查 `process.env.API_KEY`，如果不存在就抛出错误，导致整个应用无法加载。

2. **浏览器环境限制**：
   - 在浏览器中，`process.env` 默认不存在
   - Vite 需要使用 `import.meta.env.VITE_*` 前缀访问环境变量
   - Vertex AI 在浏览器中**不能直接使用应用默认凭据（ADC）**，因为 ADC 需要访问本地文件系统或元数据服务器

3. **环境差异**：
   - Vertex AI 沙盒环境可能提供了 `process.env` polyfill 或 API_KEY
   - 本地浏览器环境需要不同的配置方式

## 解决方案

### 方案 1：使用 API Key（推荐用于浏览器环境）

如果您有 Vertex AI 的 API Key，可以这样设置：

1. 创建 `.env.local` 文件（在项目根目录）：
```bash
VITE_API_KEY=your-api-key-here
```

2. 启动开发服务器：
```bash
npm run dev
```

### 方案 2：使用后端代理（推荐用于生产环境）

由于 Vertex AI 在浏览器中不能直接使用应用默认凭据，最佳实践是创建一个后端代理：

1. **创建后端代理服务器**（例如使用 Node.js + Express）：
   - 后端服务器使用应用默认凭据（ADC）调用 Vertex AI
   - 前端通过 HTTP 请求调用后端 API
   - 后端转发请求到 Vertex AI 并返回结果

2. **修改前端代码**：
   - 将 Vertex AI 调用改为调用后端 API
   - 后端处理认证和 Vertex AI 请求

### 方案 3：使用应用默认凭据（仅适用于服务器端）

如果您在服务器端运行（例如 Node.js 服务器），可以：

1. 确保已运行：
```bash
gcloud auth application-default login
```

2. 设置项目 ID（如果需要）：
```bash
export GOOGLE_CLOUD_PROJECT=your-project-id
```

3. 确保有正确的 IAM 权限：
   - `roles/aiplatform.user`
   - `roles/vertexai.user`

## 已完成的修改

我已经对代码进行了以下修改：

1. **修改了 `services/gemini.ts`**：
   - 支持浏览器环境（`import.meta.env.VITE_API_KEY`）
   - 支持 Node.js 环境（`process.env.API_KEY`）
   - 延迟初始化，避免模块加载时抛出错误
   - 更好的错误处理和提示信息

2. **创建了 `vite.config.ts`**：
   - 配置了 Vite 开发服务器
   - 定义了 `process.env` 的兼容性支持

3. **添加了错误边界**：
   - 在 `index.tsx` 中添加了 ErrorBoundary 组件
   - 捕获初始化错误并显示友好的错误信息

## 测试步骤

1. **检查浏览器控制台**：
   - 打开浏览器开发者工具（F12）
   - 查看 Console 标签页是否有错误信息
   - 查看 Network 标签页是否有失败的请求

2. **验证环境变量**：
   - 如果使用 API Key，确保 `.env.local` 文件存在且包含 `VITE_API_KEY`
   - 如果使用 ADC，确保已运行 `gcloud auth application-default login`

3. **测试应用**：
   - 启动开发服务器：`npm run dev`
   - 尝试搜索一个股票代码（如 "AAPL"）
   - 观察是否有错误信息显示

## 常见问题

### Q: 为什么在 Vertex AI 环境中能运行，但本地不行？

A: Vertex AI 沙盒环境可能：
- 提供了 `process.env` polyfill
- 自动配置了应用默认凭据
- 提供了 API Key 环境变量

### Q: 浏览器中可以使用应用默认凭据吗？

A: **不可以**。应用默认凭据需要访问本地文件系统或元数据服务器，浏览器安全限制不允许这样做。您需要：
- 使用 API Key，或
- 创建后端代理服务器

### Q: 如何获取 Vertex AI API Key？

A: Vertex AI 通常使用服务账号密钥或应用默认凭据，而不是传统的 API Key。对于浏览器环境，建议使用后端代理。

## 下一步

1. 根据您的使用场景选择合适的方案
2. 如果使用 API Key，创建 `.env.local` 文件
3. 如果使用后端代理，创建代理服务器代码
4. 测试应用是否正常工作

如果问题仍然存在，请检查浏览器控制台的错误信息，这将帮助进一步诊断问题。
