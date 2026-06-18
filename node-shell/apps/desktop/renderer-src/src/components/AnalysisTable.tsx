import { Empty, Table } from 'antd';
import { useMemo } from 'react';
import { buildColumns, buildDataSource, type TableRecord } from './analysisTableData';

type AnalysisTableProps = {
  rows: unknown[];
  height: number;
};

export function AnalysisTable({ rows, height }: AnalysisTableProps) {
  const tableState = useMemo(() => {
    const columns = buildColumns(rows);
    const dataSource = buildDataSource(rows);
    const scrollX = Math.max(columns.length * 180, 720);

    return { columns, dataSource, scrollX };
  }, [rows]);

  if (rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No rows to show." />;
  }

  return (
    <Table<TableRecord>
      bordered
      columns={tableState.columns}
      dataSource={tableState.dataSource}
      pagination={false}
      rowKey="__rowKey"
      scroll={{ x: tableState.scrollX, y: height }}
      size="small"
      tableLayout="fixed"
      virtual
    />
  );
}
