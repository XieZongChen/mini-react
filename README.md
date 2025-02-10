# mini-react

## 项目架构

react 项目会被 babel 等构建工具使用引入的 react/jsx-runtime 的包，将 jsx 文件编译为 js 文件。

依据这个过程，本项目使用 tsc 在编译过程中将 jsx 编译结果替换为自己实现的 `MiniReact.createElement`，具体可见 [TS 配置](./tsconfig.json)。从而实现对自己实现的 mini-react 进行用例测试。

## 项目使用方式

1. 开启一个终端，使用 tsc 进行编译

```bash
npx tsc -w
```

2. 开启另一个终端，使用 http-server 跑本地服务

```bash
npx http-server .
```

3. 在 `index.html` 中切换不同的 jsx 可切换用例，通过控制台进行 debug
