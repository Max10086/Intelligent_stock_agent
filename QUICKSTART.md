# 快速启动指南

## 前置要求

1. **Node.js** (v18 或更高版本)
2. **Google Cloud SDK** (gcloud)
3. **已配置的应用默认凭据**

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 Google Cloud 凭据

```bash
gcloud auth application-default login
```

这将为您的本地环境设置应用默认凭据，后端服务器将使用这些凭据来调用 Vertex AI API。

### 3. 启动项目

```bash
npm run dev
```

这个命令会同时启动：
- 后端服务器：`http://localhost:3001`
- 前端开发服务器：`http://localhost:3000`

### 4. 访问应用

打开浏览器访问：`http://localhost:3000`

## 验证安装

### 检查后端服务器

访问 `http://localhost:3001/health`，应该看到：

```json
{
  "status": "ok",
  "message": "Backend server is running"
}
```

### 检查前端

打开浏览器开发者工具（F12），查看：
- **Console**：应该没有错误
- **Network**：API 请求应该成功（状态码 200）

## 常见问题

### 后端服务器无法启动

**症状：** 看到 "Failed to initialize Vertex AI client" 错误

**解决：**
1. 确保已运行 `gcloud auth application-default login`
2. 检查 Google Cloud 项目设置
3. 验证 IAM 权限

### 前端页面空白

**症状：** 浏览器页面完全空白

**解决：**
1. 检查浏览器控制台是否有错误
2. 确认后端服务器正在运行
3. 检查网络请求是否成功

### 端口被占用

**症状：** 端口 3000 或 3001 已被使用

**解决：**
- 修改 `vite.config.ts` 中的端口（前端）
- 修改 `server/index.ts` 中的 PORT 环境变量（后端）
- 或使用环境变量：`PORT=3002 npm run dev:server`

## 下一步

- 查看 `BACKEND_PROXY_SETUP.md` 了解详细配置
- 查看 `LOCAL_SETUP.md` 了解本地开发设置
- 开始使用应用进行股票分析！
