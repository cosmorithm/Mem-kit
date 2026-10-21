# Mem-kit

> 给项目记忆用的引导程序与工具。A single-file boot protocol for project memory, plus an optional zero-dependency toolkit.

`BootMemory.md` 是引导程序：把它放进任何项目根目录，AI 读到它就会按固定顺序启动——自检、找记忆、加载、校验、移交；如果项目里还没有 `memory/`，它会现场安装一个。

`memory-kit` 是可选驱动：校验契约、生成索引、输出摘要、脚手架新单元。零依赖，Node 18+，可以整个目录拷走。

只有 `BootMemory.md` 也能用（手写记忆 + 人工自检）；装上 `memory-kit` 之后才有自动校验和自动索引。

## 快速开始

```sh
git clone https://github.com/cosmorithm/Mem-kit.git ~/.bootmemory
~/.bootmemory/install.sh /path/to/your-project
```

然后对你的 AI 说：

```text
请阅读 BootMemory.md
```

之后每次新会话，同一句话即可。项目里没有 `memory/` 时，它会走首次安装流程。

### 没有网络时

```sh
cp ~/.bootmemory/BootMemory.md /path/to/project/
cp -R ~/.bootmemory/memory-kit /path/to/project/
```

装完之后项目完全离线可用。

## 仓库内容

| 路径 | 作用 |
| --- | --- |
| `BootMemory.md` | 引导程序。九个阶段：自检、找设备、加载、校验、首次安装、恢复、运行期纪律、移交 |
| `memory-kit/SPEC.md` | 记忆契约：章节类型、证据等级、变量、校验规则、版本升级 |
| `memory-kit/lib/memory.mjs` | 解析、校验、渲染、摘要、索引 |
| `memory-kit/bin/memory.mjs` | 命令行入口 |
| `memory-kit/templates/unit.md` | 新单元骨架 |
| `examples/demo/` | 可校验的最小项目，CI 每次都会跑它 |
| `install.sh` | 安装脚本，幂等，默认不覆盖已有文件 |

## 三个能力

```sh
# 契约校验：编号、表格、变量、证据标记、索引新鲜度
node memory-kit/bin/memory.mjs check --config memory/memory.config.json

# 自动索引：生成 memory/index.md（当前状态）
node memory-kit/bin/memory.mjs index --config memory/memory.config.json

# 摘要：给接续会话读的压缩版本
node memory-kit/bin/memory.mjs digest --config memory/memory.config.json --unit <id>

# 新建单元
node memory-kit/bin/memory.mjs new <id> --title "标题"

# 查看装的是哪一版（工具版本 + 支持的契约版本）
node memory-kit/bin/memory.mjs version
```

多单元只需在 `memory/memory.config.json` 的 `units` 里追加：

```json
{
  "version": 1,
  "staleAfterDays": 30,
  "units": [
    { "id": "hello", "file": "hello/unit.md" },
    { "id": "deploy", "file": "deploy/unit.md" }
  ]
}
```

`site` 字段是可选的：不接站点（纯记忆项目）时可以不写。

## 契约摘要

六类章节，各有不同的更新纪律：

| 类型 | 装什么 | 什么时候改 |
| --- | --- | --- |
| `guide` | 范围、路径、阅读顺序 | 结构变了才改 |
| `facts` | 当前事实、状态、版本 | 覆盖，并更新核对日期 |
| `session` | 某次会话或实验 | 只追加 |
| `pitfalls` | 报错 → 原因 → 处理 | 累积 |
| `plan` | 待办与路线 | 完成即删除 |
| `refs` | 外部资料 | 只追加 |

证据等级，不得跨级表述：

| 等级 | 含义 | 不能证明 |
| --- | --- | --- |
| E0 | 计划或推测 | 任何已完成状态 |
| E1 | 文档、规范、论文 | 本机版本的具体行为 |
| E2 | 本机源码，或某次运行的日志 | 可重复性 |
| E3 | 磁盘产物，或隔离的模拟测试 | 实机正确性 |
| E4 | 实机人工确认 | 泛化性 |

完整规则见 [`memory-kit/SPEC.md`](memory-kit/SPEC.md)。

## 版本

| 组件 | 版本 |
| --- | --- |
| 记忆契约 | v1 |
| BootMemory | v1 |
| memory-kit | v1.1.0 |

单元头部写 `"memory": 1`。工具遇到非 v1 的单元会直接报错，而不是按旧规则猜新格式。

## 开发

```sh
# 校验示例项目
node memory-kit/bin/memory.mjs check --config examples/demo/memory/memory.config.json

# 安装脚本冒烟测试
mkdir -p /tmp/memkit-target
./install.sh /tmp/memkit-target
```

CI 在 Node 18 与 20 上跑同样两条。

## 许可

MIT。见 [LICENSE](LICENSE)。
