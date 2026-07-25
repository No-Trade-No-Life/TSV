# TSV

纯浏览器内运行的时间序列复盘工具。导入 CSV 或 Parquet 后，在本地完成解析和绘图；文件不会上传到任何服务端。

## 本地开发

```bash
npm install
npm run dev
```

## 数据与图表配置

一次可加载多个文件；每个数据源独立指定时间列，再为图层选择来源文件与数据列。配置可以导出为 JSON，并在下次加载相同文件名的数据文件后重新导入。当前支持：OHLC 蜡烛图、折线、柱状图、标记和线段。

导出的 JSON 是图表元数据。它不保存文件内容或文件路径，因此不会扩大浏览器对本机文件的访问范围。核心结构如下：

```json
{
  "version": 2,
  "sources": [
    { "id": "price.parquet", "timeColumn": "date" },
    { "id": "signals.csv", "timeColumn": "timestamp" }
  ],
  "mappings": [
    { "id": "ohlc", "sourceId": "price.parquet", "kind": "candlestick", "name": "价格", "color": "#c6dd62", "openColumn": "open", "highColumn": "high", "lowColumn": "low", "closeColumn": "close" },
    { "id": "volume", "sourceId": "price.parquet", "kind": "histogram", "name": "成交量", "color": "#72c7e8", "valueColumn": "volume" },
    { "id": "signal", "sourceId": "signals.csv", "kind": "markers", "name": "信号", "color": "#ea9c62", "valueColumn": "price", "textColumn": "signal" },
    { "id": "plan", "sourceId": "signals.csv", "kind": "segment", "name": "计划线", "color": "#c5a0eb", "valueColumn": "entry", "endTimeColumn": "exit_time", "endValueColumn": "exit" }
  ]
}
```

`sources[].id` 在浏览器中默认使用文件名，`mappings[].sourceId` 决定该图层读哪个文件；每一个源使用自己的 `timeColumn`。线段将该源一行中的时间列与 `endTimeColumn` 相连，并使用 `valueColumn` 与 `endValueColumn` 作为两端数值。导入时缺失的 `id`、名称或颜色会自动补齐；未知图形类型会被拒绝。

## 部署

推送至 `main` 会由 GitHub Pages Actions 构建并发布。`public/CNAME` 指定生产域名为 `tsv.ntnl.io`；首次发布后，还需在 GitHub Pages 设置中选择 **GitHub Actions** 作为 Source，并为该域名配置 DNS。
