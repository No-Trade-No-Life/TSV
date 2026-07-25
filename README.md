# TSV

纯浏览器内运行的时间序列复盘工具。添加一个或多个本地工作区后，在本地完成 CSV/Parquet 解析和绘图；文件不会上传到任何服务端。

## 本地开发

```bash
npm install
npm run dev
```

## 数据与图表配置

左侧的“数据文件”直接管理 JSON 的 `data` 数组：每项都有稳定的 `id`、所属 `workspaceId`、工作区相对路径 `filename`，以及自己的 `timeColumn`。图层通过 `sourceId` 引用这些条目；选择路径后应用会自动读取和缓存数据，再显示列选择器。删除数据文件会一并删除其图层和内存缓存。

“搜索文件”弹窗会跨所有已授权工作区模糊搜索 CSV、Parquet 与 PQ 文件；可先展开预览前 12 行，再将文件加入数据源或替换已有数据源。JSON 可以先导入，再选择工作区；空路径也可用于导出尚未完成的数据文件模板。JSON 永远不保存绝对路径、文件内容或浏览器目录句柄。

一个 View 包含多个 Pane：主图和任意数量的副图都可以拥有多个图层。每个图层通过 `paneId` 放入目标 Pane。

### 本地工作区

在 Chromium 系浏览器中，可通过“添加工作区”选择多个本地目录。TSV 使用 `FileSystemDirectoryHandle` 的 `read` 模式，仅递归建立 CSV、Parquet 和 PQ 文件的相对路径索引；不会申请写权限。每个目录句柄会连同 UUID `workspace_id` 持久化到浏览器 IndexedDB，所有已授权工作区会共同提供搜索与数据视图。浏览器撤销既有授权时，可在工作区列表中重新授权；URL 不携带工作区参数。

导出的 JSON 是图表元数据。它只保存工作区相对路径，不保存文件内容、绝对路径或浏览器目录句柄，因此不会扩大浏览器对本机文件的访问范围。核心结构如下：

```json
{
  "version": 4,
  "data": [
    { "id": "price", "workspaceId": "8d26c4f5-8ef3-4d04-a2fb-b1e5d8e31aa3", "filename": "price.parquet", "timeColumn": "date" },
    { "id": "signals", "workspaceId": "147eab6a-0d80-4b82-8e9d-129af1e28e80", "filename": "signals.csv", "timeColumn": "timestamp" }
  ],
  "view": { "id": "default", "name": "默认视图", "panes": [{ "id": "primary", "name": "主图" }, { "id": "indicator", "name": "指标副图" }] },
  "mappings": [
    { "id": "ohlc", "sourceId": "price", "paneId": "primary", "kind": "candlestick", "name": "价格", "color": "#c6dd62", "openColumn": "open", "highColumn": "high", "lowColumn": "low", "closeColumn": "close" },
    { "id": "volume", "sourceId": "price", "paneId": "indicator", "kind": "histogram", "name": "成交量", "color": "#72c7e8", "valueColumn": "volume" },
    { "id": "signal", "sourceId": "signals", "paneId": "primary", "kind": "markers", "name": "信号", "color": "#ea9c62", "valueColumn": "price", "textColumn": "signal" },
    { "id": "plan", "sourceId": "signals", "paneId": "primary", "kind": "segment", "name": "计划线", "color": "#c5a0eb", "valueColumn": "entry", "endTimeColumn": "exit_time", "endValueColumn": "exit" }
  ]
}
```

`data[].id` 是图层的稳定引用，`workspaceId + filename` 唯一定位一个工作区文件，`mappings[].sourceId` 决定图层读哪个文件，`mappings[].paneId` 决定它位于哪个 Pane；每一个源使用自己的 `timeColumn`。线段将该源一行中的时间列与 `endTimeColumn` 相连，并使用 `valueColumn` 与 `endValueColumn` 作为两端数值。导入 v3 配置时会自动迁移到 v4 的主图 Pane；未知图形类型、重复 ID/文件、无效 Pane 或不存在的数据源引用会被拒绝。

## 部署

推送至 `main` 会由 GitHub Pages Actions 构建并发布。`public/CNAME` 指定生产域名为 `tsv.ntnl.io`；首次发布后，还需在 GitHub Pages 设置中选择 **GitHub Actions** 作为 Source，并为该域名配置 DNS。
