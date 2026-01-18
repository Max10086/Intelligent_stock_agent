# 使用 Node.js 20 Alpine 作为基础镜像
FROM node:20-alpine AS builder

# 设置工作目录
WORKDIR /app

# 1. 复制依赖定义文件
# 这一步你已经改对了，很好
COPY package*.json ./

# 2. 安装依赖
RUN npm ci

# 3. 复制所有源代码
COPY . .

# 4. 【关键新增】生成 Prisma Client
# 必须在构建前生成数据库客户端，否则运行时会报找不到 PrismaClient
RUN npx prisma generate

# 5. 注入构建时环境变量 (前端变量)
# Next.js 在 build 时会将 NEXT_PUBLIC_ 开头的变量硬编码到前端 JS 中
# 如果你有其他 NEXT_PUBLIC 变量，也需要在这里声明 ARG
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

# 6. 构建 Next.js 应用
RUN npm run build

# --- Production Stage ---
# 使用一个新的轻量级镜像运行服务
FROM node:20-alpine AS runner

WORKDIR /app

# 设置生产环境变量
ENV NODE_ENV=production

# 7. 复制构建产物
# 我们需要把 builder 阶段生成的 .next 文件夹、依赖和必要文件复制过来
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
# 别忘了复制 Prisma 的 schema 和生成的 client (如果有自定义路径)
COPY --from=builder /app/prisma ./prisma

# 8. 暴露端口 (Cloud Run 默认要求监听 8080，或者通过 PORT 环境变量控制)
ENV PORT=8080
EXPOSE 8080

# 9. 启动命令
# 不再是 nginx，而是启动 Next.js 的生产服务器
CMD ["npm", "start"]