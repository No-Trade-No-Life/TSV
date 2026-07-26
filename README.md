# TSV

纯浏览器内运行的时间序列复盘工具。添加一个或多个本地工作区后，在本地完成 CSV/Parquet 解析和绘图；文件不会上传到任何服务端。

## 本地开发

```bash
npm install
npm run dev
```

## 数据与图表配置

外部程序直接生成工作区配置与 View 文件的格式见 [外部 View 集成](docs/external-views.md)。

工作区由 App Header 的“工作区管理”弹窗统一管理。弹窗以表格展示名称、Workspace ID、Parquet/CSV 文件数量和权限状态；可以添加、改名、刷新授权或移除目录句柄。

当前 View 的标题显示在 App Header。创建或编辑 View 会打开右侧 Drawer：数据文件、Pane 与图层都是草稿，顶部的“预览”只临时刷新图表，“保存”会写入 View 文件并应用，“取消”会恢复打开 Drawer 前的已保存状态。Drawer 打开时会轻量读取数据文件的列信息（CSV 表头或 Parquet schema），因此时间列和图层字段可立即选择；只有预览或保存才读取完整数据用于图表。Drawer 在桌面端占用最多 40% 的宽度，主图会同步缩放而不是被遮挡。数据文件包含稳定的 `id`、所属 `workspaceId`、工作区相对路径 `filename` 与自己的 `timeColumn`；图层通过 `sourceId` 引用它们。

“搜索文件”弹窗会跨所有已授权工作区模糊搜索 CSV、Parquet 与 PQ 文件；可先展开预览前 12 行，再将文件加入数据源或替换已有数据源。View 不再通过导入/导出 JSON 管理：应用只扫描、还原和保存工作区中的 View 文件。View JSON 永远不保存绝对路径、文件内容或浏览器目录句柄。

一个 View 包含多个 Pane：主图和任意数量的副图都可以拥有多个图层。每个图层通过 `paneId` 放入目标 Pane。

### 本地工作区

在 Chromium 系浏览器中，可通过“添加工作区”选择多个本地目录。TSV 使用 `FileSystemDirectoryHandle` 的 `readwrite` 模式：首次添加时，会在工作区根目录创建 `tsv.config.json`，至少包含 `{ "workspace_id": "UUID" }`，并可保存 `display_name` 等工作区元数据。这个文件随工作区同步，因此不同机器会识别为同一个工作区。浏览器 IndexedDB 只保存目录 Handle 列表，不保存工作区 UUID、名称或 View 元数据。

View 文件位于工作区 `.tsv/views/<view_id>.json`。应用扫描所有已授权工作区的该目录以还原 View；每个 View 的 `view.id` 是 UUID，`view.name` 是显示名称。保存时会直接覆盖对应的 View 文件。当前已加载 View 的 ID 也会写入 URL Hash（例如 `#f32d7ef5-8bc1-4cd4-9f48-a2de9a4dcad2`），刷新页面后会自动还原对应 View。

View 文件是图表元数据。它只保存工作区相对路径，不保存文件内容、绝对路径或浏览器目录句柄，因此不会扩大浏览器对本机文件的访问范围。核心结构如下：

```json
{
  "version": 4,
  "data": [
    { "id": "price", "workspaceId": "8d26c4f5-8ef3-4d04-a2fb-b1e5d8e31aa3", "filename": "price.parquet", "timeColumn": "date" },
    { "id": "signals", "workspaceId": "147eab6a-0d80-4b82-8e9d-129af1e28e80", "filename": "signals.csv", "timeColumn": "timestamp" }
  ],
  "view": { "id": "f32d7ef5-8bc1-4cd4-9f48-a2de9a4dcad2", "name": "默认视图", "panes": [{ "id": "primary", "name": "主图" }, { "id": "indicator", "name": "指标副图" }] },
  "mappings": [
    { "id": "ohlc", "sourceId": "price", "paneId": "primary", "kind": "candlestick", "name": "价格", "color": "#c6dd62", "openColumn": "open", "highColumn": "high", "lowColumn": "low", "closeColumn": "close" },
    { "id": "volume", "sourceId": "price", "paneId": "indicator", "kind": "histogram", "name": "成交量", "color": "#72c7e8", "valueColumn": "volume" },
    { "id": "signal", "sourceId": "signals", "paneId": "primary", "kind": "markers", "name": "信号", "color": "#ea9c62", "valueColumn": "price", "textColumn": "signal" },
    { "id": "plan", "sourceId": "signals", "paneId": "primary", "kind": "segment", "name": "计划线", "color": "#c5a0eb", "valueColumn": "entry", "endTimeColumn": "exit_time", "endValueColumn": "exit" }
  ]
}
```

`data[].id` 是图层的稳定引用，`workspaceId + filename` 唯一定位一个工作区文件，`mappings[].sourceId` 决定图层读哪个文件，`mappings[].paneId` 决定它位于哪个 Pane；每一个源使用自己的 `timeColumn`。线段将该源一行中的时间列与 `endTimeColumn` 相连，并使用 `valueColumn` 与 `endValueColumn` 作为两端数值。未知图形类型、重复 ID/文件、无效 Pane 或不存在的数据源引用会被拒绝。

## 部署

推送至 `main` 会由 GitHub Pages Actions 构建并发布。`public/CNAME` 指定生产域名为 `tsv.ntnl.io`；首次发布后，还需在 GitHub Pages 设置中选择 **GitHub Actions** 作为 Source，并为该域名配置 DNS。
