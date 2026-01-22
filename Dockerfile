# --- Stage 1: Build ---
    FROM node:20-alpine AS builder

    WORKDIR /app
    
    # 1. 复制依赖定义文件
    COPY package*.json ./
    
    # 2. 安装依赖
    RUN npm ci
    
    # 3. 复制所有源代码
    COPY . .
    
    # 4. 生成 Prisma Client (使用假变量骗过构建检查)
    ARG DATABASE_URL
    ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
    RUN npx prisma generate
    
    # 5. 注入前端构建变量 (Cloud Build 构建时传入)
    ARG NEXT_PUBLIC_SUPABASE_URL
    ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
    ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
    ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    # 6. 构建前端 (Vite) -> 生成 dist 文件夹
    RUN npm run build
    
    # --- Stage 2: Runner ---
    FROM node:20-alpine AS runner
    
    WORKDIR /app
    
    # 暂时不强制设置 production，确保 tsx 能读取 devDependencies
    # ENV NODE_ENV=production
    
    # 7. 复制构建产物
    
    # A. 基础依赖和配置
    COPY --from=builder /app/package.json ./package.json
    COPY --from=builder /app/node_modules ./node_modules
    COPY --from=builder /app/tsconfig.json ./tsconfig.json
    
    # B. 数据库相关
    COPY --from=builder /app/prisma ./prisma
    
    # C. 前端静态文件 (Vite 构建产物)
    COPY --from=builder /app/dist ./dist
    
    # D. 后端源码
    COPY --from=builder /app/server ./server
    
    # E. 【关键】复制类型定义文件
    # 因为你的 server 代码引用了根目录的 types.ts
    COPY --from=builder /app/types.ts ./types.ts



    # 【F. 新增这行！】复制根目录下的 services 文件夹
    COPY --from=builder /app/services ./services
    
    # 8. 暴露端口
    ENV PORT=8080
    EXPOSE 8080
    
    # 9. 启动命令
    # 对应 package.json 中的 "start": "tsx server/index.ts"
    CMD ["npm", "start"]