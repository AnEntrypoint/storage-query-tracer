import {  EventEmitter  } from 'events';
import {  randomUUID  } from 'crypto';

class StorageQueryTracer extends EventEmitter {
  constructor(maxQueries = 10000) {
    super();
    this.maxQueries = maxQueries;
    this.queries = [];
    this.byOperation = new Map();
  }

  recordQuery(operation, collection, key = null, metadata = {}) {
    const query = {
      id: randomUUID(),
      operation,
      collection,
      key,
      startTime: Date.now(),
      endTime: null,
      duration: 0,
      status: 'running',
      rowCount: 0,
      error: null,
      metadata
    };

    this.queries.push(query);

    if (!this.byOperation.has(operation)) {
      this.byOperation.set(operation, []);
    }
    this.byOperation.get(operation).push(query.id);

    if (this.queries.length > this.maxQueries) {
      const removed = this.queries.shift();
      const list = this.byOperation.get(removed.operation);
      if (list) {
        const idx = list.indexOf(removed.id);
        if (idx > -1) list.splice(idx, 1);
      }
    }

    this.emit('query:started', { id: query.id, operation, collection });

    return {
      id: query.id,
      end: (rowCount = 0, error = null) => {
        query.endTime = Date.now();
        query.duration = query.endTime - query.startTime;
        query.rowCount = rowCount;
        query.status = error ? 'error' : 'success';
        query.error = error ? { message: error.message, type: error.constructor.name } : null;

        this.emit('query:ended', {
          id: query.id,
          operation,
          duration: query.duration,
          status: query.status,
          rowCount
        });

        return query;
      }
    };
  }

  getQueriesForOperation(operation, limit = 100) {
    const ids = this.byOperation.get(operation) || [];
    return ids.map(id => this.queries.find(q => q.id === id)).filter(Boolean).slice(-limit);
  }

  getSlowQueries(threshold = 100, limit = 50) {
    return this.queries.filter(q => q.duration > threshold && q.status === 'success').sort((a, b) => b.duration - a.duration).slice(0, limit);
  }

  getStats() {
    const byOperation = {};
    let totalDuration = 0;
    let totalQueries = 0;
    let totalErrors = 0;

    this.queries.forEach(q => {
      if (!byOperation[q.operation]) {
        byOperation[q.operation] = { count: 0, totalDuration: 0, errors: 0, avgRowCount: 0, totalRows: 0 };
      }
      byOperation[q.operation].count++;
      byOperation[q.operation].totalDuration += q.duration;
      byOperation[q.operation].totalRows += q.rowCount;
      if (q.status === 'error') {
        byOperation[q.operation].errors++;
        totalErrors++;
      }
      if (q.status === 'success') {
        totalDuration += q.duration;
        totalQueries++;
      }
    });

    const stats = Object.entries(byOperation).map(([op, data]) => ({
      operation: op,
      count: data.count,
      avgDuration: Math.round(data.totalDuration / data.count),
      avgRowCount: Math.round(data.totalRows / data.count),
      errors: data.errors,
      errorRate: (data.errors / data.count * 100).toFixed(1)
    }));

    return {
      totalQueries: this.queries.length,
      successRate: totalQueries > 0 ? ((totalQueries / this.queries.length) * 100).toFixed(1) : 0,
      avgDuration: totalQueries > 0 ? Math.round(totalDuration / totalQueries) : 0,
      totalErrors,
      byOperation: stats.sort((a, b) => b.count - a.count)
    };
  }

  getRecent(limit = 100) {
    return this.queries.slice(-limit).map(q => ({
      id: q.id,
      operation: q.operation,
      collection: q.collection,
      duration: q.duration,
      status: q.status,
      rowCount: q.rowCount,
      timestamp: q.startTime
    }));
  }

  clear() {
    this.queries = [];
    this.byOperation.clear();
  }
}

export {
  StorageQueryTracer
};
export const createStorageQueryTracer = (maxQueries) => new StorageQueryTracer(maxQueries);
