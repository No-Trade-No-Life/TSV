# TSV

纯浏览器内运行的时间序列复盘工具。导入 CSV 或 Parquet 后，在本地完成解析和绘图；文件不会上传到任何服务端。

## 本地开发

```bash
npm install
npm run dev
```

## 数据与图表配置

左侧的“数据文件”直接管理 JSON 的 `data` 数组：可新增、编辑或删除数据文件条目。每项都有稳定的 `id`、工作区相对路径 `filename`，以及自己的 `timeColumn`。图层通过 `sourceId` 引用这些条目；选择路径后应用会自动读取和缓存数据，再显示列选择器。删除数据文件会一并删除其图层和内存缓存。

先添加工作区，再在每项的模糊路径选择器中选择索引到的文件；应用会按相对路径自动解析对应数据。JSON 可以先导入，再选择工作区；空路径也可用于导出尚未完成的数据文件模板。JSON 永远不保存绝对路径、文件内容或浏览器目录句柄。

### 本地工作区

在 Chromium 系浏览器中，可通过“添加工作区”选择本地目录。TSV 使用 `FileSystemDirectoryHandle` 的 `read` 模式，仅递归建立 CSV、Parquet 和 PQ 文件的相对路径索引；不会申请写权限。目录句柄会连同 UUID `workspace_id` 持久化到浏览器 IndexedDB，并出现在 URL 的 `#workspace=<workspace_id>`。刷新页面后，应用会自动恢复该工作区；只有浏览器撤销了既有授权时，才需要点击重新授权。数据文件配置使用模糊路径选择器从该索引中选择文件，随后自动读取和缓存，无需额外的“绑定”动作。

导出的 JSON 是图表元数据。它只保存工作区相对路径，不保存文件内容、绝对路径或浏览器目录句柄，因此不会扩大浏览器对本机文件的访问范围。核心结构如下：

```json
{
  "version": 3,
  "data": [
    { "id": "price", "filename": "price.parquet", "timeColumn": "date" },
    { "id": "signals", "filename": "signals.csv", "timeColumn": "timestamp" }
  ],
  "mappings": [
    { "id": "ohlc", "sourceId": "price", "kind": "candlestick", "name": "价格", "color": "#c6dd62", "openColumn": "open", "highColumn": "high", "lowColumn": "low", "closeColumn": "close" },
    { "id": "volume", "sourceId": "price", "kind": "histogram", "name": "成交量", "color": "#72c7e8", "valueColumn": "volume" },
    { "id": "signal", "sourceId": "signals", "kind": "markers", "name": "信号", "color": "#ea9c62", "valueColumn": "price", "textColumn": "signal" },
    { "id": "plan", "sourceId": "signals", "kind": "segment", "name": "计划线", "color": "#c5a0eb", "valueColumn": "entry", "endTimeColumn": "exit_time", "endValueColumn": "exit" }
  ]
}
```

`data[].id` 是图层的稳定引用，`data[].filename` 是浏览器选择本地文件时的匹配契约（工作区模式下可填写相对路径），`mappings[].sourceId` 决定图层读哪个文件；每一个源使用自己的 `timeColumn`。线段将该源一行中的时间列与 `endTimeColumn` 相连，并使用 `valueColumn` 与 `endValueColumn` 作为两端数值。导入时缺失的图层 `id`、名称或颜色会自动补齐；未知图形类型、重复 ID/文件名或不存在的数据源引用会被拒绝。

## 部署

推送至 `main` 会由 GitHub Pages Actions 构建并发布。`public/CNAME` 指定生产域名为 `tsv.ntnl.io`；首次发布后，还需在 GitHub Pages 设置中选择 **GitHub Actions** 作为 Source，并为该域名配置 DNS。
