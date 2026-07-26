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
  type TickMarkFormatter,
} from 'lightweight-charts';
import { parseNumber, parseTime } from './data';
import type { Dataset, Mapping, Row, ViewerConfig } from './types';

type Props = { datasets: Dataset[]; config: ViewerConfig };
export type ResolvedMapping = { dataset: Dataset; timeColumn: string; paneIndex: number; mapping: Mapping };
export type PaneLegend = { paneIndex: number; paneName: string; entries: Array<{ name: string; color: string }> };

export const resolveMappings = (datasets: Dataset[], config: ViewerConfig): ResolvedMapping[] =>
  config.mappings.flatMap((mapping) => {
    const dataset = datasets.find((source) => source.id === mapping.sourceId);
    const source = config.data.find((entry) => entry.id === mapping.sourceId);
    const paneIndex = config.view.panes.findIndex((pane) => pane.id === mapping.paneId);
    return dataset && source?.timeColumn && paneIndex !== -1 ? [{ dataset, timeColumn: source.timeColumn, paneIndex, mapping }] : [];
  });

const legendColor = (mapping: Mapping) => mapping.kind === 'candlestick' ? '#c6dd62' : mapping.color;

export const resolvePaneLegends = (mappings: ResolvedMapping[], config: ViewerConfig): PaneLegend[] =>
  config.view.panes.map((pane, paneIndex) => ({
    paneIndex,
    paneName: pane.name,
    entries: mappings.filter((item) => item.paneIndex === paneIndex).map(({ mapping }) => ({ name: mapping.name, color: legendColor(mapping) })),
  })).filter((legend) => legend.entries.length > 0);

const browserLocale = () => typeof navigator === 'undefined' ? 'en-US' : navigator.language;

export const formatLocaleDateTime = (time: Time, locale = browserLocale()) => {
  const date = typeof time === 'number'
    ? new Date(time * 1000)
    : typeof time === 'string'
      ? new Date(time)
      : new Date(time.year, time.month - 1, time.day);
  return date.toLocaleString(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const localeTickMarkFormatter: TickMarkFormatter = (time, _type, locale) => formatLocaleDateTime(time, locale);

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

const addMapping = (chart: IChartApi, dataset: Dataset, timeColumn: string, paneIndex: number, mapping: Mapping) => {
  const rows = timeRows(dataset.rows, timeColumn);
  if (mapping.kind === 'candlestick') {
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#c6dd62', downColor: '#ef7e76', borderVisible: false, wickUpColor: '#c6dd62', wickDownColor: '#ef7e76', title: mapping.name,
    }, paneIndex);
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
    const series = chart.addSeries(HistogramSeries, { color: mapping.color, title: mapping.name, priceFormat: { type: 'price', precision: 4, minMove: 0.0001 } }, paneIndex);
    series.setData(valuePoints(dataset.rows, timeColumn, mapping.valueColumn));
    return;
  }
  if (mapping.kind === 'markers') {
    const series = chart.addSeries(LineSeries, { color: 'rgba(0,0,0,0)', lineVisible: false, lastValueVisible: false, priceLineVisible: false, title: mapping.name }, paneIndex);
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
      }, paneIndex);
      series.setData([
        { time: Math.min(time, endTime) as Time, value: time < endTime ? startValue : endValue },
        { time: Math.max(time, endTime) as Time, value: time < endTime ? endValue : startValue },
      ]);
    });
    return;
  }
  const series = chart.addSeries(LineSeries, { color: mapping.color, lineWidth: 2, title: mapping.name }, paneIndex);
  series.setData(valuePoints(dataset.rows, timeColumn, mapping.valueColumn));
};

const attachPaneLegends = (chart: IChartApi, config: ViewerConfig, mappings: ResolvedMapping[]) => {
  const legends = resolvePaneLegends(mappings, config);
  const elements = legends.flatMap((legend) => {
    const pane = chart.panes()[legend.paneIndex]?.getHTMLElement();
    if (!pane) return [];
    const element = document.createElement('div');
    element.className = 'chart-pane-legend';
    const title = document.createElement('strong');
    title.textContent = legend.paneName;
    element.append(title);
    legend.entries.forEach((entry) => {
      const item = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.style.backgroundColor = entry.color;
      item.append(swatch, document.createTextNode(entry.name));
      element.append(item);
    });
    pane.append(element);
    return [element];
  });
  return () => elements.forEach((element) => element.remove());
};

export const Chart = ({ datasets, config }: Props) => {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return undefined;
    const container = host.current;
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width > 0 && height > 0) chart.resize(width, height, true);
    };
    const chart = createChart(container, {
      width: Math.max(container.clientWidth, 1),
      height: Math.max(container.clientHeight, 1),
      layout: { background: { type: ColorType.Solid, color: '#11140f' }, textColor: '#d9dfd2', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      grid: { vertLines: { color: '#242a21' }, horzLines: { color: '#242a21' } },
      rightPriceScale: { borderColor: '#3b4237' },
      localization: { locale: browserLocale(), timeFormatter: formatLocaleDateTime },
      timeScale: { borderColor: '#3b4237', timeVisible: true, secondsVisible: false, tickMarkFormatter: localeTickMarkFormatter },
      crosshair: { vertLine: { color: '#c6dd6266' }, horzLine: { color: '#c6dd6266' } },
    });
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    let frame = requestAnimationFrame(() => {
      resize();
      frame = requestAnimationFrame(resize);
    });
    config.view.panes.slice(1).forEach(() => chart.addPane(true));
    const mappings = resolveMappings(datasets, config);
    mappings.forEach(({ dataset, timeColumn, paneIndex, mapping }) => addMapping(chart, dataset, timeColumn, paneIndex, mapping));
    const detachLegends = attachPaneLegends(chart, config, mappings);
    chart.timeScale().fitContent();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      detachLegends();
      chart.remove();
    };
  }, [datasets, config]);
  return <div className="chart-host" ref={host} aria-label="时间序列图表" />;
};
