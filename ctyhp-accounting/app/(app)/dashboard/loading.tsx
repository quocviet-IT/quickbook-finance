export default function DashboardLoading() {
  return (
    <div
      className="dashboard-loading"
      role="status"
      aria-label="Loading financial dashboard"
    >
      <div className="dashboard-loading__heading" />
      <div className="dashboard-loading__metrics">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="dashboard-loading__metric" key={index} />
        ))}
      </div>
      <div className="dashboard-loading__panels">
        <div className="dashboard-loading__panel" />
        <div className="dashboard-loading__panel" />
      </div>
      <span className="accounting-sr-only">Loading financial dashboard</span>
    </div>
  );
}
