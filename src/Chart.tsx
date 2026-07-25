import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type Time,
} from 'lightweight-charts';
import { parseNumber, parseTime } from './data';
import type { Dataset, Mapping, Row, ViewerConfig } from './types';

type Props = { datasets: Dataset[]; config: ViewerConfig };
export type ResolvedMapping = { dataset: Dataset; timeColumn: string; mapping: Mapping };

export const resolveMappings = (datasets: Dataset[], config: ViewerConfig): ResolvedMapping[] =>
  config.mappings.flatMap((mapping) => {
    const dataset = datasets.find((source) => source.id === mapping.sourceId);
    const source = config.sources.find((entry) => entry.id === mapping.sourceId);
    return dataset && source?.timeColumn ? [{ dataset, timeColumn: source.timeColumn, mapping }] : [];
  });

const timeRows = (rows: Row[], column: string) =>
  rows
    .map((row) => ({ row, time: parseTime(row[column]) }))
    .filter((item): item is { row: Row; time: number } => item.time !== undefined)
    .sort((a, b) => a.time - b.time);

const valuePoints = (rows: Row[], timeColumn: string, valueColumn?: string) =>
  uniqueTimes(timeRows(rows, timeColumn).flatMap(({ row, time }) => {
    const value = parseNumber(row[valueColumn ?? '']);
    return value === undefined ? [] : [{ time: time as Time, value }];
  }));

const uniqueTimes = <T extends { time: Time }>(points: T[]) => {
  const latestByTime = new Map<number, T>();
  points.forEach((point) => latestByTime.set(Number(point.time), point));
  return [...latestByTime.values()].sort((left, right) => Number(left.time) - Number(right.time));
};

const addMapping = (chart: IChartApi, dataset: Dataset, timeColumn: string, mapping: Mapping) => {
  const rows = timeRows(dataset.rows, timeColumn);
  if (mapping.kind === 'candlestick') {
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#c6dd62', downColor: '#ef7e76', borderVisible: false, wickUpColor: '#c6dd62', wickDownColor: '#ef7e76', title: mapping.name,
    });
    series.setData(uniqueTimes(rows.flatMap(({ row, time }) => {
      const open = parseNumber(row[mapping.openColumn ?? '']);
      const high = parseNumber(row[mapping.highColumn ?? '']);
      const low = parseNumber(row[mapping.lowColumn ?? '']);
      const close = parseNumber(row[mapping.closeColumn ?? '']);
      return open === undefined || high === undefined || low === undefined || close === undefined ? [] : [{ time: time as Time, open, high, low, close }];
    })));
    return;
  }
  if (mapping.kind === 'histogram') {
    const series = chart.addSeries(HistogramSeries, { color: mapping.color, title: mapping.name, priceFormat: { type: 'price', precision: 4, minMove: 0.0001 } });
    series.setData(valuePoints(dataset.rows, timeColumn, mapping.valueColumn));
    return;
  }
  if (mapping.kind === 'markers') {
    const series = chart.addSeries(LineSeries, { color: 'rgba(0,0,0,0)', lineVisible: false, lastValueVisible: false, priceLineVisible: false, title: mapping.name });
    const points = valuePoints(dataset.rows, timeColumn, mapping.valueColumn);
    series.setData(points);
    createSeriesMarkers(series, rows.flatMap(({ row, time }) => {
      const value = parseNumber(row[mapping.valueColumn ?? '']);
      return value === undefined ? [] : [{ time: time as Time, position: 'inBar' as const, color: mapping.color, shape: 'circle' as const, text: String(row[mapping.textColumn ?? ''] ?? mapping.name) }];
    }));
    return;
  }
  if (mapping.kind === 'segment') {
    rows.forEach(({ row, time }, index) => {
      const startValue = parseNumber(row[mapping.valueColumn ?? '']);
      const endTime = parseTime(row[mapping.endTimeColumn ?? '']);
      const endValue = parseNumber(row[mapping.endValueColumn ?? '']);
      if (startValue === undefined || endTime === undefined || endValue === undefined || endTime === time) return;
      const series = chart.addSeries(LineSeries, {
        color: mapping.color,
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        title: index === 0 ? mapping.name : '',
      });
      series.setData([
        { time: Math.min(time, endTime) as Time, value: time < endTime ? startValue : endValue },
        { time: Math.max(time, endTime) as Time, value: time < endTime ? endValue : startValue },
      ]);
    });
    return;
  }
  const series = chart.addSeries(LineSeries, { color: mapping.color, lineWidth: 2, title: mapping.name });
  series.setData(valuePoints(dataset.rows, timeColumn, mapping.valueColumn));
};

export const Chart = ({ datasets, config }: Props) => {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return undefined;
    const container = host.current;
    const chart = createChart(container, {
      width: Math.max(container.clientWidth, 1),
      height: Math.max(container.clientHeight, 1),
      layout: { background: { type: ColorType.Solid, color: '#11140f' }, textColor: '#d9dfd2', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      grid: { vertLines: { color: '#242a21' }, horzLines: { color: '#242a21' } },
      rightPriceScale: { borderColor: '#3b4237' },
      timeScale: { borderColor: '#3b4237', timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: '#c6dd6266' }, horzLine: { color: '#c6dd6266' } },
    });
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        chart.resize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    observer.observe(container);
    resolveMappings(datasets, config).forEach(({ dataset, timeColumn, mapping }) => addMapping(chart, dataset, timeColumn, mapping));
    chart.timeScale().fitContent();
    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [datasets, config]);
  return <div className="chart-host" ref={host} aria-label="时间序列图表" />;
};
