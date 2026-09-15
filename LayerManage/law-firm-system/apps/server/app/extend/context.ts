import { PrismaClient } from '@prisma/client';

// 扩展 Context 类型
declare module 'egg' {
  interface Context {
    prisma: PrismaClient;
  }
}

// Prisma 客户端实例（单例）
let prisma: PrismaClient;

export default {
  get prisma(): PrismaClient {
    if (!prisma) {
      // Keep request diagnostics to the error code/category at the HTTP boundary.
      prisma = new PrismaClient({ errorFormat: 'minimal' });
    }
    return prisma;
  },
};
