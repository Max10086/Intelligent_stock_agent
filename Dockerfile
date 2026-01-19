# 使用 Node.js 20 Alpine 作为基础镜像
FROM node:20-alpine AS builder

# 设置工作目录
WORKDIR /app

# 1. 复制依赖定义文件
COPY package*.json ./

# 2. 安装依赖
RUN npm ci

# 3. 复制所有源代码
COPY . .

# --- 【修正】 先设置假变量，再运行 Prisma 生成 ---
# 必须放在 npx prisma generate 之前！
ARG DATABASE_URL
ENV DATABASE_URL="file:./dev.db"

# 4. 生成 Prisma Client
RUN npx prisma generate

# 5. 注入构建时环境变量 (前端变量)
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

# 6. 构建 Next.js 应用
RUN npm run build

# --- Production Stage ---
FROM node:20-alpine AS runner

WORKDIR /app

# 设置生产环境变量
ENV NODE_ENV=production

# 7. 复制构建产物
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

# 8. 暴露端口
ENV PORT=8080
EXPOSE 8080

# 9. 启动命令
CMD ["npm", "start"]