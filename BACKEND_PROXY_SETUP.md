# 后端代理服务器设置指南

## 概述

本项目现在使用后端代理服务器来处理 Vertex AI 请求。这种方式的好处是：

1. **安全性**：应用默认凭据（ADC）只在服务器端使用，不会暴露给浏览器
2. **兼容性**：浏览器环境无法直接使用 ADC，通过后端代理可以解决这个问题
3. **灵活性**：可以在服务器端进行请求处理、缓存、日志记录等

## 架构说明

```
浏览器 (前端)
  ↓ HTTP 请求
Vite 开发服务器 (代理 /api/*)
  ↓ 转发请求
Express 后端服务器 (端口 3001)
  ↓ 使用 ADC
Vertex AI API
```

## 安装依赖

首先安装所有依赖（包括新增的后端依赖）：

```bash
npm install
```

新增的依赖包括：
- `express` - Web 服务器框架
- `cors` - 跨域资源共享支持
- `tsx` - TypeScript 执行器（用于开发）
- `concurrently` - 同时运行多个命令

## 配置应用默认凭据（ADC）

确保您已经配置了 Google Cloud 应用默认凭据：

```bash
gcloud auth application-default login
```

这将为您的本地环境设置应用默认凭据，后端服务器将使用这些凭据来调用 Vertex AI API。

## 运行项目

### 开发模式（推荐）

使用以下命令同时启动前端和后端：

```bash
npm run dev
```

这将：
- 启动后端服务器在 `http://localhost:3001`
- 启动前端开发服务器在 `http://localhost:3000`
- Vite 会自动代理 `/api/*` 请求到后端服务器

### 分别启动（调试用）

如果需要分别启动前端和后端：

**终端 1 - 启动后端：**
```bash
npm run dev:server
```

**终端 2 - 启动前端：**
```bash
npm run dev:client
```

## 项目结构

```
intelligent-stock-agent/
├── server/                 # 后端服务器代码
│   ├── index.ts           # Express 服务器主文件
│   ├── routes/
│   │   └── vertex-ai.ts   # Vertex AI API 路由
│   └── tsconfig.json      # TypeScript 配置
├── services/
│   └── gemini.ts          # 前端 API 客户端（调用后端）
└── vite.config.ts         # Vite 配置（包含代理设置）
```

## API 端点

### POST /api/vertex-ai/generate-content

代理 Vertex AI 的 `generateContent` 请求。

**请求体：**
```json
{
  "model": "gemini-2.5-flash",
  "contents": {
    "role": "user",
    "parts": [{ "text": "Your prompt here" }]
  },
  "config": {
    "responseMimeType": "application/json",
    "responseSchema": { ... }
  }
}
```

**响应：**
```json
{
  "text": "Response text",
  "candidates": [...],
  "groundingMetadata": {...}
}
```

### GET /health

健康检查端点，用于验证后端服务器是否运行。

## 环境变量

### 开发环境

在开发环境中，Vite 会自动代理 `/api/*` 请求到后端服务器，无需额外配置。

### 生产环境

在生产环境中，您需要设置 `VITE_API_BASE_URL` 环境变量来指定后端服务器的地址：

```bash
export VITE_API_BASE_URL=https://your-backend-server.com
```

或者在 `.env.production` 文件中：

```
VITE_API_BASE_URL=https://your-backend-server.com
```

## 故障排除

### 1. 后端服务器无法启动

**错误：** `Failed to initialize Vertex AI client`

**解决方案：**
- 确保已运行 `gcloud auth application-default login`
- 检查是否有正确的 IAM 权限（`roles/aiplatform.user` 或 `roles/vertexai.user`）
- 验证 Google Cloud 项目 ID 是否正确设置

### 2. 前端无法连接到后端

**错误：** `Failed to connect to backend server`

**解决方案：**
- 确保后端服务器正在运行（检查 `http://localhost:3001/health`）
- 检查端口 3001 是否被其他程序占用
- 查看浏览器控制台的网络请求，确认请求是否正确发送

### 3. CORS 错误

**错误：** `CORS policy` 相关错误

**解决方案：**
- 后端已配置 CORS，应该不会有此问题
- 如果仍有问题，检查 `server/index.ts` 中的 CORS 配置

### 4. 权限错误

**错误：** `Permission denied` 或 `403 Forbidden`

**解决方案：**
- 检查 IAM 权限：确保您的账户有 Vertex AI 使用权限
- 验证项目 ID 和区域设置是否正确
- 运行 `gcloud auth application-default login` 重新认证

## 构建和部署

### 构建前端

```bash
npm run build
```

### 构建后端

```bash
npm run build:server
```

### 生产环境部署

1. **构建项目：**
   ```bash
   npm run build
   npm run build:server
   ```

2. **设置环境变量：**
   ```bash
   export GOOGLE_CLOUD_PROJECT=your-project-id
   export PORT=3001
   ```

3. **启动后端服务器：**
   ```bash
   npm run start:server
   ```

4. **部署前端：**
   - 将 `dist` 目录部署到静态文件服务器（如 Nginx）
   - 配置反向代理，将 `/api/*` 请求转发到后端服务器

## 安全注意事项

1. **不要在前端暴露 API Key**：所有 Vertex AI 调用都通过后端进行
2. **使用环境变量**：敏感配置使用环境变量，不要提交到代码仓库
3. **限制 CORS**：在生产环境中，限制 CORS 允许的来源
4. **使用 HTTPS**：在生产环境中使用 HTTPS 保护数据传输

## 下一步

- 查看 `LOCAL_SETUP.md` 了解本地开发设置
- 查看项目 README 了解项目整体功能
- 如有问题，请检查浏览器控制台和后端服务器日志
