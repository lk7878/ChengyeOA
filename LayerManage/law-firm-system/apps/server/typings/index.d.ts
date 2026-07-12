import 'egg';

declare module 'egg' {
  interface Application {
    // 可以在这里扩展 Application 类型
  }

  interface Context {
    // prisma 由 egg-ts-helper 自动生成类型，此处不重复声明
  }
}
