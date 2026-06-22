import { Typography } from 'antd';
import type { DetailSelection } from '../utils/analysisViewModel';

export type DetailsPaneProps = {
  selection: DetailSelection | null;
};

type DetailRowModel = {
  label: string;
  value: unknown;
};

function hasDetailValue(value: unknown): value is string | number {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (typeof value === 'string') {
    return value.trim() !== '';
  }

  return false;
}

function detailRows(selection: DetailSelection | null): DetailRowModel[] {
  if (!selection) {
    return [];
  }

  if (selection.kind === 'package') {
    const { row } = selection;

    return [
      { label: 'Full Path', value: row.fullPath },
      { label: 'File Name', value: row.fileName },
      { label: 'Size', value: row.size },
      { label: 'Compressed', value: row.compressedSize },
      { label: 'Order', value: row.physicalOrder },
      { label: 'Type', value: row.type },
    ].filter((detailRow) => hasDetailValue(detailRow.value));
  }

  const { row } = selection;

  return [
    { label: 'Severity', value: row.severity },
    { label: 'Code', value: row.code },
    { label: 'Message', value: row.message },
  ].filter((detailRow) => hasDetailValue(detailRow.value));
}

export function DetailsPane({ selection }: DetailsPaneProps) {
  const rows = detailRows(selection);

  return (
    <section className="workspace-pane details-region" aria-label="Details">
      <div className="pane-title-block">
        <div>
          <Typography.Title className="pane-title" level={2}>
            Details
          </Typography.Title>
        </div>
      </div>
      {rows.length > 0 ? (
        <div className="details-list">
          {rows.map((row) => {
            const value = String(row.value);

            return (
              <div className="detail-row" key={row.label}>
                <Typography.Text className="detail-row-label">{row.label}</Typography.Text>
                <Typography.Text className="detail-row-value" title={value}>
                  {value}
                </Typography.Text>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
