// The one general cross-domain time-series query. Buckets and aggregates in
// SQL -- callers get back a handful of points plus summary statistics, never
// raw rows, so a multi-month trend costs a small fixed number of tokens
// regardless of how densely the user logged.
import { RowDataPacket } from 'mysql2';
import { parseISO, differenceInCalendarDays } from 'date-fns';
import pool from '../../database';
import { AnalyticsError } from './errors';
import { parseMetric } from './metric';
import { buildMetricSql, buildSeriesSql } from './sql';
import { dateRangeCondition, windowDaySpan, normalizeDbDate } from './dates';
import { computeSummary, RegressionPoint } from './stats';
import { Agg, Bucket, QuerySeriesParams, QuerySeriesResult, SeriesPoint } from './types';

const BUCKETS: ReadonlySet<string> = new Set<Bucket>(['day', 'week', 'month']);
const AGGS: ReadonlySet<string> = new Set<Agg>(['avg', 'sum', 'min', 'max', 'last']);

export async function querySeries(userUuid: string, params: QuerySeriesParams): Promise<QuerySeriesResult> {
  if (typeof params.from !== 'string' || typeof params.to !== 'string') {
    throw new AnalyticsError('`from` and `to` are required date strings');
  }
  const bucket: Bucket = params.bucket ?? 'day';
  if (!BUCKETS.has(bucket)) {
    throw new AnalyticsError(`Invalid bucket: ${params.bucket}`);
  }

  const parsed = parseMetric(params.metric);
  const metricSql = buildMetricSql(userUuid, parsed);

  const agg: Agg = params.agg ?? metricSql.defaultAgg;
  if (!AGGS.has(agg)) {
    throw new AnalyticsError(`Invalid agg: ${params.agg}`);
  }

  const { startDay, totalDays } = windowDaySpan(params.from, params.to);
  const { conditions: dateConditions, params: dateParams } = dateRangeCondition(
    metricSql.dateExpr, metricSql.dateColumnType, params.from, params.to,
  );

  const sql = buildSeriesSql(metricSql, bucket, [...metricSql.conditions, ...dateConditions]);
  const allParams = [...metricSql.params, ...dateParams];
  const [rows] = await pool.query<RowDataPacket[]>(sql, allParams);

  const points: SeriesPoint[] = rows.map((row) => ({
    bucketStart: normalizeDbDate(row.bucket_start),
    // last_val (not last_value -- a reserved word in MySQL 8) is the odd one out.
    value: Number(agg === 'last' ? row.last_val : row[`${agg}_value`]),
    daysWithData: Number(row.day_count),
  }));

  const regressionPoints: RegressionPoint[] = points.map((p) => ({
    x: differenceInCalendarDays(parseISO(p.bucketStart), startDay),
    value: p.value,
  }));
  const summary = computeSummary(regressionPoints);
  const daysWithData = points.reduce((sum, p) => sum + p.daysWithData, 0);

  return {
    metric: params.metric,
    bucket,
    agg,
    points,
    summary,
    coverage: {
      daysWithData,
      daysInWindow: totalDays,
      coverage: totalDays > 0 ? daysWithData / totalDays : null,
    },
  };
}
