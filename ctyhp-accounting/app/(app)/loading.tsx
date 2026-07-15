import { Skeleton } from "antd";

export default function Loading() {
  return (
    <div>
      <Skeleton active paragraph={{ rows: 1 }} title={{ width: 240 }} style={{ marginBottom: 24 }} />
      <Skeleton active paragraph={{ rows: 6 }} />
    </div>
  );
}
