# --- Stage 1: Build ---
    FROM node:20-alpine AS builder

    WORKDIR /app
    
    # 1. 复制依赖文件
    COPY package*.json ./
    
    # 2. 安装所有依赖 (包括 tsx 等 devDependencies，因为我们要用 tsx 运行)
    RUN npm ci
    
    # 3. 复制所有源代码
    COPY . .
    
    # 4. 生成 Prisma Client (骗过构建检查)
    ARG DATABASE_URL
    ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
    RUN npx prisma generate
    
    # 5. 注入前端构建变量 (必须在构建阶段存在)
    ARG NEXT_PUBLIC_SUPABASE_URL
    ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
    ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
    ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    # 6. 构建前端 (Vite) -> 生成 dist 文件夹
    RUN npm run build
    
    # --- Stage 2: Runner ---
    FROM node:20-alpine AS runner
    
    WORKDIR /app
    
    # 设置生产环境 (注意：有些库在 production 下会表现不同，但 tsx 需要 devDeps)
    # 为了保险，我们这里暂时不强制设置 NODE_ENV=production，以免 tsx 找不到
    # ENV NODE_ENV=production
    
    # 7. 复制构建产物
    
    # A. 复制 package.json
    COPY --from=builder /app/package.json ./package.json
    
    # B. 复制 node_modules (包含 tsx 和 prisma)
    COPY --from=builder /app/node_modules ./node_modules
    
    # C. 复制 Prisma 文件夹
    COPY --from=builder /app/prisma ./prisma
    
    # D. 【前端】复制 Vite 构建出的静态文件 (dist)
    COPY --from=builder /app/dist ./dist
    
    # E. 【后端】复制后端源码 (server) -> 供 tsx 运行
    COPY --from=builder /app/server ./server
    # 如果 server 依赖了根目录下的 lib 文件夹，也需要复制 (根据你的项目结构)
    COPY --from=builder /app/lib ./lib
    COPY --from=builder /app/tsconfig.json ./tsconfig.json
    
    # 8. 暴露端口
    ENV PORT=8080
    EXPOSE 8080
    
    # 9. 启动命令 (运行 package.json 里的 "start": "tsx server/index.ts")
    CMD ["npm", "start"]