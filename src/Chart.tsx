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
type LegendItem = { series: unknown[]; value: HTMLOutputElement };

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

const formatLegendNumber = (value: unknown, locale = browserLocale()) => typeof value === 'number'
  ? value.toLocaleString(locale, { maximumFractionDigits: 8 })
  : '—';

export const formatLegendValue = (value: unknown, locale = browserLocale()) => {
  if (!value || typeof value !== 'object') return '—';
  if ('open' in value && 'high' in value && 'low' in value && 'close' in value) {
    return `O ${formatLegendNumber(value.open, locale)} H ${formatLegendNumber(value.high, locale)} L ${formatLegendNumber(value.low, locale)} C ${formatLegendNumber(value.close, locale)}`;
  }
  return 'value' in value ? formatLegendNumber(value.value, locale) : '—';
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
    return [series];
  }
  if (mapping.kind === 'histogram') {
    const series = chart.addSeries(HistogramSeries, { color: mapping.color, title: mapping.name, priceFormat: { type: 'price', precision: 4, minMove: 0.0001 } }, paneIndex);
    series.setData(valuePoints(dataset.rows, timeColumn, mapping.valueColumn));
    return [series];
  }
  if (mapping.kind === 'markers') {
    const series = chart.addSeries(LineSeries, { color: 'rgba(0,0,0,0)', lineVisible: false, lastValueVisible: false, priceLineVisible: false, title: mapping.name }, paneIndex);
    const points = valuePoints(dataset.rows, timeColumn, mapping.valueColumn);
    series.setData(points);
    createSeriesMarkers(series, rows.flatMap(({ row, time }) => {
      const value = parseNumber(row[mapping.valueColumn ?? '']);
      return value === undefined ? [] : [{ time: time as Time, position: 'inBar' as const, color: mapping.color, shape: 'circle' as const, text: String(row[mapping.textColumn ?? ''] ?? mapping.name) }];
    }));
    return [series];
  }
  if (mapping.kind === 'segment') {
    const series = rows.flatMap(({ row, time }, index) => {
      const startValue = parseNumber(row[mapping.valueColumn ?? '']);
      const endTime = parseTime(row[mapping.endTimeColumn ?? '']);
      const endValue = parseNumber(row[mapping.endValueColumn ?? '']);
      if (startValue === undefined || endTime === undefined || endValue === undefined || endTime === time) return [];
      const segment = chart.addSeries(LineSeries, {
        color: mapping.color,
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        title: index === 0 ? mapping.name : '',
      }, paneIndex);
      segment.setData([
        { time: Math.min(time, endTime) as Time, value: time < endTime ? startValue : endValue },
        { time: Math.max(time, endTime) as Time, value: time < endTime ? endValue : startValue },
      ]);
      return [segment];
    });
    return series;
  }
  const series = chart.addSeries(LineSeries, { color: mapping.color, lineWidth: 2, title: mapping.name }, paneIndex);
  series.setData(valuePoints(dataset.rows, timeColumn, mapping.valueColumn));
  return [series];
};

const attachPaneLegends = (container: HTMLDivElement, chart: IChartApi, config: ViewerConfig, mappings: ResolvedMapping[], seriesByMapping: Map<string, unknown[]>) => {
  const legends = resolvePaneLegends(mappings, config);
  let elements: HTMLElement[] = [];
  let items: LegendItem[] = [];
  let crosshairData = new Map<unknown, unknown>();
  const renderValues = () => items.forEach((item) => {
    const value = item.series.map((series) => crosshairData.get(series)).find((data) => data !== undefined);
    item.value.textContent = formatLegendValue(value);
  });
  const mount = () => {
    elements.forEach((element) => element.remove());
    elements = [];
    items = [];
    const anchors = [...container.querySelectorAll<HTMLTableCellElement>('table tr td:nth-child(2)')];
    legends.forEach((legend) => {
      const anchor = anchors[legend.paneIndex];
      if (!anchor) return;
      const element = document.createElement('div');
      element.className = 'chart-pane-legend';
      const title = document.createElement('strong');
      title.textContent = legend.paneName;
      element.append(title);
      const paneMappings = mappings.filter((mapping) => mapping.paneIndex === legend.paneIndex);
      legend.entries.forEach((entry, index) => {
        const item = document.createElement('span');
        const swatch = document.createElement('i');
        swatch.style.backgroundColor = entry.color;
        const name = document.createElement('b');
        name.textContent = entry.name;
        const value = document.createElement('output');
        value.textContent = '—';
        item.append(swatch, name, value);
        element.append(item);
        items.push({ series: seriesByMapping.get(paneMappings[index]?.mapping.id ?? '') ?? [], value });
      });
      anchor.append(element);
      elements.push(element);
    });
    renderValues();
  };
  const observer = new MutationObserver((records) => {
    if (records.some((record) => record.type === 'childList' && record.target instanceof HTMLTableElement)) mount();
  });
  observer.observe(container, { childList: true, subtree: true });
  const frame = requestAnimationFrame(mount);
  const onCrosshairMove = (parameter: { seriesData: Map<unknown, unknown> }) => {
    crosshairData = parameter.seriesData;
    renderValues();
  };
  chart.subscribeCrosshairMove(onCrosshairMove);
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    chart.unsubscribeCrosshairMove(onCrosshairMove);
    elements.forEach((element) => element.remove());
  };
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
    const seriesByMapping = new Map(mappings.map(({ dataset, timeColumn, paneIndex, mapping }) => [mapping.id, addMapping(chart, dataset, timeColumn, paneIndex, mapping)]));
    const detachLegends = attachPaneLegends(container, chart, config, mappings, seriesByMapping);
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
