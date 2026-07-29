# 外部程序管理 TSV 工作区与 View

外部程序可以直接写入工作区根目录的 `tsv.config.json` 和 `.tsv/views/<view-id>.json`。TSV 在浏览器中读取这些文件；不会上传数据文件或 JSON 到服务端。

```text
<workspace>/
├── tsv.config.json
├── price.parquet
├── signals.csv
└── .tsv/
    └── views/
        └── <view-id>.json
```

## 工作区配置

`tsv.config.json` 必须包含稳定的 UUID。外部程序创建工作区时应写入它；后续不得更改 `workspace_id`，否则浏览器会把同一目录视为另一个工作区。

```json
{
  "workspace_id": "8d26c4f5-8ef3-4d04-a2fb-b1e5d8e31aa3",
  "display_name": "我的行情数据"
}
```

`display_name` 可选。TSV 只会扫描 CSV、Parquet 和 PQ 文件，并以相对于工作区根目录的路径引用它们。

## View 文件

每个 View 位于 `.tsv/views/<view-id>.json`。文件名中的 `<view-id>` 必须与 JSON 中的 `view.id` 完全相同，并且是 UUID。

以下示例在价格主图上显示蜡烛、信号 Marker 和计划线，并在副图显示成交量：

```json
{
  "version": 4,
  "data": [
    {
      "id": "price",
      "workspaceId": "8d26c4f5-8ef3-4d04-a2fb-b1e5d8e31aa3",
      "filename": "price.parquet",
      "timeColumn": "date"
    },
    {
      "id": "signals",
      "workspaceId": "8d26c4f5-8ef3-4d04-a2fb-b1e5d8e31aa3",
      "filename": "signals.csv",
      "timeColumn": "timestamp"
    }
  ],
  "view": {
    "id": "f32d7ef5-8bc1-4cd4-9f48-a2de9a4dcad2",
    "name": "IF 日内复盘",
    "panes": [
      { "id": "primary", "name": "主图" },
      { "id": "volume", "name": "成交量" }
    ]
  },
  "mappings": [
    {
      "id": "ohlc",
      "sourceId": "price",
      "paneId": "primary",
      "kind": "candlestick",
      "name": "价格",
      "color": "#c6dd62",
      "openColumn": "open",
      "highColumn": "high",
      "lowColumn": "low",
      "closeColumn": "close"
    },
    {
      "id": "volume",
      "sourceId": "price",
      "paneId": "volume",
      "kind": "histogram",
      "name": "成交量",
      "color": "#72c7e8",
      "valueColumn": "volume"
    },
    {
      "id": "signal",
      "sourceId": "signals",
      "paneId": "primary",
      "kind": "markers",
      "name": "信号",
      "color": "#ea9c62",
      "valueColumn": "price",
      "textColumn": "signal"
    }
  ]
}
```

约束：`data[].id`、`mappings[].id` 与 `view.panes[].id` 分别必须唯一；每个 `sourceId` 和 `paneId` 必须指向已有对象。`candlestick` 需要 Open、High、Low、Close 列；`line`、`histogram` 与 `markers` 使用 `valueColumn`；`markers` 可选 `textColumn`；`segment` 使用 `valueColumn`、`endTimeColumn` 和 `endValueColumn`。

外部程序写入时应先写入临时文件，再通过原子重命名替换目标文件，避免 TSV 扫描到不完整 JSON。目录或文件变化后，用户在 TSV 的“工作区管理”中点击“刷新”即可重新扫描。

## 直接打开指定 View

使用 URL Hash 传递 View 与可选的图表状态：

```text
https://tsv.ntnl.io/#view_id=f32d7ef5-8bc1-4cd4-9f48-a2de9a4dcad2&start_time=1722513000000&end_time=1722516600000&focus_time=1722514200000
```

`view_id` 是必填 UUID。`start_time` 和 `end_time` 为可选的 Unix 毫秒时间戳，用于恢复可见时间范围，且 `start_time` 必须小于 `end_time`。`focus_time` 为可选的 Unix 毫秒时间戳，对应用户在图表上点击的焦点时间，而不是鼠标悬浮位置。

浏览器必须已经通过 TSV 添加并授权包含该 View 的工作区。Hash 只选择已扫描到的 View，不能替代浏览器的本地目录授权；若多个已授权工作区有同一个 View ID，TSV 会使用扫描列表中的第一个匹配项。

## 通过 iframe 集成

外部站点可以直接嵌入 TSV。父页面将完整 Hash 放到 iframe 的 `src`，即可指定初始 View、可见范围和焦点时间。

```html
<iframe
  src="https://tsv.ntnl.io/#view_id=f32d7ef5-8bc1-4cd4-9f48-a2de9a4dcad2&start_time=1722513000000&end_time=1722516600000&focus_time=1722514200000"
  allow="file-system-access"
  title="时间序列复盘"
  style="width: 100%; height: 720px; border: 0"
></iframe>
```

`allow="file-system-access"` 将浏览器的文件系统访问权限委托给 TSV。不要为该 iframe 设置 `sandbox`；它会改变页面的安全上下文，并可能阻止本地目录权限和持久化存储正常工作。父页面自身的 Content Security Policy 也必须允许加载 `https://tsv.ntnl.io`。

### 本地目录权限

TSV 始终在 iframe 内部请求本地目录权限。父页面无法代替用户选择目录、读取目录内容或授权 `FileSystemDirectoryHandle`。用户需要在 iframe 中点击“工作区管理”，再添加和授权工作区。

目录句柄保存在 `tsv.ntnl.io` 的浏览器存储中。部分浏览器会按顶层站点分区第三方 iframe 存储，因此不能假设用户在顶层打开 TSV 时的工作区，会自动出现在每个嵌入站点中。集成方应为用户提供首次在 iframe 内添加工作区的流程。

### 集成边界

父页面可以通过替换 iframe 的 `src` 改变 View 或图表状态。当前 TSV 没有 `postMessage` 协议，因此父页面不能读取工作区、控制已打开图表，或接收图表交互事件。
