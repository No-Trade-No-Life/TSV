# TSV

纯浏览器内运行的时间序列复盘工具。导入 CSV 或 Parquet 后，在本地完成解析和绘图；文件不会上传到任何服务端。

## 本地开发

```bash
npm install
npm run dev
```

## 数据与图表配置

加载文件后，选择时间列，再为序列配置类型和数据列。配置可以导出为 JSON，并在下次加载同结构的数据文件后重新导入。当前支持：OHLC 蜡烛图、折线、柱状图、标记和线段。

## 部署

推送至 `main` 会由 GitHub Pages Actions 构建并发布。`public/CNAME` 指定生产域名为 `tsv.ntnl.io`；首次发布后，还需在 GitHub Pages 设置中选择 **GitHub Actions** 作为 Source，并为该域名配置 DNS。
